# Verification record

Completed November 20, 2026. These results apply to the standalone local customer prototype, not the final PostgreSQL application.

| Check | Command (from prototype/) | Actual result |
| --- | --- | --- |
| Dependency installation | `npm install --no-audit --no-fund` | Completed; package-lock.json saved. Network access approval was needed after sandbox DNS failure. |
| Strict TypeScript and production bundle | `npm run build` | Passed; 32 Vite modules transformed, static output in dist/. Final bundle built after checkout/runtime fixes. |
| Local adapter behavior | `npm test` | 6 tests passed. Single-warehouse preference, 3+2 lot trace, failed multi-item rollback, successful replay without double consumption, payload conflict and malformed lines. |
| Browser customer journeys | `npx playwright test` (before adding PDF export test) | 4 tests passed in 6.5 seconds. Real headless Google Chrome; desktop 1440×1000 and catalog mobile 390×844. |
| Presentation PDF | `npx playwright test --grep 'presentation board'` | Passed. Three images loaded; three-page A4 landscape PDF exported. |
| Manual artifact inspection | Local image viewer; `pdfinfo`; `pdftoppm` | Desktop catalog, mobile catalog, tracking and split confirmation screenshots inspected. PDF inspected for framing and revised to expose warehouse quantities. |

## Browser coverage

1. Catalog renders without JavaScript page errors; search narrows results; no-result state and clearing filters work; category filtering works; mobile catalog has no horizontal overflow. Desktop/mobile screenshots saved.
2. Five-mouse story reaches an explicit checkout without submitting automatically. Submit creates order FW-1042 with two planned shipments, 3 Newark and 2 Columbus, with fictional lot references. A newly reserved order offers cancellation for 5 and disables returns. Checkout and confirmation screenshots saved.
3. Selected stock-conflict state rejects checkout without a new order and keeps all 5 mice in the bag.
4. Historical order FW-1038 offers cancellation for 2 unshipped units only. Canceling both preserves 3 delivered units. Returning all 3 delivered units produces a requested RMA and prevents an additional return. Tracking and return-form screenshots saved.

## Failures found and corrected

The initial isolated runner resolved React production JSX but omitted the development JSX runtime and automatic JSX configuration for imported customer files. Browser tests exposed the Vite import failure; explicit runtime aliases and automatic JSX were added.

Browser tests also exposed DOM reuse of the cart navigation button as the checkout submit button. The original click could submit the newly mounted checkout. Distinct React keys plus preventDefault on navigation now require explicit order submission; the browser regression checks checkout is visible and the submit button enabled before clicking it.

The return reason control received an explicit accessible label for reliable exact-name selection. The local shipment badge now shows cancellation when all its unshipped quantities are canceled.

No claims are made that earlier failing runs passed. The final four customer-flow tests passed after fixes. The PDF export was then added and run separately; no production application files changed after the passing flow run.

## Not verified or implemented

No PostgreSQL transactions, row locks, durable idempotency, cross-process stock correctness, authentication, real ownership enforcement, Member 3 dispatch integration, actual receiving/inspection, real payment, carrier integration, performance-at-scale measurements, or deployment. Planned independent-connection concurrency and security tests are in `assumptions-and-integration.md` and `docs/requests/customer.md`.

The preview server was run on http://127.0.0.1:5173 for checks. Local server/Chrome launch required native sandbox approval. The preview is local and was not published. No Git branch/commit exists because the supplied folder has no .git repository.
