# Customer module integration and setup

Member 2 implementation in the actual team repository, on local branch `feature/customer`. The prior standalone midterm assets are preserved under `docs/midterm/customer/` and `pitch/customer/`. Member 1's backend layout takes precedence over the planning PDF's proposed apps/api layout.

## Start

1. Follow the root README to install backend dependencies, configure `backend/.env`, apply migrations and seed a local development database. Shared auth and migrations are unchanged. Customer route mounts and a two-line config TypeScript fix were explicitly approved.
2. From `backend/`, run `npm run dev` (default port 3000).
3. From `docs/midterm/customer/prototype/`, run `npm ci`, then `npm run dev -- --port 5174`.
4. Open http://127.0.0.1:5174/?mode=live for database-backed shopping. The runner proxies `/api` to localhost:3000. No CORS/auth changes are required. Open http://127.0.0.1:5174/?mode=mock for the original fictional midterm journey.
5. Use the purpose-created local customer account documented in the team's root README, or register a new customer through the UI. No personal account is needed. Bearer tokens remain in memory; a reload requires sign-in and resets the unsaved bag.

No frontend scaffold existed in the team repo, so the customer UI stays in its owned folder and reuses the isolated preview runner; no shared/root package files were introduced. A future team frontend can mount LiveCustomerApp and consolidate CSS/tokens/router configuration. HTTP adapter imports existing shared request types; read DTOs remain module-local pending stewardship.

## What works with real PostgreSQL

Catalog search/category/sort/cursor pagination; per-warehouse availability; shared sign-in/registration; shopping bag; destination checkout and purchase-price snapshots; atomic reservation with single-warehouse preference or deterministic splits; durable retry-safe order creation; own-order history/detail; eligible unshipped cancellation with stock release; reads of Member 3 shipment events; eligible delivered-shipment-item return initiation and RMA status reads.

Real payment/carrier integration is outside scope. Warehouse shipment creation/dispatch, receiving, inspection, quarantine, transfers and manager workflows are not implemented by Member 2. A new order displays reserved fulfillment plans, not invented dispatched packages. Refresh order/tracking reads actual recorded events; nothing advances on a customer-controlled timer.

## Remaining team agreements

`docs/requests/customer.md` records exact payloads, read DTOs, active-warehouse domestic-US eligibility baseline, allocation rule, return eligibility, idempotency persistence and the proposed global lock protocol. Member 3 must coordinate dispatch/cancellation/quarantine locks and shipment-item/status handling. Return window, refunds/replacements and shipping/tax policy remain team decisions. Do not claim the fixture dispatch tests prove Member 3's implementation.

## Isolated verification

Use a separate empty database named `customer_test`, never a shared deployment. Apply the unchanged migration using the team's runner. The integration tests add fresh fictional fixtures and verify the database name before inserting. For the session verification, an isolated temporary PostgreSQL cluster ran on localhost:55439; the existing shared database was not accessed.

```sh
cd backend
npm run typecheck
node --import tsx --test src/auth/*.test.ts src/modules/orders/allocation.test.ts src/modules/orders/validation.test.ts
CUSTOMER_TEST_DATABASE_URL=postgresql://test_user@127.0.0.1:55439/customer_test node --import tsx --test src/modules/orders/integration.test.ts
```

The repository's pre-existing `npm test` command is incompatible with Node 25's directory handling. Use the explicit command above; Member 1 can update that shared script separately.

For live browser checks, first use the shared local seed on the isolated DB, then prepare test-only delivery fixtures:

```sh
# From backend/, with DATABASE_URL and JWT_SECRET set for customer_test:
node --import tsx src/modules/orders/fixtures/browser.ts
# Keep the API on port 3000 and Vite on port 5174 running.
cd ../docs/midterm/customer/prototype
CUSTOMER_LIVE_TEST=1 npx playwright test tests/live.spec.ts
```

Those browser tests use the purpose-created `customer@local.test` account and the local-only password supplied by Member 1's seed. Fixture IDs are saved to an ignored local JSON file, not committed. Tests place/cancel a five-unit 3+2 order and request a return against a separate fixture's delivered units. Rerun the fixture script before rerunning the live suite; each run creates a fresh product/order.

```sh
# From the preview runner:
npm run build
npm test
npx playwright test tests/customer.spec.ts
```

The last command checks the preserved mock experience and exports the three-page presentation PDF. `CUSTOMER_PREVIEW_URL` can override the browser base URL. Chrome is configured as the browser channel. Actual results and limits are in `docs/customer-verification.md`.
