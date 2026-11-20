import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.databaseSsl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: "multiwarehouse-api",
});

pool.on("error", (error) => {
  // Idle client errors must be visible; credentials and query parameters are never logged.
  console.error("Unexpected idle PostgreSQL client error", error.message);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
