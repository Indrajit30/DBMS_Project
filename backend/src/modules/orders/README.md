# Customer ordering module — Member 2

Integrates with Member 1's existing Express app, PostgreSQL pool, transaction helper, auth middleware, schema and shared request types. Companion catalog routes live in `../catalog/`. No migrations, shared contract files, authentication implementation or warehouse receiving/inspection code are added.

## Run with the team backend

From `backend/`, install dependencies and follow the root README to configure `.env`, migrate and seed a development database. `npm run dev` now includes the registered customer routes. Do not seed or run tests against a shared/production database without the team's data-management process.

Customer route registration in `src/app.ts` and the two-line `getJwtSecret()` narrowing fix in `src/config.ts` were explicitly approved by the user. Other shared files are unchanged.

## API behavior

Exact requests come from `src/shared/contracts.ts`; read DTOs are module-local in `dto.ts`, pending Member 1's promotion to shared contracts. All JSON uses snake_case. Prices are PostgreSQL exact decimal strings; the UI calculates display values in minor units. Initial currency is USD; no tax, shipping-cost calculation or real payment.

Public catalog: GET `/api/products`, `/api/products/:productId`, `/api/products/:productId/availability`. Search by name/SKU, exact category filter, featured/price sort, bounded cursor pages. Availability excludes inactive products/warehouses and non-active/expired lots and subtracts reserved/unavailable inventory.

Customer-authenticated: POST/GET `/api/orders`, GET `/api/orders/:orderId`, POST `/api/orders/:orderId/cancellations`, POST `/api/returns`. A manager/employee cannot use these customer write routes. Every resource lookup scopes to the authenticated customer; foreign resources return 404.

For each mutation send an `Idempotency-Key` UUID. UUID casing is normalized. Orders are uniquely keyed by customer and request_id; successful retries return the same order (200, versus 201 new) and do not reserve again. Payload mismatch returns 409. Cancellation uses operation-scoped advisory coordination plus immutable audit fingerprints. Returns replay immutable requested shipment-item/quantity/reason records. No failed request is persisted as a successful operation. `x-request-id` remains separate shared per-request tracing.

Placement locks eligible product/warehouse/lot rows, then inventory balances in deterministic order, and rechecks authoritative availability. It first chooses one warehouse that can satisfy all lines; otherwise splits by descending per-product warehouse availability, stable warehouse-ID tie-break and FIFO lot order. All orders/items/allocations/reservations/movements/audit records commit together or roll back. Retry only PostgreSQL 40001/40P01, at most three attempts. No backorders or temporary cart holds.

Cancellation locks the own order and allocations, releases only still-reserved unshipped units, updates item quantities and appends stock movements/audit in the same transaction. Repeated or excessive quantities conflict. Return requests require delivered shipment status and timestamp, bound cumulative requested/received units, retain lot trace through shipment items, and create requested RMAs only. Already received units on rejected requests remain ineligible for another return.

Placement does not create shipment headers or dispatch events. Customer UI groups allocations as reserved fulfillment plans until Member 3 records actual shipments. `docs/requests/customer.md` records required lock/status policy coordination with Member 3. Integration tests use a clearly labeled fixture dispatch; they do not verify Member 3's absent code.

## Test commands

The current root `npm test` script passes `src` as a file to Node and fails on the available Node 25 runtime (`ERR_UNSUPPORTED_DIR_IMPORT`). No shared package script was changed. Run explicit files:

```sh
npm run typecheck
node --import tsx --test src/auth/*.test.ts src/modules/orders/allocation.test.ts src/modules/orders/validation.test.ts
```

Database tests opt in and require a dedicated database named `customer_test`. Apply Member 1's unchanged migration chain to an EMPTY test database first. Tests insert fictional users, products, lots and orders; they do not truncate or modify a team database. Each run uses fresh fixture IDs.

```sh
CUSTOMER_TEST_DATABASE_URL=postgresql://test_user@127.0.0.1:55439/customer_test \
  node --import tsx --test src/modules/orders/integration.test.ts
```

Coverage: five units/ten independent connections; simultaneous same-key retries; mismatched payload; multi-item shortage; 3+2 lot trace; purchase-price snapshots; HTTP auth/role/ownership/validation; partial cancellation and replay; dispatch/cancellation races; concurrent returns; public availability and catalog/order pagination. Assertions reconcile reservation ledger quantities. No full-scale performance claims.

## HTTP examples

Use a purpose-created local customer account with the shared login route. Substitute actual IDs and a freshly generated UUID for `KEY` (the bare word KEY is not a valid key):

```http
POST /api/orders
Authorization: Bearer <access_token>
Idempotency-Key: <UUID>
Content-Type: application/json

{"destination":{"name":"Demo Customer","line1":"42 Sample Street","city":"Brooklyn","region":"east","postal_code":"11201","country_code":"US"},"service_level":"standard","items":[{"product_id":1,"quantity":5}]}
```

```http
POST /api/orders/1/cancellations
Authorization: Bearer <access_token>
Idempotency-Key: <different UUID>
Content-Type: application/json

{"items":[{"order_item_id":1,"quantity":2}]}
```

```http
POST /api/returns
Authorization: Bearer <access_token>
Idempotency-Key: <different UUID>
Content-Type: application/json

{"items":[{"shipment_item_id":1,"quantity":1,"reason":"Not working as expected"}]}
```

## Live UI and test fixtures

UI entry: `apps/web/src/features/customer/LiveCustomerApp.tsx`; HTTP adapter imports the shared request types and maps module read DTOs. An isolated Vite runner under `docs/midterm/customer/prototype/` proxies `/api` to localhost:3000. Browse `/?mode=live`; the original midterm fixture experience remains the default/`?mode=mock`.

`fixtures/browser.ts` is a TEST-ONLY script guarded to `current_database() = customer_test`. After the shared local seed in that isolated database, it prepares a fresh 3+2 checkout product and one own partially delivered order with simulated events, and writes non-secret fixture IDs to the ignored preview fixture JSON. This does not implement a staff dispatch/inspection workflow. Use only for the opt-in browser checks documented in `docs/customer-integration.md`.
