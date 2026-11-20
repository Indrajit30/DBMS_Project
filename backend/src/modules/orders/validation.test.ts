import test from "node:test";
import assert from "node:assert/strict";
import { createOrderSchema, parse, positiveId, key } from "./validation.js";
const destination = {
  name: "Sample",
  line1: "42 Sample Street",
  city: "Brooklyn",
  region: "east",
  postal_code: "11201",
  country_code: "US",
};
test("body IDs require numbers; path IDs require positive integer strings", () => {
  assert.throws(() =>
    parse(createOrderSchema, {
      destination,
      items: [{ product_id: true, quantity: 1 }],
    }),
  );
  assert.throws(() =>
    parse(createOrderSchema, {
      destination,
      items: [{ product_id: "1", quantity: 1 }],
    }),
  );
  for (const id of ["1.5", "1e3", "-1", "0", true])
    assert.throws(() => positiveId(id));
  assert.equal(positiveId("42"), 42);
});
test("UUID idempotency keys normalize case before advisory locking", () =>
  assert.equal(
    key("ABCDEF00-1234-4234-8234-123456789ABC"),
    "abcdef00-1234-4234-8234-123456789abc",
  ));
test("duplicate products cannot overrun a single allocation plan", () =>
  assert.throws(() =>
    parse(createOrderSchema, {
      destination,
      items: [
        { product_id: 1, quantity: 2 },
        { product_id: 1, quantity: 3 },
      ],
    }),
  ));
