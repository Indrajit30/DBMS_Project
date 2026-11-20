import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const migrationNamePattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const lockA = 3719;
const lockB = 1;

async function main(): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [lockA, lockB]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationDirectory))
      .filter((name) => migrationNamePattern.test(name))
      .sort();
    const applied = await client.query<{ migration_name: string; checksum: string }>(
      "SELECT migration_name, checksum FROM schema_migrations ORDER BY migration_name",
    );
    const appliedByName = new Map(applied.rows.map((row) => [row.migration_name, row.checksum.trim()]));

    for (const name of files) {
      const sql = await readFile(resolve(migrationDirectory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = appliedByName.get(name);
      if (existing) {
        if (existing !== checksum) {
          throw new Error(`Applied migration ${name} has changed. Add a new migration instead.`);
        }
        console.log(`already applied ${name}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        // No parameters are passed, so pg sends the migration as a simple multi-statement query.
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)",
          [name, checksum],
        );
        await client.query("COMMIT");
        console.log(`applied ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [lockA, lockB]);
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
