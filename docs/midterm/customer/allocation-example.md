# One order, two warehouse shipments

All quantities, locations, products and lots below are fictional. Exactly three warehouses exist in the sample network. All are assumed eligible for the sample delivery region.

Order: **5 Arc Wireless Mice at $39 each = $195**. Sample shipping and tax are $0; no real payment occurs.

| Warehouse | Lot | Physical on_hand | Reserved before | Unavailable | Available before | New reservation |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Newark, NJ | DEMO-p1-1 | 6 | 1 | 2 | 3 | 3 |
| Columbus, OH | DEMO-p1-2 | 4 | 1 | 1 | 2 | 2 |
| Reno, NV | No eligible mouse stock | 0 | 0 | 0 | 0 | 0 |

`available = on_hand - reserved - unavailable`. No warehouse has all five. The proposed stock-based split takes three from Newark and two from Columbus, producing two allocations and two planned shipments under one order. The preview fixtures store only available quantities; this expanded accounting table explains the future database convention.

Before dispatch, on_hand remains 6 and 4; reserved becomes 4 and 3, respectively. Both warehouses then have zero available mice. Dispatch of Newark's three allocated mice later changes its on_hand from 6 to 3 and reserved from 4 to 1 together. Its two unavailable units stay unavailable.

The final database implementation must lock/recheck eligible stock and write the order, both allocations, both reservation changes, movement history and audit within one PostgreSQL transaction. If Columbus has only one unit left when authoritative stock is checked, roll back the entire request; do not reserve just Newark's three. Availability shown while browsing does not guarantee a reservation.

The historical tracking fixture is a separate sample order, FW-1038: Newark's three mice are delivered, while Columbus's two remain reserved. Canceling one or two Columbus units must release only that order's corresponding reservation. Newark's delivered units cannot be canceled. A return request for one delivered Newark mouse references its shipment item and lot; receipt and inspection are required before any inventory disposition.

Single-warehouse comparison: ordering two mice and three Still headphones can be fulfilled completely from Newark. Even though other locations have stock, the baseline chooses one eligible warehouse first.
