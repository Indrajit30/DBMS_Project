# Fieldwork customer prototype

Member 2 deliverable for Multiwarehouse Order Fulfillment and Returns. Based on `02_Member_Customer_Orders.pdf` and `Multiwarehouse_Complete_Project_Summary.pdf`, including the original ER figures. The individual assignment's later React/Express monorepo instructions take precedence over historical Flask/layout sketches.

This is a local, fixture-based React/TypeScript/Vite customer prototype. Products, prices, addresses, warehouse stock, lots, order history and tracking events are fictional. No database, authentication, payment or carrier connection exists. Changes reset on reload; one browser session is not a concurrency or security boundary. Midterm was October 22, 2026; final materials are due December 9, with the final presentation December 10. Deliverables were prepared after the listed midterm date; no prior submission is asserted.

## Run

Prerequisites: Node 22.18+ (preview tests use Node's TypeScript stripping), npm and network access for first dependency installation.

```sh
cd docs/midterm/customer/prototype
npm ci
npm run dev
```

Open the Local URL printed by Vite. The preview imports the reusable UI directly from `apps/web/src/features/customer/`. It has its own package files so root workspace tooling stays under Member 1's control. After team integration, use the shared web app and remove this runner only by agreement.

```sh
npm run build
npm test
npm run test:browser  # with the preview running and Chrome installed
```

To regenerate only the PDF after screenshots exist, run `npm run presentation:pdf`. Browser tests can run with the preview server started in a separate terminal.

The production output is `prototype/dist/`. Serve it through an HTTP static server; it uses relative asset URLs. The prototype uses state navigation, not production routes. Back/forward navigation and deep links are integration-stage work.

## Screens and journey

- Catalog: search, category filter, price sorting, out-of-stock products and selectable loading/empty/error examples.
- Product detail: description, price, warehouse availability and quantity validation; quantity 5 on Arc Wireless Mouse demonstrates a split.
- Bag: quantity editing, removal and empty state.
- Checkout: fictional address and region, sample zero shipping/tax, simulated payment, busy state and controllable stock-conflict failure. No inventory hold is created by adding to bag.
- Confirmation: order total, warehouse-specific shipment plans, quantities and fictional lot references. All new orders remain reserved until a staff integration exists.
- Orders: session history plus an independent, partially delivered historical fixture.
- Tracking/manage: simulated timeline, shipped-versus-unshipped quantities, partial cancellation with confirmation and eligible return initiation.
- Returns: delivered shipment item selection, quantity, reason, requested status and RMA. Returned quantities do not become sellable stock.

Expand “Presentation controls” at the bottom to start the five-mouse story, open the delivered sample, demonstrate alternate UI states, or reset. These controls belong to the mockup and are not part of production customer navigation.

## Presentation assets

Open `customer-walkthrough.pdf` for the three-page presentation board, or `presentation.html` for the printable HTML version. Six captured screen images are under `screenshots/`.

See `walkthrough.md`, `allocation-example.md`, `assumptions-and-integration.md`, `verification.md` and `screenshots/`. Pitch copy is under `pitch/customer/`. Integration proposal is `docs/requests/customer.md`.

## Ownership

UI, provisional adapter types, local fixtures, original SVG product illustrations, styles and adapter tests live under `apps/web/src/features/customer/`. This statement describes the original midterm mockup phase. Customer APIs and live mode were subsequently added after the team repo was supplied; see `../../customer-integration.md`. No migrations, auth implementation, root package files, shared types, warehouse or manager workflows were changed by that integration. The preview runner and customer docs use the user-approved `docs/midterm/customer/` destination. All code runs without the other members' infrastructure.

## Subsequent team integration

Run the customer preview on port 5174 and open `?mode=live` for the actual database-backed module. Default mode remains the independent fictional midterm experience. Setup, API behavior and current verification live in `docs/customer-integration.md` and `docs/customer-verification.md`.
