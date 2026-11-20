import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "unit-test-secret-that-is-at-least-thirty-two-characters";

const { issueAccessToken, readAccessToken } = await import("./token.js");

test("access tokens preserve the user ID and auth version", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const token = issueAccessToken(userId, 7);
  assert.deepEqual(readAccessToken(token), { userId, authVersion: 7 });
});

test("invalid bearer tokens are rejected", () => {
  assert.equal(readAccessToken("not-a-jwt"), null);
});
