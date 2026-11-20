import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { pool } from "./pool.js";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");

async function main(): Promise<void> {
  try {
    const files = (await readdir(migrationDirectory))
      .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    const exists = await pool.query("SELECT to_regclass('public.schema_migrations') AS table_name");
    const applied = exists.rows[0]?.table_name
      ? await pool.query<{ migration_name: string; checksum: string; applied_at: Date }>(
          "SELECT migration_name, checksum, applied_at FROM schema_migrations ORDER BY migration_name",
        )
      : { rows: [] as { migration_name: string; checksum: string; applied_at: Date }[] };
    const byName = new Map(applied.rows.map((row) => [row.migration_name, row]));

    for (const name of files) {
      const row = byName.get(name);
      if (!row) {
        console.log(`pending   ${name}`);
        continue;
      }
      const sql = await readFile(resolve(migrationDirectory, name), "utf8");
      const actual = createHash("sha256").update(sql).digest("hex");
      const state = row.checksum.trim() === actual ? "applied   " : "MISMATCH  ";
      console.log(`${state} ${name} (${row.applied_at.toISOString()})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration status failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
