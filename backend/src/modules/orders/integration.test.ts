import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../../shared/types.js";

// Opt in explicitly. Never point these fixture-writing tests at a team/production DB.
const databaseUrl = process.env.CUSTOMER_TEST_DATABASE_URL;
test(
  "customer PostgreSQL and HTTP integration",
  { skip: !databaseUrl },
  async (t) => {
    process.env.DATABASE_URL = databaseUrl!;
    process.env.JWT_SECRET ??=
      "customer-integration-only-secret-at-least-32-characters";
    const { pool } = await import("../../db/pool.js");
    const { app } = await import("../../app.js");
    const { createOrder, cancelOrder, createReturn } = await import(
      "./service.js"
    );
    const { transaction } = await import("./transaction.js");
    const { issueAccessToken } = await import("../../auth/token.js");
    const db = await pool.query("SELECT current_database() AS name");
    assert.equal(
      db.rows[0].name,
      "customer_test",
      "Integration suite requires a dedicated database named customer_test",
    );
    const run = randomUUID().slice(0, 8),
      warehouses: number[] = [];
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    t.after(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await pool.end();
    });
    const user = async (
      role: "customer" | "warehouse_employee" = "customer",
    ): Promise<AuthenticatedUser> => {
      const userId = randomUUID();
      await pool.query(
        "INSERT INTO users(user_id,email,password_hash,role) VALUES($1,$2,'!synthetic-no-login!',$3)",
        [userId, `${run}-${userId}@customer.test`, role],
      );
      let customerId: number | null = null;
      if (role === "customer") {
        const c = await pool.query(
          "INSERT INTO customers(user_id,first_name,last_name,region) VALUES($1,'Test','Customer','east') RETURNING customer_id",
          [userId],
        );
        customerId = Number(c.rows[0].customer_id);
      }
      return { userId, role, customerId, warehouseIds: [] };
    };
    const actor = await user(),
      other = await user(),
      employee = await user("warehouse_employee");
    for (const i of [0, 1, 2]) {
      const w = await pool.query(
        "INSERT INTO warehouses(code,name,region,timezone) VALUES($1,$2,$3,'UTC') RETURNING warehouse_id",
        [`${run}-${i}`, `Test warehouse ${i}`, ["east", "central", "west"][i]],
      );
      warehouses.push(Number(w.rows[0].warehouse_id));
    }
    const product = async (stock: number[], price = "39.00") => {
      const id = randomUUID();
      const p = await pool.query(
        "INSERT INTO products(sku,name,category,list_price) VALUES($1,$2,$3,$4) RETURNING product_id",
        [id, `Customer test ${run} ${id}`, `test-${run}`, price],
      );
      const productId = Number(p.rows[0].product_id),
        lots: number[] = [];
      for (const [i, q] of stock.entries()) {
        const l = await pool.query(
          "INSERT INTO lots(product_id,lot_code,received_at) VALUES($1,$2,now()) RETURNING lot_id",
          [productId, `${id}-${i}`],
        );
        const lot = Number(l.rows[0].lot_id);
        lots.push(lot);
        await pool.query(
          "INSERT INTO inventory_balances(lot_id,warehouse_id,on_hand) VALUES($1,$2,$3)",
          [lot, warehouses[i], q],
        );
        if (q)
          await pool.query(
            "INSERT INTO stock_movements(lot_id,warehouse_id,event_type,on_hand_delta,reference_type,reference_id,idempotency_key) VALUES($1,$2,'test_receipt',$3,'test',0,$4)",
            [lot, warehouses[i], q, randomUUID()],
          );
      }
      return { id: productId, lots };
    };
    const destination = {
      name: "Test Customer",
      line1: "42 Sample Street",
      city: "Brooklyn",
      region: "east",
      postal_code: "11201",
      country_code: "US",
    };
    const body = (id: number, quantity: number) => ({
      destination,
      items: [{ product_id: id, quantity }],
    });
    const request = async (
      path: string,
      auth: AuthenticatedUser | null = actor,
      method = "GET",
      payload?: unknown,
      key?: string,
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(auth
            ? { authorization: `Bearer ${issueAccessToken(auth.userId, 0)}` }
            : {}),
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      return { status: response.status, data: (await response.json()) as any };
    };
    await t.test(
      "five units, ten independent transactions: exactly five succeed and ledger reconciles",
      async () => {
        const p = await product([5, 0, 0]);
        const clients = await Promise.all(
          Array.from({ length: 10 }, () => pool.connect()),
        );
        const pids = await Promise.all(
          clients.map((c) => c.query("SELECT pg_backend_pid() AS pid")),
        );
        assert.equal(new Set(pids.map((r) => r.rows[0].pid)).size, 10);
        clients.forEach((c) => c.release());
        const results = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            createOrder(actor, body(p.id, 1), randomUUID()),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
        assert.equal(results.filter((r) => r.status === "rejected").length, 5);
        for (const r of results)
          if (r.status === "rejected") assert.equal(r.reason.status, 409);
        const balance = await pool.query(
          "SELECT on_hand,reserved,unavailable,available FROM inventory_balances WHERE lot_id=$1",
          [p.lots[0]],
        );
        assert.deepEqual(balance.rows[0], {
          on_hand: 5,
          reserved: 5,
          unavailable: 0,
          available: 0,
        });
        const counts = await pool.query(
          "SELECT count(*)::integer AS count FROM order_items WHERE product_id=$1",
          [p.id],
        );
        assert.equal(counts.rows[0].count, 5);
        const ledger = await pool.query(
          "SELECT sum(reserved_delta)::integer AS reserved FROM stock_movements WHERE lot_id=$1",
          [p.lots[0]],
        );
        assert.equal(ledger.rows[0].reserved, 5);
      },
    );
    await t.test(
      "simultaneous idempotent retry and changed-payload conflict",
      async () => {
        const p = await product([5, 0, 0]),
          key = randomUUID();
        const [a, b] = await Promise.all([
          createOrder(actor, body(p.id, 2), key),
          createOrder(actor, body(p.id, 2), key),
        ]);
        assert.equal(a.order.order_id, b.order.order_id);
        assert.equal(Number(a.replayed) + Number(b.replayed), 1);
        await assert.rejects(
          createOrder(actor, body(p.id, 3), key),
          (e) => (e as any).status === 409,
        );
        const stock = await pool.query(
          "SELECT reserved FROM inventory_balances WHERE lot_id=$1",
          [p.lots[0]],
        );
        assert.equal(stock.rows[0].reserved, 2);
      },
    );
    await t.test(
      "multi-item shortage leaves no orders or reservations for either line",
      async () => {
        const a = await product([3, 0, 0]),
          b = await product([0, 0, 0]);
        await assert.rejects(
          createOrder(
            actor,
            {
              destination,
              items: [
                { product_id: a.id, quantity: 2 },
                { product_id: b.id, quantity: 1 },
              ],
            },
            randomUUID(),
          ),
          (e) => (e as any).status === 409,
        );
        const row = await pool.query(
          "SELECT reserved FROM inventory_balances WHERE lot_id=ANY($1::bigint[])",
          [[...a.lots, ...b.lots]],
        );
        assert(row.rows.every((r) => r.reserved === 0));
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer AS count FROM order_items WHERE product_id=ANY($1::bigint[])",
              [[a.id, b.id]],
            )
          ).rows[0].count,
          0,
        );
      },
    );
    await t.test(
      "split order traces two warehouses/lots; prices are purchase-time snapshots",
      async () => {
        const p = await product([3, 2, 0]);
        const o = await createOrder(actor, body(p.id, 5), randomUUID());
        assert.deepEqual(
          o.order.allocations.map((a) => [
            a.warehouse_id,
            a.allocated_quantity,
          ]),
          [
            [warehouses[0], 3],
            [warehouses[1], 2],
          ],
        );
        assert.equal(new Set(o.order.allocations.map((a) => a.lot_id)).size, 2);
        assert.equal(o.order.shipments.length, 0);
        await pool.query(
          "UPDATE products SET list_price=99.00 WHERE product_id=$1",
          [p.id],
        );
        const read = await request(`/api/orders/${o.order.order_id}`);
        assert.equal(read.status, 200);
        assert.equal(read.data.items[0].unit_price, "39.00");
      },
    );
    await t.test(
      "real HTTP authentication, role, ownership and validation protections",
      async () => {
        const p = await product([4, 0, 0]);
        const o = await createOrder(actor, body(p.id, 2), randomUUID());
        assert.equal(
          (await request(`/api/orders/${o.order.order_id}`, null)).status,
          401,
        );
        assert.equal(
          (await request(`/api/orders/${o.order.order_id}`, other)).status,
          404,
        );
        assert.equal(
          (await request(`/api/orders/${o.order.order_id}`, employee)).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/api/orders/${o.order.order_id}/cancellations`,
              other,
              "POST",
              {
                items: [
                  {
                    order_item_id: o.order.items[0]!.order_item_id,
                    quantity: 1,
                  },
                ],
              },
              randomUUID(),
            )
          ).status,
          404,
        );
        const validation = await request(
          "/api/orders",
          actor,
          "POST",
          { ...body(p.id, 1), customer_id: other.customerId },
          randomUUID(),
        );
        assert.equal(validation.status, 400);
        assert.equal(
          (
            await request(
              "/api/orders",
              actor,
              "POST",
              body(p.id, 1),
              "bad-key",
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("/api/orders?cursor=invalid", actor)).status,
          400,
        );
        const list = await request("/api/orders", other);
        assert.equal(list.data.data.length, 0);
      },
    );
    // Test fixture only: demonstrates the shared dispatch locking protocol, not Member 3's implementation.
    async function dispatch(
      orderId: number,
      quantity: number,
      delivered: boolean,
    ) {
      return transaction(async (c) => {
        await c.query(
          "SELECT order_id FROM orders WHERE order_id=$1 FOR UPDATE",
          [orderId],
        );
        const result = await c.query(
          "SELECT * FROM allocations WHERE order_id=$1 ORDER BY allocation_id FOR UPDATE",
          [orderId],
        );
        const a = result.rows[0];
        assert(a);
        if (
          a.allocated_quantity - a.shipped_quantity - a.released_quantity <
          quantity
        )
          throw new Error("No reserved units remain");
        await c.query(
          "UPDATE inventory_balances SET on_hand=on_hand-$3,reserved=reserved-$3 WHERE lot_id=$1 AND warehouse_id=$2",
          [a.lot_id, a.warehouse_id, quantity],
        );
        await c.query(
          "UPDATE allocations SET shipped_quantity=shipped_quantity+$2,status=CASE WHEN shipped_quantity+$2=allocated_quantity THEN 'shipped' ELSE 'partially_shipped' END WHERE allocation_id=$1",
          [a.allocation_id, quantity],
        );
        const s = await c.query(
          "INSERT INTO shipments(order_id,warehouse_id,status,shipped_at,delivered_at) VALUES($1,$2,$3,now(),CASE WHEN $4 THEN now() ELSE NULL END) RETURNING shipment_id",
          [
            orderId,
            a.warehouse_id,
            delivered ? "delivered" : "shipped",
            delivered,
          ],
        );
        const si = await c.query(
          "INSERT INTO shipment_items(shipment_id,order_id,warehouse_id,allocation_id,lot_id,quantity) VALUES($1,$2,$3,$4,$5,$6) RETURNING shipment_item_id",
          [
            s.rows[0].shipment_id,
            orderId,
            a.warehouse_id,
            a.allocation_id,
            a.lot_id,
            quantity,
          ],
        );
        await c.query(
          "INSERT INTO stock_movements(lot_id,warehouse_id,event_type,on_hand_delta,reserved_delta,reference_type,reference_id,idempotency_key) VALUES($1,$2,'test_dispatch',$3,$3,'order',$4,$5)",
          [a.lot_id, a.warehouse_id, -quantity, orderId, randomUUID()],
        );
        return Number(si.rows[0].shipment_item_id);
      });
    }
    await t.test(
      "partial cancellation excludes shipped units, releases stock, and replays safely",
      async () => {
        const p = await product([5, 0, 0]);
        const o = await createOrder(actor, body(p.id, 5), randomUUID());
        await dispatch(o.order.order_id, 3, false);
        const input = {
            items: [
              { order_item_id: o.order.items[0]!.order_item_id, quantity: 2 },
            ],
          },
          key = randomUUID();
        const canceled = await cancelOrder(actor, o.order.order_id, input, key);
        assert.equal(canceled.items[0]!.cancelled_quantity, 2);
        assert.equal(canceled.items[0]!.shipped_quantity, 3);
        assert.equal(
          (await cancelOrder(actor, o.order.order_id, input, key)).items[0]!
            .cancelled_quantity,
          2,
        );
        await assert.rejects(
          cancelOrder(
            actor,
            o.order.order_id,
            {
              items: [
                { order_item_id: o.order.items[0]!.order_item_id, quantity: 1 },
              ],
            },
            randomUUID(),
          ),
          (e) => (e as any).status === 409,
        );
        const stock = await pool.query(
          "SELECT on_hand,reserved,available FROM inventory_balances WHERE lot_id=$1",
          [p.lots[0]],
        );
        assert.deepEqual(stock.rows[0], {
          on_hand: 2,
          reserved: 0,
          available: 2,
        });
      },
    );
    await t.test(
      "dispatch versus cancellation race never ships and releases the same unit",
      async () => {
        for (let i = 0; i < 5; i++) {
          const p = await product([1, 0, 0]);
          const o = await createOrder(actor, body(p.id, 1), randomUUID());
          const outcomes = await Promise.allSettled([
            dispatch(o.order.order_id, 1, false),
            cancelOrder(
              actor,
              o.order.order_id,
              {
                items: [
                  {
                    order_item_id: o.order.items[0]!.order_item_id,
                    quantity: 1,
                  },
                ],
              },
              randomUUID(),
            ),
          ]);
          assert.equal(
            outcomes.filter((x) => x.status === "fulfilled").length,
            1,
          );
          const a = await pool.query(
            "SELECT shipped_quantity,released_quantity FROM allocations WHERE order_id=$1",
            [o.order.order_id],
          );
          assert.equal(
            a.rows[0].shipped_quantity + a.rows[0].released_quantity,
            1,
          );
        }
      },
    );
    await t.test(
      "concurrent returns cannot exceed delivered units; replay remains bounded",
      async () => {
        const p = await product([3, 0, 0]);
        const o = await createOrder(actor, body(p.id, 3), randomUUID());
        const si = await dispatch(o.order.order_id, 3, true);
        const input = {
          items: [{ shipment_item_id: si, quantity: 2, reason: "not working" }],
        };
        const keys = [randomUUID(), randomUUID()];
        const results = await Promise.allSettled(
          keys.map((k) => createReturn(actor, input, k)),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const success = results.findIndex((r) => r.status === "fulfilled");
        const replay = await createReturn(actor, input, keys[success]!);
        assert(replay.replayed);
        await assert.rejects(
          createReturn(
            actor,
            {
              items: [{ shipment_item_id: si, quantity: 1, reason: "changed" }],
            },
            keys[success]!,
          ),
          (e) => (e as any).status === 409,
        );
        assert.equal(
          (await request("/api/returns", other, "POST", input, randomUUID()))
            .status,
          404,
        );
        await createReturn(
          actor,
          {
            items: [
              { shipment_item_id: si, quantity: 1, reason: "not working" },
            ],
          },
          randomUUID(),
        );
        const detail = await request(`/api/orders/${o.order.order_id}`);
        assert.equal(detail.data.shipments[0].items[0].returnable_quantity, 0);
      },
    );
    await t.test(
      "catalog excludes unavailable/quarantined units and uses bounded cursors",
      async () => {
        const p = await product([6, 0, 0]);
        await pool.query(
          "UPDATE inventory_balances SET reserved=1,unavailable=2 WHERE lot_id=$1",
          [p.lots[0]],
        );
        const result = await request(
          `/api/products/${p.id}/availability`,
          null,
        );
        assert.equal(result.status, 200);
        assert.equal(result.data.available_quantity, 3);
        await pool.query(
          "UPDATE lots SET status='quarantined' WHERE lot_id=$1",
          [p.lots[0]],
        );
        assert.equal(
          (await request(`/api/products/${p.id}/availability`, null)).data
            .available_quantity,
          0,
        );
        const first = await request(
          `/api/products?category=test-${run}&limit=2&sort=price_asc`,
          null,
        );
        assert.equal(first.data.data.length, 2);
        assert(first.data.page.next_cursor);
        const second = await request(
          `/api/products?category=test-${run}&limit=2&sort=price_asc&cursor=${first.data.page.next_cursor}`,
          null,
        );
        assert.equal(second.status, 200);
        assert(
          !second.data.data.some((p: any) =>
            first.data.data.some((a: any) => a.product_id === p.product_id),
          ),
        );
        const history = await request("/api/orders?limit=2");
        assert(history.data.page.next_cursor);
        const next = await request(
          `/api/orders?limit=2&cursor=${history.data.page.next_cursor}`,
        );
        assert.equal(next.status, 200);
        assert(
          !next.data.data.some((o: any) =>
            history.data.data.some((a: any) => a.order_id === o.order_id),
          ),
        );
      },
    );
  },
);
