# Customer integration verification — November 20, 2026

Checkout: actual `Indrajit30/DBMS_Project`, local branch `feature/customer`. Existing shared schema/auth/contracts reused. Tests used a newly initialized isolated PostgreSQL cluster under /tmp on localhost:55439, database customer_test. No shared or production database was used.

## Results

- Backend `npm run typecheck`: passed after the user-approved two-line getJwtSecret narrowing fix.
- Explicit combined backend test command: **20 passed**, zero failures/skips. This includes four existing auth tests, three allocation tests, three strict validation/key tests, nine PostgreSQL/HTTP scenario subtests and their parent test.
- Ten-request reservation test held ten independent pg clients and verified ten distinct PostgreSQL backend PIDs. With five units, exactly five orders succeeded and five returned stock conflicts. Reserved quantity and reservation ledger delta were exactly five; no partial failed orders were inserted.
- Simultaneous same-key requests returned the same order once; a changed payload conflicted. Two-item shortage left both balances and order-item rows unchanged.
- Split reservation traced three units and two units through different warehouse/lot allocations. Later catalog price changes did not alter purchase-time unit_price. No shipment was invented by ordering.
- HTTP tests covered missing authentication (401), employee role denial (403), another customer's order/cancel/return IDs (404), invalid requests/keys/cursors (400), and own-only history.
- Cancellation released only the unshipped remainder, retained shipped quantities, and replayed without a second stock release. Five dispatch-versus-cancel fixture races accepted only one competing operation per unit. These tests exercise a documented fixture protocol, not Member 3's absent dispatch code.
- Concurrent return requests could not exceed delivered quantity; successful replay did not add another request. Customer return initiation did not restock inventory.
- Availability subtracted reserved/unavailable quantities and excluded quarantined lots. Catalog and order-history cursor pages did not repeat boundary rows.
- Frontend `npm run build`: passed (strict TypeScript plus Vite production build).
- Frontend mock adapter `npm test`: **6 passed**.
- Preserved midterm browser checks: **5 passed**, including search/mobile, split checkout, stock conflict, cancellation/return bounds and PDF export.
- Live browser checks: **2 passed**. Real shared login → product availability → bag → five-unit 3+2 database checkout → own history → cancellation. Separate fixture → actual recorded simulated shipment events → eligible customer return request. Both use only the isolated database and purpose-created demo credentials.

Browser captures: `docs/midterm/customer/screenshots/07-live-split-order.png` and `08-live-tracking-return.png`. Live order IDs/lot codes are synthetic test data. Midterm screenshot/PDF assets remain fictional fixture-based presentation material and are labeled accordingly.

## Known shared tooling issue

The unchanged backend package script `npm test` invokes `node --import tsx --test src`. On this machine's Node 25 this fails with ERR_UNSUPPORTED_DIR_IMPORT. No shared package file was changed. The actual passing command is:

```sh
CUSTOMER_TEST_DATABASE_URL=postgresql://customer_test@127.0.0.1:55439/customer_test \
  node --import tsx --test src/auth/*.test.ts src/modules/orders/*.test.ts
```

Use a separately prepared test database and your own test role/connection configuration; the example host/user belongs only to this session's isolated cluster. Normal unit-only execution omits the opt-in integration URL. Setup is in `docs/customer-integration.md`.

## Limits

No production deployment, shared-database load, million-row benchmark, real carrier/payment, receiving/inspection, manager workflow, or end-to-end integration with Member 3 code has been verified. Member 3 must adopt the compatible lock/status protocol; domain/service-region and return-window policies remain documented team agreements. No measured performance gain is claimed.

The only shared edits are the explicitly approved app.ts router imports/mounts and two config.ts references. Migrations, shared types, auth, seed, generator, root README and package files are unchanged. Local runtime files/dependencies and test fixture IDs are ignored. No remote push or PR publication has been performed.
