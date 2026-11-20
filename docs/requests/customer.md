# Customer integration — actual team repository

Member 2, November 20, 2026. Supersedes the earlier preview-only API proposal. The supplied team repository uses backend/, not apps/api/. Follow its existing Node/Express/TypeScript/pg architecture and snake_case JSON. No migrations, auth, shared types, seed scripts or root package files are changed.

## Existing foundation reused

- `backend/src/shared/contracts.ts`: CreateOrderRequest, CancelOrderRequest, CreateReturnRequest and AddressSnapshot.
- `backend/src/shared/types.ts`: AuthenticatedUser and ListResponse; IDs in shared request contracts are positive safe integers.
- `backend/src/auth/middleware.ts`: requireAuth and requireRoles. Customer routes allow the customer role and scope every order/shipment/return by its customerId.
- `backend/src/db/transaction.ts`: one checked-out pg client per transaction. Customer wrapper adds bounded deadlock/serialization retry around this helper.
- `backend/src/shared/errors.ts`: existing ApiError/errorHandler. Errors retain the shared envelope; no competing {data,error,meta} envelope.

## Owned integration paths

`backend/src/modules/catalog/**`, `backend/src/modules/orders/**`, `apps/web/src/features/customer/**`, `docs/midterm/customer/**`, `docs/requests/customer.md`, `pitch/customer/**`. Customer preview runner remains isolated under docs. No parallel backend or database stack.

## Module routes / response proposal

| Route | Contract |
| --- | --- |
| GET /api/products | q, category, sort (featured/price_asc/price_desc), limit, cursor; ListResponse<ProductSummary> |
| GET /api/products/:productId | ProductSummary |
| GET /api/products/:productId/availability | available_quantity, as_of, warehouses[{warehouse_id,name,region,available_quantity}] |
| POST /api/orders | shared CreateOrderRequest; UUID Idempotency-Key; OrderDetail (201 new, 200 replay) |
| GET /api/orders | own summaries, limit/cursor; shared ListResponse |
| GET /api/orders/:orderId | own OrderDetail |
| POST /api/orders/:orderId/cancellations | shared CancelOrderRequest; UUID Idempotency-Key; updated OrderDetail |
| POST /api/returns | shared CreateReturnRequest; UUID Idempotency-Key; return resource (201/200 replay); all shipment items must belong to one own order |

Product summary: product_id, sku, name, category, list_price (exact decimal string), available_quantity. No invented description/image DB columns. Order detail: existing order fields and destination snapshot, items with purchase-time unit_price, allocated/shipped/cancelled/delivered/returnable quantities, allocation traces with lot and warehouse names, actual shipments/items/events, and return requests/items. These read DTOs stay module-local pending shared-contract stewardship.

## Proposed baseline policy

All active warehouses may fulfill domestic US destinations; warehouse.region is a geographic label, not a service-eligibility table. Expedited/standard currently use the same stock-based rule; no carrier ETA or surcharge is invented. Reject non-US checkout until the team defines service rules. Active products, active/unexpired lots, active warehouses and positive available inventory are eligible. Prefer any one warehouse able to satisfy all lines, tie-break warehouse ID. Otherwise take each product's largest warehouse availability first, tie-break warehouse ID; consume lots by received_at then lot_id. No backorders/partial commits.

Orders reserve allocations only. They do not create or dispatch warehouse-owned shipments. UI groups unshipped allocations as fulfillment plans and displays actual shipment tracking only when Member 3 creates it. Return initiation only: requested status, no authorization, receiving, inspection or restocking. Delivered eligibility requires delivered shipment status/timestamp and subtracts requested quantities in non-rejected requests and any received quantities from rejected requests. No time window is enforced until approved.

## Idempotency without schema edits

Orders use existing UNIQUE(customer_id,request_id). UUID keys are scoped by customer/operation using a transaction-scoped PostgreSQL advisory lock before replay lookup. Canonical normalized payload fingerprints are stored in the same transaction's audit entry, so a changed payload conflicts even after cancellation/price changes. Historical orders without customer-module fingerprint are compared against their immutable item/destination snapshots. Cancel request replay uses immutable audit entries under the same operation lock; return replay compares immutable requested item/quantity/reason records. Keys for cancellations and returns use advisory coordination because no dedicated request table exists. Member 1 may later add a central durable operation registry/index; this module does not create one.

## Shared registration (explicitly approved and applied)

See `backend/src/modules/orders/INTEGRATION.md`: import catalogRouter/ordersRouter into shared app.ts and mount before its 404. No root package, shared type or auth changes are needed. Without that registration, routes are tested through an isolated Express harness and are ready for Member 1 to mount.

## Member 3 lock / transition handoff

All inventory writers must coordinate the same rows. Placement lock order: idempotency advisory lock; product rows ascending; warehouse rows ascending; lot rows ascending (FOR SHARE on eligibility rows); balances ascending (warehouse_id,lot_id). Cancellation locks the order header, allocations ascending allocation_id, then affected balances ascending (warehouse_id,lot_id). Dispatch must lock order then allocation then balances in that same order and update shipped_quantity atomically with on_hand/reserved and movements. Quarantine must coordinate with eligibility row locks before balance mutations; avoid inverse lock acquisition. Return initiation locks order, then shipment items ascending; Member 3's delivery/inspection transitions must coordinate the same order/item state. Bounded retries do not replace an agreed global lock protocol.

## Remaining approvals / dependencies

Member 1: read DTO promotion (app.ts registration was explicitly approved and applied); optional operation registry/index; service-region policy. Member 3: dispatch/cancellation and quarantine lock protocol; actual shipment creation/events; return window, reasons and lifecycle semantics. No Member 3 workflow code is implemented here.

## Pre-existing typecheck blocker: shared config.ts

The unchanged shared `getJwtSecret()` closes over `parsed.data` after a `safeParse` check. Current installed TypeScript reports TS18048 on its two property accesses because control-flow narrowing is not retained in that function. Proposed two-line fix: inside getJwtSecret only, replace both `parsed.data.JWT_SECRET` accesses with `config.JWT_SECRET`. This uses the already validated exported config and preserves behavior. The user separately approved this two-line fix; it has been applied.
