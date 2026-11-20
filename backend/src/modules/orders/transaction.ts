import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { inTransaction } from "../../db/transaction.js";
import { ApiError } from "../../shared/errors.js";
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await inTransaction(work);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "40001" && code !== "40P01") throw error;
      if (attempt === 2)
        throw new ApiError(
          409,
          "CONFLICT",
          "Inventory is busy; retry with the same idempotency key",
        );
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new Error("Unreachable transaction state");
}
export async function operationLock(
  client: PoolClient,
  customerId: number,
  operation: string,
  key: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${customerId}:${operation}:${key}`,
  ]);
}
export async function audit(
  client: PoolClient,
  actor: string,
  entity: string,
  id: number,
  action: string,
  key: string,
  data: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,request_id,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [actor, entity, id, action, key, JSON.stringify(data)],
  );
}
