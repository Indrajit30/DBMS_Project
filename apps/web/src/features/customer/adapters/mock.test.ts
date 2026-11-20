import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, createMockAdapter } from "./mock.ts";
test("prefers one warehouse that can satisfy every line", () => {
  const result = allocate([
    { productId: "p1", quantity: 2 },
    { productId: "p2", quantity: 3 },
  ]);
  assert.deepEqual([...new Set(result.map((a) => a.warehouse))], [0]);
});
test("traces five mice through two warehouses and two lots", () => {
  const result = allocate([{ productId: "p1", quantity: 5 }]);
  assert.deepEqual(
    result.map((a) => [a.warehouse, a.quantity, a.lot]),
    [
      [0, 3, "DEMO-p1-1"],
      [1, 2, "DEMO-p1-2"],
    ],
  );
});
test("a failed multi-item checkout does not consume the first item", async () => {
  const adapter = createMockAdapter();
  await assert.rejects(
    adapter.place(
      [
        { productId: "p1", quantity: 5 },
        { productId: "p5", quantity: 1 },
      ],
      "Sample address",
      "Northeast",
      "fail",
    ),
    /Stock changed/,
  );
  const result = await adapter.place(
    [{ productId: "p1", quantity: 5 }],
    "Sample address",
    "Northeast",
    "success",
  );
  assert.equal(
    result.allocations.reduce((n, a) => n + a.quantity, 0),
    5,
  );
});
test("successful retry returns the same order and consumes stock once", async () => {
  const adapter = createMockAdapter();
  const lines = [{ productId: "p1", quantity: 3 }];
  const first = await adapter.place(
    lines,
    "Sample address",
    "Northeast",
    "same",
  );
  assert.deepEqual(
    await adapter.place(lines, "Sample address", "Northeast", "same"),
    first,
  );
  const second = await adapter.place(
    [{ productId: "p1", quantity: 2 }],
    "Sample address",
    "Northeast",
    "new",
  );
  assert.equal(second.allocations[0].quantity, 2);
  await assert.rejects(
    adapter.place(
      [{ productId: "p1", quantity: 1 }],
      "Sample address",
      "Northeast",
      "third",
    ),
    /Stock changed/,
  );
});
test("same key and changed payload conflicts", async () => {
  const adapter = createMockAdapter();
  await adapter.place(
    [{ productId: "p1", quantity: 1 }],
    "Sample address",
    "Northeast",
    "key",
  );
  await assert.rejects(
    adapter.place(
      [{ productId: "p1", quantity: 2 }],
      "Sample address",
      "Northeast",
      "key",
    ),
    /different checkout/,
  );
});
test("rejects missing, fractional, duplicate and unknown lines", () => {
  for (const lines of [
    [],
    [{ productId: "p1", quantity: 1.5 }],
    [{ productId: "p1", quantity: 0 }],
    [{ productId: "unknown", quantity: 1 }],
    [
      { productId: "p1", quantity: 1 },
      { productId: "p1", quantity: 1 },
    ],
  ])
    assert.throws(() => allocate(lines));
});
