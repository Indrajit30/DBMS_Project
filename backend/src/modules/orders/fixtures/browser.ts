// Isolated browser-test preparation only. Not a warehouse implementation or production seed.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pool } from "../../../db/pool.js";
import { transaction } from "../transaction.js";
import { createOrder } from "../service.js";
async function main() {
  try {
    const db = await pool.query("SELECT current_database() AS name");
    if (db.rows[0].name !== "customer_test")
      throw new Error(
        "Browser fixtures require the isolated customer_test database",
      );
    const account = await pool.query(
      "SELECT c.customer_id,u.user_id FROM customers c JOIN users u ON u.user_id=c.user_id WHERE u.email='customer@local.test'",
    );
    if (!account.rows[0])
      throw new Error("Run the shared local seed in the isolated DB first");
    const actor = {
      userId: String(account.rows[0].user_id),
      customerId: Number(account.rows[0].customer_id),
      role: "customer" as const,
      warehouseIds: [],
    };
    const warehouses = await pool.query(
      "SELECT warehouse_id FROM warehouses WHERE code IN ('LOCAL-EAST','LOCAL-CENTRAL','LOCAL-WEST') ORDER BY CASE code WHEN 'LOCAL-EAST' THEN 1 WHEN 'LOCAL-CENTRAL' THEN 2 ELSE 3 END",
    );
    if (warehouses.rows.length !== 3)
      throw new Error("Shared local warehouse seed missing");
    async function product(label: string) {
      return transaction(async (c) => {
        const unique = randomUUID();
        const p = await c.query(
          "INSERT INTO products(sku,name,category,list_price) VALUES($1,$2,'accessories',39.00) RETURNING product_id",
          [unique, label + " " + unique.slice(0, 8)],
        );
        const id = Number(p.rows[0].product_id);
        for (const [i, q] of [3, 2, 0].entries()) {
          const l = await c.query(
            "INSERT INTO lots(product_id,lot_code,received_at) VALUES($1,$2,now()) RETURNING lot_id",
            [id, unique + "-" + i],
          );
          await c.query(
            "INSERT INTO inventory_balances(lot_id,warehouse_id,on_hand) VALUES($1,$2,$3)",
            [l.rows[0].lot_id, warehouses.rows[i].warehouse_id, q],
          );
          if (q)
            await c.query(
              "INSERT INTO stock_movements(lot_id,warehouse_id,event_type,on_hand_delta,reference_type,reference_id,idempotency_key) VALUES($1,$2,'test_receipt',$3,'test',0,$4)",
              [
                l.rows[0].lot_id,
                warehouses.rows[i].warehouse_id,
                q,
                randomUUID(),
              ],
            );
        }
        return id;
      });
    }
    const checkoutProduct = await product("Browser Checkout Mouse"),
      historicalProduct = await product("Browser Delivered Mouse");
    const placed = await createOrder(
      actor,
      {
        destination: {
          name: "Demo Customer",
          line1: "42 Sample Street",
          city: "Brooklyn",
          region: "east",
          postal_code: "11201",
          country_code: "US",
        },
        items: [{ product_id: historicalProduct, quantity: 5 }],
      },
      randomUUID(),
    );
    await transaction(async (c) => {
      await c.query(
        "SELECT order_id FROM orders WHERE order_id=$1 FOR UPDATE",
        [placed.order.order_id],
      );
      const row = await c.query(
        "SELECT * FROM allocations WHERE order_id=$1 AND warehouse_id=$2 FOR UPDATE",
        [placed.order.order_id, warehouses.rows[0].warehouse_id],
      );
      const a = row.rows[0];
      if (!a) throw new Error("East allocation missing");
      await c.query(
        "UPDATE inventory_balances SET on_hand=on_hand-3,reserved=reserved-3 WHERE lot_id=$1 AND warehouse_id=$2",
        [a.lot_id, a.warehouse_id],
      );
      await c.query(
        "UPDATE allocations SET shipped_quantity=3,status='shipped' WHERE allocation_id=$1",
        [a.allocation_id],
      );
      await c.query(
        "UPDATE orders SET status='partially_shipped' WHERE order_id=$1",
        [placed.order.order_id],
      );
      const shipment = await c.query(
        "INSERT INTO shipments(order_id,warehouse_id,status,tracking_code,shipped_at,delivered_at) VALUES($1,$2,'delivered',$3,now()-interval '1 day',now()) RETURNING shipment_id",
        [
          placed.order.order_id,
          a.warehouse_id,
          "SIM-" + randomUUID().slice(0, 8),
        ],
      );
      await c.query(
        "INSERT INTO shipment_items(shipment_id,order_id,warehouse_id,allocation_id,lot_id,quantity) VALUES($1,$2,$3,$4,$5,3)",
        [
          shipment.rows[0].shipment_id,
          placed.order.order_id,
          a.warehouse_id,
          a.allocation_id,
          a.lot_id,
        ],
      );
      await c.query(
        "INSERT INTO shipment_events(shipment_id,event_type,occurred_at,details) VALUES($1,'dispatched',now()-interval '1 day','{\"simulated\":true}'),($1,'delivered',now(),'{\"simulated\":true}')",
        [shipment.rows[0].shipment_id],
      );
      await c.query(
        "INSERT INTO stock_movements(lot_id,warehouse_id,event_type,on_hand_delta,reserved_delta,reference_type,reference_id,idempotency_key) VALUES($1,$2,'test_dispatch',-3,-3,'order',$3,$4)",
        [a.lot_id, a.warehouse_id, placed.order.order_id, randomUUID()],
      );
    });
    await writeFile(
      "../docs/midterm/customer/prototype/.customer-test-fixture.json",
      JSON.stringify({
        checkout_product_id: checkoutProduct,
        return_order_id: placed.order.order_id,
      }),
    );
    console.log("Isolated live browser fixtures prepared.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
