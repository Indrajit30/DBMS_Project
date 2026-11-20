# Customer presentation walkthrough (about 80–90 seconds)

Use a fresh session. Keep browser zoom at 100%. All numbers and events shown are sample values.

**0–15 seconds — Catalog.** “Customers need a clear answer to two questions: can I order this, and where is each part of my order? Fieldwork brings a three-warehouse network into one simple shopping experience. This is a fictional catalog, with search, categories and understandable availability.”

**15–30 seconds — Availability.** Expand Presentation controls, choose “Start 5-mouse split story.” “This mouse has five eligible units across our network: three in Newark and two in Columbus. The cart itself doesn’t hold stock. We confirm the allocation when the order is placed.” Add to bag, then View bag.

**30–50 seconds — Checkout and confirmation.** Continue to checkout, use the fictional prefilled address and place a sample order. “We prefer one warehouse when it can fill every item. Here none can supply five mice, so three come from Newark and two from Columbus. The real backend will reserve all five atomically, or reject the whole order. This prototype illustrates that behavior with local fixtures.”

**50–75 seconds — Tracking and cancellation.** Open the delivered sample through Presentation controls. “Each shipment has its own timeline. Three mice are already delivered; two are still unshipped. Only the two unshipped units are eligible for cancellation. Order-level labels never hide these quantity differences.”

**75–90 seconds — Return request.** Choose Request a return, select one delivered mouse and a reason, then submit. “The request links to the delivered shipment item, preserving its lot trace. Warehouse receipt and inspection are separate steps; requesting a return never restocks the item. Payments and shipment events are simulated.”

For a failure demonstration, start a fresh checkout and choose “Stock conflict” under Presentation controls before submitting. The cart remains intact and no new order appears.
