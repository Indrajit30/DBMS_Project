import test from "node:test";
import assert from "node:assert/strict";
import { planAllocation, type Balance } from "./allocation.js";
const b = (
  product: number,
  warehouse: number,
  available: number,
  lot = product * 10 + warehouse,
): Balance => ({
  product_id: product,
  warehouse_id: warehouse,
  available,
  lot_id: lot,
  received_at: "2026-01-01",
});
test("one warehouse satisfies every line before splitting", () =>
  assert.deepEqual(
    [
      ...new Set(
        planAllocation(
          [
            { product_id: 1, quantity: 3 },
            { product_id: 2, quantity: 2 },
          ],
          [b(1, 1, 2), b(1, 2, 3), b(2, 1, 4), b(2, 2, 2)],
        ).map((a) => a.warehouse_id),
      ),
    ],
    [2],
  ));
test("split uses available stock and preserves lots", () =>
  assert.deepEqual(
    planAllocation(
      [{ product_id: 1, quantity: 5 }],
      [b(1, 1, 3, 101), b(1, 2, 2, 205)],
    ),
    [
      { lot_id: 101, warehouse_id: 1, product_id: 1, quantity: 3 },
      { lot_id: 205, warehouse_id: 2, product_id: 1, quantity: 2 },
    ],
  ));
test("shortage rejects the whole plan", () =>
  assert.throws(
    () =>
      planAllocation(
        [
          { product_id: 1, quantity: 1 },
          { product_id: 2, quantity: 1 },
        ],
        [b(1, 1, 3)],
      ),
    /Insufficient/,
  ));
