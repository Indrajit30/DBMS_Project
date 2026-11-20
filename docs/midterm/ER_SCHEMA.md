# Shared Database Schema and ER Diagram

**Status:** approved design draft; implementation contract is `backend/migrations/001_shared_schema.sql`.

The project is a single retailer with three warehouses. Identifiers for users are UUIDs; operational identifiers use `bigint` identity columns. Times are `timestamptz`; dates without a time use `date`; unit counts are integer; money is `numeric(12,2)`. Status columns are `text` constrained by `CHECK` clauses. The database accounting rule is:

```text
available = on_hand - reserved - unavailable
```

`on_hand` counts all physically present units. `reserved` and `unavailable` are disjoint subsets. In-transit units belong to transfer records, not warehouse balances.

## ER diagram

```mermaid
erDiagram
    USERS ||--o| CUSTOMERS : account
    USERS ||--o{ WAREHOUSE_MEMBERSHIPS : assigned
    WAREHOUSES ||--o{ WAREHOUSE_MEMBERSHIPS : staffs
    PRODUCTS ||--o{ LOTS : batched_as
    LOTS ||--o{ INVENTORY_BALANCES : stocked_as
    WAREHOUSES ||--o{ INVENTORY_BALANCES : holds
    CUSTOMERS ||--o{ ORDERS : places
    ORDERS ||--|{ ORDER_ITEMS : contains
    PRODUCTS ||--o{ ORDER_ITEMS : ordered
    ORDER_ITEMS ||--o{ ALLOCATIONS : reserved_from
    LOTS ||--o{ ALLOCATIONS : allocated_from
    WAREHOUSES ||--o{ ALLOCATIONS : fulfills
    ORDERS ||--o{ SHIPMENTS : fulfilled_by
    SHIPMENTS ||--|{ SHIPMENT_ITEMS : contains
    ALLOCATIONS ||--o{ SHIPMENT_ITEMS : ships
    SHIPMENTS ||--o{ SHIPMENT_EVENTS : records
    ORDERS ||--o{ RETURNS : may_have
    RETURNS ||--|{ RETURN_ITEMS : includes
    SHIPMENT_ITEMS ||--o{ RETURN_ITEMS : returned_from
    RETURN_ITEMS ||--o{ RETURN_INSPECTIONS : inspected_by
    USERS ||--o{ RETURN_INSPECTIONS : inspects
    WAREHOUSES ||--o{ TRANSFERS : source_or_destination
    TRANSFERS ||--|{ TRANSFER_ITEMS : contains
    LOTS ||--o{ TRANSFER_ITEMS : moves
    TRANSFERS ||--o{ TRANSFER_EVENTS : records
    INVENTORY_BALANCES ||--o{ STOCK_MOVEMENTS : changed_by
    USERS ||--o{ STOCK_MOVEMENTS : performs
    PRODUCTS ||--o{ ALERTS : concerns
    WAREHOUSES ||--o{ ALERTS : concerns
    LOTS ||--o{ ALERTS : concerns
    USERS ||--o{ AUDIT_LOG : acts
    WAREHOUSES ||--o{ PURCHASE_ORDERS : receives_for
    PURCHASE_ORDERS ||--|{ PO_ITEMS : contains
    PRODUCTS ||--o{ PO_ITEMS : replenishes
    LOTS o|--o{ PO_ITEMS : received_as
    WAREHOUSES ||--o{ CYCLE_COUNTS : counts
    CYCLE_COUNTS ||--|{ CYCLE_COUNT_ITEMS : contains
    INVENTORY_BALANCES ||--o{ CYCLE_COUNT_ITEMS : counted
    CUSTOMERS ||--o{ RESERVATION_HOLDS : owns
    INVENTORY_BALANCES ||--o{ RESERVATION_HOLDS : held_from
    PRODUCTS ||--o{ DEMAND_FORECASTS : forecast
    WAREHOUSES ||--o{ DEMAND_FORECASTS : forecast_for
    LOTS ||--o{ RECALLS : recalled
    USERS ||--o{ RECALLS : opens

    USERS {
        uuid user_id PK
        text email UK_case_insensitive
        text password_hash
        text role
        text status
        integer auth_version
        timestamptz created_at
        timestamptz updated_at
    }
    CUSTOMERS {
        bigint customer_id PK
        uuid user_id FK_UK
        text first_name
        text last_name
        text region
        timestamptz created_at
    }
    WAREHOUSES {
        bigint warehouse_id PK
        text code UK
        text name
        text region
        text timezone
        boolean is_active
        timestamptz created_at
    }
    WAREHOUSE_MEMBERSHIPS {
        uuid user_id PK_FK
        bigint warehouse_id PK_FK
        timestamptz assigned_at
    }
    PRODUCTS {
        bigint product_id PK
        text sku UK
        text name
        text category
        numeric_12_2 list_price
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    LOTS {
        bigint lot_id PK
        bigint product_id FK
        text lot_code UK_product
        timestamptz received_at
        date expires_on
        text status
        timestamptz created_at
    }
    INVENTORY_BALANCES {
        bigint lot_id PK_FK
        bigint warehouse_id PK_FK
        integer on_hand
        integer reserved
        integer unavailable
        integer available_generated
        timestamptz updated_at
    }
    ORDERS {
        bigint order_id PK
        bigint customer_id FK
        text status
        text service_level
        uuid request_id
        text destination_name
        text destination_line1
        text destination_line2
        text destination_city
        text destination_region
        text destination_postal_code
        char_2 destination_country_code
        timestamptz placed_at
        timestamptz updated_at
        bigint replaces_order_id FK
    }
    ORDER_ITEMS {
        bigint order_item_id PK
        bigint order_id FK
        bigint product_id FK
        integer quantity
        numeric_12_2 unit_price
        integer cancelled_quantity
        timestamptz created_at
    }
    ALLOCATIONS {
        bigint allocation_id PK
        bigint order_item_id FK
        bigint order_id FK
        bigint product_id FK
        bigint lot_id FK
        bigint warehouse_id FK
        integer allocated_quantity
        integer shipped_quantity
        integer released_quantity
        text status
        timestamptz created_at
        timestamptz updated_at
    }
    SHIPMENTS {
        bigint shipment_id PK
        bigint order_id FK
        bigint warehouse_id FK
        text status
        text tracking_code
        timestamptz eta
        timestamptz shipped_at
        timestamptz delivered_at
        timestamptz created_at
    }
    SHIPMENT_ITEMS {
        bigint shipment_item_id PK
        bigint shipment_id FK
        bigint order_id FK
        bigint warehouse_id FK
        bigint allocation_id FK
        bigint lot_id FK
        integer quantity
    }
    SHIPMENT_EVENTS {
        bigint shipment_event_id PK
        bigint shipment_id FK
        text event_type
        timestamptz occurred_at
        jsonb details
        text source_event_key
        timestamptz created_at
    }
    RETURNS {
        bigint return_id PK
        bigint order_id FK
        uuid request_id UK(order_id, request_id)
        text rma_code UK
        text status
        timestamptz created_at
        timestamptz received_at
    }
    RETURN_ITEMS {
        bigint return_item_id PK
        bigint return_id FK
        bigint order_id FK
        bigint shipment_item_id FK
        integer requested_quantity
        integer received_quantity
        text reason
        text disposition
        timestamptz created_at
    }
    RETURN_INSPECTIONS {
        bigint inspection_id PK
        bigint return_item_id FK
        uuid request_id UK
        uuid inspector_user_id FK
        text outcome
        timestamptz inspected_at
        text notes
    }
    TRANSFERS {
        bigint transfer_id PK
        bigint source_warehouse_id FK
        bigint destination_warehouse_id FK
        text status
        uuid request_id UK(requested_by, request_id)
        uuid requested_by FK
        uuid approved_by FK
        timestamptz created_at
        timestamptz dispatched_at
        timestamptz received_at
    }
    TRANSFER_ITEMS {
        bigint transfer_item_id PK
        bigint transfer_id FK
        bigint source_warehouse_id FK
        bigint destination_warehouse_id FK
        bigint lot_id FK
        integer quantity
        integer received_quantity
        timestamptz created_at
    }
    TRANSFER_EVENTS {
        bigint transfer_event_id PK
        bigint transfer_id FK
        text event_type
        timestamptz occurred_at
        uuid actor_user_id FK
        jsonb details
        text source_event_key UK(transfer_id, source_event_key)
    }
    STOCK_MOVEMENTS {
        bigint movement_id PK
        bigint lot_id FK
        bigint warehouse_id FK
        text event_type
        integer on_hand_delta
        integer reserved_delta
        integer unavailable_delta
        text reference_type
        bigint reference_id
        uuid actor_user_id FK
        text idempotency_key UK
        timestamptz occurred_at
        jsonb details
    }
    ALERTS {
        bigint alert_id PK
        text alert_type
        text severity
        text status
        bigint product_id FK
        bigint warehouse_id FK
        bigint lot_id FK
        text dedupe_key
        jsonb evidence
        timestamptz opened_at
        timestamptz acknowledged_at
        timestamptz resolved_at
        uuid assigned_to FK
    }
    AUDIT_LOG {
        bigint audit_id PK
        uuid actor_user_id FK
        text entity_type
        bigint entity_id
        text action
        timestamptz occurred_at
        uuid request_id
        jsonb before_data
        jsonb after_data
    }
    PURCHASE_ORDERS {
        bigint purchase_order_id PK
        bigint warehouse_id FK
        text supplier_name
        text status
        date expected_on
        timestamptz created_at
        timestamptz updated_at
    }
    PO_ITEMS {
        bigint po_item_id PK
        bigint purchase_order_id FK
        bigint product_id FK
        integer ordered_quantity
        integer received_quantity
        bigint lot_id FK
    }
    CYCLE_COUNTS {
        bigint cycle_count_id PK
        bigint warehouse_id FK
        text status
        uuid counted_by FK
        uuid approved_by FK
        timestamptz started_at
        timestamptz completed_at
    }
    CYCLE_COUNT_ITEMS {
        bigint cycle_count_item_id PK
        bigint cycle_count_id FK
        bigint lot_id FK
        bigint warehouse_id FK
        integer expected_quantity
        integer counted_quantity
        integer variance_generated
        timestamptz counted_at
    }
    RESERVATION_HOLDS {
        bigint hold_id PK
        bigint lot_id FK
        bigint warehouse_id FK
        bigint customer_id FK
        uuid request_id
        integer quantity
        text status
        timestamptz created_at
        timestamptz expires_at
    }
    DEMAND_FORECASTS {
        bigint forecast_id PK
        bigint product_id FK
        bigint warehouse_id FK
        date horizon_start
        date horizon_end
        numeric_14_3 predicted_quantity
        text model_version
        timestamptz calculated_at
    }
    RECALLS {
        bigint recall_id PK
        bigint lot_id FK
        text case_code UK
        text status
        text reason
        uuid opened_by FK
        timestamptz opened_at
        timestamptz closed_at
    }
```

`UK_product` means the unique key is `(product_id, lot_code)`. Composite foreign keys in the migration additionally ensure that order items, lots, warehouse balances, allocations, shipments, and returned shipment items agree on their product/order/warehouse/lot scope.

The users email key is a unique index on `lower(email)`, so differently cased versions of the same address cannot create separate accounts. `auth_version` invalidates issued access tokens when incremented. Return items carry a composite `(return_id, order_id)` foreign key so the return header and referenced shipped order line must agree. Cycle count items similarly match the count header warehouse to the counted balance warehouse. A purchase order item’s optional received lot must belong to its product.

## Integrity rules

- Inventory quantities are nonnegative and `reserved + unavailable <= on_hand`; the generated `available` column implements the agreed formula.
- Order, allocation, shipment, return, transfer, and receiving quantities must be positive. Per-row bounds are constrained in SQL.
- Cross-row totals (for example total shipped across partial shipments, total returned across return requests, or cumulative cancellation) require a transaction that locks and validates the relevant item/allocation rows. A `CHECK` cannot safely enforce aggregate totals.
- Every allocation points to a lot of the ordered product and an existing warehouse/lot balance. Shipment lines reference allocations with the same order, warehouse, and lot. Returns reference the original shipment line and order.
- Balance changes and append-only stock movements must commit together. Transfer dispatch removes source stock and receipt adds destination stock once; in-transit quantity is represented by transfer items.
- Customer address and unit sale-price snapshots preserve historical order data if account addresses or catalog prices later change.
- Audit and movement records are append-only by application convention. Deleting referenced business records is restricted by foreign keys.

## Migration order

Run `npm run db:migrate` from `backend/` against a PostgreSQL 13+ database. The migration runner records SHA-256 checksums and applies each migration with its version record in one transaction under an advisory lock. `001_shared_schema.sql` creates identity, catalog, stock, order/fulfillment, return/transfer, operational record, and supporting tables before their dependents. It owns all shared tables. Teammates should propose schema edits through a reviewed follow-up migration rather than editing an applied migration or creating private shared-table variants.
