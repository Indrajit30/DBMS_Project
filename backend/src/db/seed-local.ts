import { hashPassword } from "../auth/password.js";
import { inTransaction } from "./transaction.js";
import { pool } from "./pool.js";

const localPassword = "LocalDemo!2026";

async function main(): Promise<void> {
  try {
    await inTransaction(async (client) => {
      const manager = await upsertUser(client, "manager@local.test", "manager");
      const employee = await upsertUser(client, "employee@local.test", "warehouse_employee");
      const customerUser = await upsertUser(client, "customer@local.test", "customer");

      const warehouses = [];
      for (const row of [
        { code: "LOCAL-EAST", name: "Local East", region: "east", timezone: "America/New_York" },
        { code: "LOCAL-CENTRAL", name: "Local Central", region: "central", timezone: "America/Chicago" },
        { code: "LOCAL-WEST", name: "Local West", region: "west", timezone: "America/Los_Angeles" },
      ]) {
        const result = await client.query<{ warehouse_id: string }>(
          `INSERT INTO warehouses (code, name, region, timezone)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region,
             timezone = EXCLUDED.timezone, is_active = true
           RETURNING warehouse_id`,
          [row.code, row.name, row.region, row.timezone],
        );
        warehouses.push(Number(result.rows[0]!.warehouse_id));
      }

      const customer = await client.query<{ customer_id: string }>(
        `INSERT INTO customers (user_id, first_name, last_name, region)
         VALUES ($1, 'Casey', 'Customer', 'east')
         ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name, region = EXCLUDED.region
         RETURNING customer_id`,
        [customerUser],
      );

      await client.query(
        `INSERT INTO warehouse_memberships (user_id, warehouse_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [employee, warehouses[0]],
      );

      const products: Array<{ sku: string; name: string; category: string; price: string }> = [
        { sku: "LOCAL-MOUSE", name: "Wireless Mouse", category: "accessories", price: "24.99" },
        { sku: "LOCAL-KEYBOARD", name: "Compact Keyboard", category: "accessories", price: "59.00" },
        { sku: "LOCAL-CABLE", name: "USB-C Cable", category: "cables", price: "9.50" },
      ];

      for (const item of products) {
        const productResult = await client.query<{ product_id: string }>(
          `INSERT INTO products (sku, name, category, list_price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
             list_price = EXCLUDED.list_price, is_active = true
           RETURNING product_id`,
          [item.sku, item.name, item.category, item.price],
        );
        const productId = Number(productResult.rows[0]!.product_id);
        const lotResult = await client.query<{ lot_id: string }>(
          `INSERT INTO lots (product_id, lot_code, received_at, status)
           VALUES ($1, 'LOCAL-LOT-1', now() - interval '7 days', 'active')
           ON CONFLICT (product_id, lot_code) DO UPDATE SET status = 'active'
           RETURNING lot_id`,
          [productId],
        );
        const lotId = Number(lotResult.rows[0]!.lot_id);
        await client.query(
          `INSERT INTO inventory_balances (lot_id, warehouse_id, on_hand, reserved, unavailable)
           VALUES ($1, $2, 100, 0, 0)
           ON CONFLICT (lot_id, warehouse_id) DO NOTHING`,
          [lotId, warehouses[0]],
        );
        await client.query(
          `INSERT INTO stock_movements
             (lot_id, warehouse_id, event_type, on_hand_delta, reference_type, reference_id, idempotency_key, details)
           VALUES ($1, $2, 'local_seed_receipt', 100, 'seed', $3, $4, '{"source":"local seed"}'::jsonb)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [lotId, warehouses[0], productId, `local-seed:receipt:${item.sku}`],
        );
      }

      console.log(`Local seed ready: manager, employee, customer ${customer.rows[0]!.customer_id}; ${warehouses.length} warehouses and ${products.length} products.`);
    });
    console.log(`Local sign-in password for all three seed accounts: ${localPassword}`);
  } finally {
    await pool.end();
  }
}

async function upsertUser(
  client: import("pg").PoolClient,
  email: string,
  role: "manager" | "warehouse_employee" | "customer",
): Promise<string> {
  const passwordHash = await hashPassword(localPassword);
  const result = await client.query<{ user_id: string }>(
    `INSERT INTO users (email, password_hash, role, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role, status = 'active', auth_version = users.auth_version + 1,
       updated_at = now()
     RETURNING user_id`,
    [email, passwordHash, role],
  );
  return result.rows[0]!.user_id;
}

main().catch((error: unknown) => {
  console.error("Local seed failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
