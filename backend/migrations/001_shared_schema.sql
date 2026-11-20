-- PostgreSQL 13+. This migration is the canonical shared schema contract.
-- Workflow code must update inventory_balances and append stock_movements
-- in the same transaction.

CREATE TABLE users (
    user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('customer', 'warehouse_employee', 'manager')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    auth_version integer NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_case_insensitive_unique ON users (lower(email));

CREATE TABLE warehouses (
    warehouse_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    region text NOT NULL,
    timezone text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouse_memberships (
    user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, warehouse_id)
);

CREATE TABLE customers (
    customer_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE RESTRICT,
    first_name text NOT NULL,
    last_name text NOT NULL,
    region text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    product_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku text NOT NULL UNIQUE,
    name text NOT NULL,
    category text NOT NULL,
    list_price numeric(12,2) NOT NULL CHECK (list_price >= 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lots (
    lot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id bigint NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    lot_code text NOT NULL,
    received_at timestamptz NOT NULL,
    expires_on date,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'quarantined', 'recalled', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_id, lot_code),
    UNIQUE (lot_id, product_id)
);

CREATE TABLE inventory_balances (
    lot_id bigint NOT NULL REFERENCES lots(lot_id) ON DELETE RESTRICT,
    warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
    reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    unavailable integer NOT NULL DEFAULT 0 CHECK (unavailable >= 0),
    available integer GENERATED ALWAYS AS (on_hand - reserved - unavailable) STORED,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lot_id, warehouse_id),
    CHECK (reserved + unavailable <= on_hand)
);

CREATE TABLE orders (
    order_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'placed'
        CHECK (status IN ('placed', 'allocated', 'partially_shipped', 'shipped', 'delivered', 'partially_cancelled', 'cancelled', 'closed')),
    service_level text NOT NULL DEFAULT 'standard'
        CHECK (service_level IN ('standard', 'expedited')),
    request_id uuid NOT NULL,
    destination_name text NOT NULL,
    destination_line1 text NOT NULL,
    destination_line2 text,
    destination_city text NOT NULL,
    destination_region text NOT NULL,
    destination_postal_code text NOT NULL,
    destination_country_code char(2) NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    replaces_order_id bigint REFERENCES orders(order_id) ON DELETE RESTRICT,
    UNIQUE (customer_id, request_id),
    UNIQUE (order_id, customer_id)
);

CREATE TABLE order_items (
    order_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
    product_id bigint NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
    cancelled_quantity integer NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id, product_id),
    UNIQUE (order_item_id, order_id, product_id),
    CHECK (cancelled_quantity <= quantity)
);

CREATE TABLE allocations (
    allocation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_item_id bigint NOT NULL,
    order_id bigint NOT NULL,
    product_id bigint NOT NULL,
    lot_id bigint NOT NULL,
    warehouse_id bigint NOT NULL,
    allocated_quantity integer NOT NULL CHECK (allocated_quantity > 0),
    shipped_quantity integer NOT NULL DEFAULT 0 CHECK (shipped_quantity >= 0),
    released_quantity integer NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
    status text NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'picked', 'partially_shipped', 'shipped', 'released', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (order_item_id, order_id, product_id)
        REFERENCES order_items(order_item_id, order_id, product_id) ON DELETE RESTRICT,
    FOREIGN KEY (lot_id, product_id)
        REFERENCES lots(lot_id, product_id) ON DELETE RESTRICT,
    FOREIGN KEY (lot_id, warehouse_id)
        REFERENCES inventory_balances(lot_id, warehouse_id) ON DELETE RESTRICT,
    CHECK (shipped_quantity + released_quantity <= allocated_quantity),
    UNIQUE (allocation_id, order_id, lot_id, warehouse_id)
);

CREATE TABLE shipments (
    shipment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
    warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'packed', 'shipped', 'in_transit', 'delivered', 'exception', 'cancelled')),
    tracking_code text,
    eta timestamptz,
    shipped_at timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (shipment_id, order_id, warehouse_id)
);

CREATE TABLE shipment_items (
    shipment_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_id bigint NOT NULL,
    order_id bigint NOT NULL,
    warehouse_id bigint NOT NULL,
    allocation_id bigint NOT NULL,
    lot_id bigint NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    FOREIGN KEY (shipment_id, order_id, warehouse_id)
        REFERENCES shipments(shipment_id, order_id, warehouse_id) ON DELETE RESTRICT,
    FOREIGN KEY (allocation_id, order_id, lot_id, warehouse_id)
        REFERENCES allocations(allocation_id, order_id, lot_id, warehouse_id) ON DELETE RESTRICT,
    UNIQUE (shipment_item_id, order_id)
);

CREATE TABLE shipment_events (
    shipment_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_id bigint NOT NULL REFERENCES shipments(shipment_id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_event_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (shipment_id, source_event_key)
);

CREATE TABLE returns (
    return_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    rma_code text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'authorized', 'in_transit', 'received', 'inspected', 'closed', 'rejected')),
    created_at timestamptz NOT NULL DEFAULT now(),
    received_at timestamptz,
    UNIQUE (return_id, order_id),
    UNIQUE (order_id, request_id)
);

CREATE TABLE return_items (
    return_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_id bigint NOT NULL REFERENCES returns(return_id) ON DELETE RESTRICT,
    order_id bigint NOT NULL,
    shipment_item_id bigint NOT NULL,
    requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
    received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    reason text NOT NULL,
    disposition text CHECK (disposition IN ('restock', 'quarantine', 'damage', 'discard', 'replacement')),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (return_id, order_id)
        REFERENCES returns(return_id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (shipment_item_id, order_id)
        REFERENCES shipment_items(shipment_item_id, order_id) ON DELETE RESTRICT,
    CHECK (received_quantity <= requested_quantity),
    UNIQUE (return_id, shipment_item_id)
);

CREATE TABLE return_inspections (
    inspection_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_item_id bigint NOT NULL REFERENCES return_items(return_item_id) ON DELETE RESTRICT,
    request_id uuid NOT NULL UNIQUE,
    inspector_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    outcome text NOT NULL CHECK (outcome IN ('restockable', 'quarantine', 'damaged', 'discard')),
    inspected_at timestamptz NOT NULL DEFAULT now(),
    notes text
);

CREATE TABLE transfers (
    transfer_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    destination_warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected', 'picking', 'in_transit', 'partially_received', 'received', 'cancelled')),
    request_id uuid NOT NULL,
    requested_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    approved_by uuid REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    dispatched_at timestamptz,
    received_at timestamptz,
    CHECK (source_warehouse_id <> destination_warehouse_id),
    UNIQUE (transfer_id, source_warehouse_id, destination_warehouse_id),
    UNIQUE (requested_by, request_id)
);

CREATE TABLE transfer_items (
    transfer_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_id bigint NOT NULL,
    source_warehouse_id bigint NOT NULL,
    destination_warehouse_id bigint NOT NULL,
    lot_id bigint NOT NULL REFERENCES lots(lot_id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity > 0),
    received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (transfer_id, source_warehouse_id, destination_warehouse_id)
        REFERENCES transfers(transfer_id, source_warehouse_id, destination_warehouse_id) ON DELETE RESTRICT,
    FOREIGN KEY (lot_id, source_warehouse_id)
        REFERENCES inventory_balances(lot_id, warehouse_id) ON DELETE RESTRICT,
    CHECK (received_quantity <= quantity),
    UNIQUE (transfer_id, lot_id)
);

CREATE TABLE transfer_events (
    transfer_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_id bigint NOT NULL REFERENCES transfers(transfer_id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_event_key text,
    UNIQUE (transfer_id, source_event_key)
);

CREATE TABLE stock_movements (
    movement_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lot_id bigint NOT NULL,
    warehouse_id bigint NOT NULL,
    event_type text NOT NULL,
    on_hand_delta integer NOT NULL DEFAULT 0,
    reserved_delta integer NOT NULL DEFAULT 0,
    unavailable_delta integer NOT NULL DEFAULT 0,
    reference_type text NOT NULL,
    reference_id bigint NOT NULL,
    actor_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL UNIQUE,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (lot_id, warehouse_id)
        REFERENCES inventory_balances(lot_id, warehouse_id) ON DELETE RESTRICT,
    CHECK (on_hand_delta <> 0 OR reserved_delta <> 0 OR unavailable_delta <> 0)
);

CREATE TABLE alerts (
    alert_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alert_type text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
    product_id bigint REFERENCES products(product_id) ON DELETE RESTRICT,
    warehouse_id bigint REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    lot_id bigint REFERENCES lots(lot_id) ON DELETE RESTRICT,
    dedupe_key text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    opened_at timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    resolved_at timestamptz,
    assigned_to uuid REFERENCES users(user_id) ON DELETE RESTRICT
);

CREATE TABLE audit_log (
    audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
    entity_type text NOT NULL,
    entity_id bigint NOT NULL,
    action text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    request_id uuid,
    before_data jsonb,
    after_data jsonb
);

-- Supporting entities from the source ER diagrams and project summary.
CREATE TABLE purchase_orders (
    purchase_order_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    supplier_name text NOT NULL,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
    expected_on date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE po_items (
    po_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_order_id bigint NOT NULL REFERENCES purchase_orders(purchase_order_id) ON DELETE RESTRICT,
    product_id bigint NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    ordered_quantity integer NOT NULL CHECK (ordered_quantity > 0),
    received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    lot_id bigint,
    FOREIGN KEY (lot_id, product_id)
        REFERENCES lots(lot_id, product_id) ON DELETE RESTRICT,
    CHECK (received_quantity <= ordered_quantity),
    UNIQUE (purchase_order_id, product_id)
);

CREATE TABLE cycle_counts (
    cycle_count_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'approved', 'cancelled')),
    counted_by uuid REFERENCES users(user_id) ON DELETE RESTRICT,
    approved_by uuid REFERENCES users(user_id) ON DELETE RESTRICT,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (cycle_count_id, warehouse_id)
);

CREATE TABLE cycle_count_items (
    cycle_count_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cycle_count_id bigint NOT NULL,
    lot_id bigint NOT NULL,
    warehouse_id bigint NOT NULL,
    expected_quantity integer NOT NULL CHECK (expected_quantity >= 0),
    counted_quantity integer NOT NULL CHECK (counted_quantity >= 0),
    variance integer GENERATED ALWAYS AS (counted_quantity - expected_quantity) STORED,
    counted_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (lot_id, warehouse_id)
        REFERENCES inventory_balances(lot_id, warehouse_id) ON DELETE RESTRICT,
    FOREIGN KEY (cycle_count_id, warehouse_id)
        REFERENCES cycle_counts(cycle_count_id, warehouse_id) ON DELETE RESTRICT,
    UNIQUE (cycle_count_id, lot_id)
);

CREATE TABLE reservation_holds (
    hold_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lot_id bigint NOT NULL,
    warehouse_id bigint NOT NULL,
    customer_id bigint NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'released', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (lot_id, warehouse_id)
        REFERENCES inventory_balances(lot_id, warehouse_id) ON DELETE RESTRICT,
    UNIQUE (customer_id, request_id)
);

CREATE TABLE demand_forecasts (
    forecast_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id bigint NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    warehouse_id bigint NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    horizon_start date NOT NULL,
    horizon_end date NOT NULL,
    predicted_quantity numeric(14,3) NOT NULL CHECK (predicted_quantity >= 0),
    model_version text NOT NULL,
    calculated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (horizon_end >= horizon_start),
    UNIQUE (product_id, warehouse_id, horizon_start, horizon_end, model_version)
);

CREATE TABLE recalls (
    recall_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lot_id bigint NOT NULL REFERENCES lots(lot_id) ON DELETE RESTRICT,
    case_code text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'investigating'
        CHECK (status IN ('investigating', 'confirmed', 'contained', 'closed', 'dismissed')),
    reason text NOT NULL,
    opened_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);

-- Query indexes follow the customer history, warehouse work queue, and traceability paths.
CREATE INDEX warehouse_memberships_by_warehouse ON warehouse_memberships (warehouse_id, user_id);
CREATE INDEX customers_by_region ON customers (region, customer_id);
CREATE INDEX lots_by_product_expiry ON lots (product_id, expires_on) WHERE status = 'active';
CREATE INDEX inventory_by_warehouse_available ON inventory_balances (warehouse_id, available, lot_id);
CREATE INDEX orders_by_customer_time ON orders (customer_id, placed_at DESC, order_id DESC);
CREATE INDEX orders_by_status_time ON orders (status, placed_at DESC);
CREATE INDEX order_items_by_order ON order_items (order_id, order_item_id);
CREATE INDEX order_items_by_product ON order_items (product_id, order_id);
CREATE INDEX allocations_by_warehouse_status ON allocations (warehouse_id, status, created_at);
CREATE INDEX allocations_by_order_item ON allocations (order_item_id, allocation_id);
CREATE INDEX shipments_by_warehouse_status ON shipments (warehouse_id, status, created_at);
CREATE INDEX shipments_by_order ON shipments (order_id, shipment_id);
CREATE INDEX shipment_items_by_allocation ON shipment_items (allocation_id, shipment_item_id);
CREATE INDEX shipment_items_by_lot ON shipment_items (lot_id, shipment_id);
CREATE INDEX shipment_events_by_time ON shipment_events (shipment_id, occurred_at DESC);
CREATE INDEX returns_by_order_status ON returns (order_id, status, created_at DESC);
CREATE INDEX return_items_by_shipment_item ON return_items (shipment_item_id);
CREATE INDEX transfers_by_source_status ON transfers (source_warehouse_id, status, created_at DESC);
CREATE INDEX transfers_by_destination_status ON transfers (destination_warehouse_id, status, created_at DESC);
CREATE INDEX transfer_items_by_lot ON transfer_items (lot_id, transfer_id);
CREATE INDEX stock_movements_by_balance_time ON stock_movements (lot_id, warehouse_id, occurred_at DESC);
CREATE INDEX stock_movements_by_reference ON stock_movements (reference_type, reference_id);
CREATE INDEX alerts_by_queue ON alerts (status, severity, opened_at DESC);
CREATE UNIQUE INDEX alerts_one_active_dedupe_key ON alerts (dedupe_key)
    WHERE status IN ('open', 'acknowledged');
CREATE INDEX audit_log_by_entity_time ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_by_actor_time ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX po_items_by_product ON po_items (product_id, purchase_order_id);
CREATE INDEX cycle_count_items_by_balance ON cycle_count_items (lot_id, warehouse_id);
CREATE INDEX reservation_holds_by_expiry ON reservation_holds (status, expires_at)
    WHERE status = 'active';
CREATE INDEX demand_forecasts_by_product_warehouse ON demand_forecasts
    (product_id, warehouse_id, horizon_start, calculated_at DESC);
CREATE INDEX recalls_by_lot_status ON recalls (lot_id, status, opened_at DESC);

