# Member 2 customer feature

Reusable React/TypeScript customer screens for the Fieldwork fictional retailer. Run the isolated local preview from `docs/midterm/customer/prototype/`; see `docs/midterm/customer/README.md` for commands and presentation flow.

## Files

- `CustomerApp.tsx`: fixture-based state navigation, catalog, product detail, cart, checkout, order confirmation/history, tracking, partial cancellation and delivered-item return request.
- `components/ProductArt.tsx`: original inline SVG product illustrations, without external assets.
- `fixtures/catalog.ts`: deterministic fictional catalog and three-warehouse available-stock snapshots.
- `adapters/mock.ts`: provisional local types and a simulated all-or-nothing, idempotent ordering adapter. These types are not shared API contracts.
- `adapters/mock.test.ts`: Node tests for local allocation, rollback and idempotency behavior.
- `styles/customer.css`: scoped entry styles for the isolated preview; integrate with team tokens before mounting in the shared web app. Currently includes document/global selectors, so it must not be imported into a teammate's app without that consolidation.

## Integration boundary

Replace local adapter DTOs through a mapping layer importing approved `packages/contracts` types. Mount screens through the shared router and auth boundary, replace fixtures with an HTTP adapter, and apply team design tokens. The browser must never connect to PostgreSQL. Real backend work belongs under Member 2's `apps/api/src/modules/catalog/` and `apps/api/src/modules/orders/`, after contract freeze.

`docs/requests/customer.md` proposes endpoints, fields, dependencies and transaction rules. The preview's synchronous local stock mutation is not a substitute for database locks or authorization. Historical shipment timelines are immutable presentation fixtures, not warehouse workflow implementations.

The original mockup was created before the repository was supplied. It is now in the actual team checkout on feature/customer. LiveCustomerApp.tsx and adapters/http.ts implement the database-backed mode; see docs/customer-integration.md for current setup and backend handoff.

## Live mode

`LiveCustomerApp.tsx` uses Member 1's actual auth and snake_case API conventions. `adapters/http.ts` imports the existing shared request types. The provisional mock adapter remains independent. Open `?mode=live` through the preview runner; the default keeps the presentation fixtures. Current backend implementation lives in backend/src/modules/catalog and backend/src/modules/orders.
