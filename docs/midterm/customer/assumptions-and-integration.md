# Assumptions and staged handoff

## Independent work completed in this phase

The React customer feature, an isolated Vite preview runner, deterministic fictional fixtures, typed local mock adapter, illustrations and presentation materials. Local adapter interfaces deliberately remain inside the customer folder and are not advertised as approved shared types. No backend or database schema is needed to view or present this phase.

Visual direction: deep green, off-white, muted product-specific illustration backgrounds, readable sans-serif type, simple cards and quantity-aware shipment panels. No shared design tokens exist yet; consolidate these provisional tokens with the other members before integration. Product illustrations are original inline SVG, require no remote images or third-party font service, and are not photographs of real products.

## Explicit preview limitations

- All service regions are assumed eligible. A stock-based three-warehouse routing policy is a proposal, not an approved production algorithm.
- Availability values are fixed presentation snapshots. Successful sample orders consume local adapter stock, but catalog counts stay illustrative. UI cancellation updates the displayed sample order only; it does not restore the adapter's remaining stock. Reload resets the session.
- No authentication or real customer isolation exists in this public-fictional-data preview. Production identity and authorization come from Member 1's middleware, enforced on every route.
- New sample orders remain reserved. They never gain fake dispatch progress automatically. Historical order FW-1038 has a separate fixed delivered timeline to illustrate tracking and returns.
- Sample timelines are immutable; no staff dispatch, receiving, inspection, quarantine, refund or replacement actions are implemented.
- Cancellation/return quantities are checked in browser state for demonstration. They cannot prove database concurrency safety.
- The return fixture illustrates delivered-item eligibility without choosing a final return window. Refund, exchange, replacement, tax and shipping policies require team agreement.
- Sample requests have local replay checks, but no durable idempotency persistence or cross-tab/server coordination. Retry records reset on reload. No real server reliability or performance claims are made.
- Preview navigation is in React state. Integration must add the team's router and protected/deep-link routes.

## Next stages and completion gates

1. **Contract freeze:** Member 1 supplies the shared scaffold/auth/DB interfaces and approves `docs/requests/customer.md`; Member 3 agrees status DTOs, shared locks, shipment ownership and return handoff. Import `packages/contracts` only after approval.
2. **Catalog integration:** add catalog SQL/Express handlers under `apps/api/src/modules/catalog/`, shared validation/envelope/error handling and a real customer adapter; verify filters, pagination, missing products and stale availability.
3. **Atomic ordering:** implement under `apps/api/src/modules/orders/`; transaction on one pg client, deterministic locks/rechecks, exact purchase-price and address snapshots, idempotency uniqueness, full rollback and audit. Run independent-connection PostgreSQL concurrency tests.
4. **History and tracking:** authenticated own-order queries, cursor pagination and Member 3's shipment events. Demonstrate that edited URLs and body references cannot expose another customer's records.
5. **Cancellation:** agreed quantity/status transitions and lock ordering with dispatch and quarantine. Test the race against real Member 3 dispatch code.
6. **Return initiation:** delivered shipment-item eligibility, active-request quantity limits and reason validation. Hand off to Member 3; do not implement receiving/inspection.
7. **Scale and final handoff:** real order-history/availability queries over the team's full dataset; EXPLAIN evidence, actual timings and index costs. Team target is at least 1,000,000 order_items, not one million individual units. Provide customer guide and fake role credentials through shared infrastructure.

## Planned PostgreSQL integration tests (NOT run in this phase)

- Five sellable units, ten distinct concurrent one-unit requests on independent connections: exactly five successes and five shortage conflicts; no negative stock, partial records or balance/ledger mismatch.
- Same key/payload after success and uncertain response: same order and no new reservation. Same key/different normalized payload: conflict. Include simultaneous duplicate requests.
- Multi-item failure after one item could be reserved: zero changes to all affected balances, orders, allocations and movements.
- Three units from warehouse A/lot X and two from B/lot Y: allocation, shipment and return-item trace reconciles.
- One warehouse can fill all lines: no unnecessary split. Region-ineligible or quarantined lots excluded even if physical stock exists.
- Customer A cannot list, read, cancel or return customer B's orders, including nested IDs. Unauthenticated requests get 401; inappropriate roles rejected.
- Dispatch/cancellation race: a unit ships or is canceled, never both. Repeated partial cancellation cannot exceed the remaining unshipped quantity.
- Two return requests for the same delivered units: cumulative accepted/active quantity bounded; canceled and undelivered units ineligible.
- Quarantine and transfer reservations racing with ordering: only eligible stock reserved, invariants/audit preserved with global lock order.
- Bounded deadlock/serialization retries; interruption before commit leaves no partial writes, while retry after commit replays safely.

## Customer permissions

Read public catalog and indicative availability. Read only own order lines, shipments, events and return requests. Write own order placement, eligible unshipped cancellation and eligible delivered-item return requests. No direct stock, price, dispatch, inspection, manager, warehouse or user-role changes. UI visibility is not authorization.
