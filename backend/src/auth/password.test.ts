import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("password hashes verify only the original password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.notEqual(hash, "correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("different password", hash), false);
});

test("malformed synthetic hashes never authenticate", async () => {
  assert.equal(await verifyPassword("anything", "!synthetic-no-login!"), false);
});
