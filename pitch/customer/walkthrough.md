# Customer pitch contribution

**Problem:** A customer places one order but receives multiple packages. Without quantity-level visibility, they cannot tell which items are still reserved, which shipped, or what can be canceled or returned.

**Customer value:** One understandable journey from indicative availability to warehouse-specific fulfillment, shipment tracking and eligible return requests. Reliability comes from the final transactional reservation design; the mockup makes its customer-visible consequences clear.

**Show:** Catalog → Arc mouse quantity 5 → bag/checkout → two-shipment confirmation → historical tracking sample → return one delivered mouse.

**Say:** “Three mice come from Newark and two from Columbus. The final system will reserve both allocations together, or reject the whole order. Delivered units cannot be canceled; returns link to the actual delivered shipment item and its lot.”

**Engineering challenge:** Atomic multi-item reservations, retry-safe order creation, ownership enforcement, and dispatch/cancellation races. A browser demonstration cannot establish these guarantees; PostgreSQL integration tests are required.

**Scope disclosure:** All products, prices, addresses, stock, warehouse examples and shipment events are fictional. No real payments, carriers or authentication are connected. Return receiving/inspection is Member 3's responsibility. Teamwide operational-risk screens and million-row generation belong to the other workstreams.

Presentation script: `docs/midterm/customer/walkthrough.md` (80–90 seconds). Screenshot assets: `docs/midterm/customer/screenshots/`. Integration requirements: `docs/requests/customer.md`.
