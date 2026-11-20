"""Seeded, workflow-consistent PostgreSQL workload generator.

The output is synthetic. A fixed seed and fixed as-of timestamp produce the
same data values for the same Python and dependency versions. Rows are spooled
to compressed CSV and loaded with PostgreSQL COPY to keep memory bounded.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import random
import secrets
import tempfile
import time
import uuid
from bisect import bisect_left
from datetime import date, datetime, time as day_time, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

import bcrypt
import psycopg
from psycopg import sql

NULL_MARKER = "__MW_NULL_9A71__"
NAMESPACE = uuid.UUID("b08b9edc-388f-49bb-b0b5-3ba66ff5b5d7")
WAREHOUSE_ROWS = [
    (1, "LOCAL-EAST", "Local East", "east", "America/New_York"),
    (2, "LOCAL-CENTRAL", "Local Central", "central", "America/Chicago"),
    (3, "LOCAL-WEST", "Local West", "west", "America/Los_Angeles"),
]
WAREHOUSE_SHARE = (0.40, 0.30, 0.30)
REGION_SHARE = (0.40, 0.30, 0.30)
REGIONS = ("east", "central", "west")

FIRST_NAMES = (
    "Avery", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Cameron", "Quinn",
    "Jamie", "Reese", "Alex", "Drew", "Skyler", "Parker", "Rowan", "Dakota",
    "Maya", "Noah", "Aisha", "Leo", "Sofia", "Ethan", "Nina", "Mateo",
)
LAST_NAMES = (
    "Bennett", "Brooks", "Carter", "Chen", "Diaz", "Foster", "Garcia", "Hayes",
    "Jackson", "Kim", "Lopez", "Martin", "Nguyen", "Patel", "Rivera", "Shah",
    "Singh", "Thompson", "Walker", "Young", "Zhang", "Wilson", "Reed", "Price",
)
STREETS = ("Oak Street", "Maple Avenue", "Cedar Road", "Pine Lane", "Lakeview Drive", "Hillcrest Way")
CITY_REGION = {
    "east": ("Boston", "MA", "02108"),
    "central": ("Chicago", "IL", "60601"),
    "west": ("Seattle", "WA", "98101"),
}
PRODUCT_TYPES = (
    "Wireless Mouse", "Compact Keyboard", "USB-C Hub", "Laptop Stand", "Webcam",
    "Headphones", "Charging Dock", "USB-C Cable", "Portable SSD", "Monitor Light",
    "Bluetooth Speaker", "Travel Adapter", "Mouse Pad", "Phone Stand", "Power Bank",
)
PRODUCT_CATEGORIES = ("input", "connectivity", "workspace", "audio", "power", "storage")

TABLE_COLUMNS: dict[str, tuple[str, ...]] = {
    "users": ("user_id", "email", "password_hash", "role", "status", "auth_version", "created_at", "updated_at"),
    "warehouses": ("warehouse_id", "code", "name", "region", "timezone", "is_active", "created_at"),
    "warehouse_memberships": ("user_id", "warehouse_id", "assigned_at"),
    "customers": ("customer_id", "user_id", "first_name", "last_name", "region", "created_at"),
    "products": ("product_id", "sku", "name", "category", "list_price", "is_active", "created_at", "updated_at"),
    "lots": ("lot_id", "product_id", "lot_code", "received_at", "expires_on", "status", "created_at"),
    "inventory_balances": ("lot_id", "warehouse_id", "on_hand", "reserved", "unavailable", "updated_at"),
    "orders": ("order_id", "customer_id", "status", "service_level", "request_id", "destination_name", "destination_line1", "destination_line2", "destination_city", "destination_region", "destination_postal_code", "destination_country_code", "placed_at", "updated_at", "replaces_order_id"),
    "order_items": ("order_item_id", "order_id", "product_id", "quantity", "unit_price", "cancelled_quantity", "created_at"),
    "allocations": ("allocation_id", "order_item_id", "order_id", "product_id", "lot_id", "warehouse_id", "allocated_quantity", "shipped_quantity", "released_quantity", "status", "created_at", "updated_at"),
    "shipments": ("shipment_id", "order_id", "warehouse_id", "status", "tracking_code", "eta", "shipped_at", "delivered_at", "created_at"),
    "shipment_items": ("shipment_item_id", "shipment_id", "order_id", "warehouse_id", "allocation_id", "lot_id", "quantity"),
    "shipment_events": ("shipment_event_id", "shipment_id", "event_type", "occurred_at", "details", "source_event_key", "created_at"),
    "returns": ("return_id", "order_id", "request_id", "rma_code", "status", "created_at", "received_at"),
    "return_items": ("return_item_id", "return_id", "order_id", "shipment_item_id", "requested_quantity", "received_quantity", "reason", "disposition", "created_at"),
    "return_inspections": ("inspection_id", "return_item_id", "request_id", "inspector_user_id", "outcome", "inspected_at", "notes"),
    "transfers": ("transfer_id", "source_warehouse_id", "destination_warehouse_id", "status", "request_id", "requested_by", "approved_by", "created_at", "dispatched_at", "received_at"),
    "transfer_items": ("transfer_item_id", "transfer_id", "source_warehouse_id", "destination_warehouse_id", "lot_id", "quantity", "received_quantity", "created_at"),
    "transfer_events": ("transfer_event_id", "transfer_id", "event_type", "occurred_at", "actor_user_id", "details", "source_event_key"),
    "stock_movements": ("movement_id", "lot_id", "warehouse_id", "event_type", "on_hand_delta", "reserved_delta", "unavailable_delta", "reference_type", "reference_id", "actor_user_id", "idempotency_key", "occurred_at", "details"),
    "alerts": ("alert_id", "alert_type", "severity", "status", "product_id", "warehouse_id", "lot_id", "dedupe_key", "evidence", "opened_at", "acknowledged_at", "resolved_at", "assigned_to"),
    "audit_log": ("audit_id", "actor_user_id", "entity_type", "entity_id", "action", "occurred_at", "request_id", "before_data", "after_data"),
    "purchase_orders": ("purchase_order_id", "warehouse_id", "supplier_name", "status", "expected_on", "created_at", "updated_at"),
    "po_items": ("po_item_id", "purchase_order_id", "product_id", "ordered_quantity", "received_quantity", "lot_id"),
    "cycle_counts": ("cycle_count_id", "warehouse_id", "status", "counted_by", "approved_by", "started_at", "completed_at"),
    "cycle_count_items": ("cycle_count_item_id", "cycle_count_id", "lot_id", "warehouse_id", "expected_quantity", "counted_quantity", "counted_at"),
    "reservation_holds": ("hold_id", "lot_id", "warehouse_id", "customer_id", "request_id", "quantity", "status", "created_at", "expires_at"),
    "demand_forecasts": ("forecast_id", "product_id", "warehouse_id", "horizon_start", "horizon_end", "predicted_quantity", "model_version", "calculated_at"),
    "recalls": ("recall_id", "lot_id", "case_code", "status", "reason", "opened_by", "opened_at", "closed_at"),
}

LOAD_ORDER = tuple(TABLE_COLUMNS)
EMPTY_CHECK_TABLES = tuple(TABLE_COLUMNS)
IDENTITY_COLUMNS = {
    "warehouses": "warehouse_id", "customers": "customer_id", "products": "product_id",
    "lots": "lot_id", "orders": "order_id", "order_items": "order_item_id",
    "allocations": "allocation_id", "shipments": "shipment_id", "shipment_items": "shipment_item_id",
    "shipment_events": "shipment_event_id", "returns": "return_id", "return_items": "return_item_id",
    "return_inspections": "inspection_id", "transfers": "transfer_id", "transfer_items": "transfer_item_id",
    "transfer_events": "transfer_event_id", "stock_movements": "movement_id", "alerts": "alert_id",
    "audit_log": "audit_id", "purchase_orders": "purchase_order_id", "po_items": "po_item_id",
    "cycle_counts": "cycle_count_id", "cycle_count_items": "cycle_count_item_id",
    "reservation_holds": "hold_id", "demand_forecasts": "forecast_id", "recalls": "recall_id",
}


class Spool:
    def __init__(self, root: Path):
        self.root = root
        self.files: dict[str, Any] = {}
        self.writers: dict[str, csv.writer] = {}

    def emit(self, table: str, row: Sequence[Any]) -> None:
        if table not in self.writers:
            handle = gzip.open(self.root / f"{table}.csv.gz", "wt", newline="", encoding="utf-8", compresslevel=3)
            self.files[table] = handle
            self.writers[table] = csv.writer(handle, lineterminator="\n")
        self.writers[table].writerow([NULL_MARKER if item is None else item for item in row])

    def close(self) -> None:
        for handle in self.files.values():
            handle.close()


def cumulative_weights(count: int, exponent: float) -> list[float]:
    weights = [1.0 / (rank**exponent) for rank in range(1, count + 1)]
    total = sum(weights)
    running = 0.0
    result = []
    for weight in weights:
        running += weight / total
        result.append(running)
    result[-1] = 1.0
    return result


def draw_weighted(rng: random.Random, cumulative: Sequence[float]) -> int:
    return bisect_left(cumulative, rng.random())


def stable_user_id(seed: int, label: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"multiwarehouse:{seed}:{label}")


def json_text(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def ensure_local_database_empty(connection: psycopg.Connection) -> None:
    with connection.cursor() as cursor:
        for table in EMPTY_CHECK_TABLES:
            cursor.execute(sql.SQL("SELECT EXISTS (SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
            if cursor.fetchone()[0]:
                raise RuntimeError(
                    f"Table {table} is not empty. Use a fresh database for the scale generator; "
                    "the generator never truncates or deletes application data."
                )


def stream_copy(connection: psycopg.Connection, root: Path, table: str) -> int:
    path = root / f"{table}.csv.gz"
    if not path.exists():
        return 0
    columns = TABLE_COLUMNS[table]
    command = sql.SQL("COPY {} ({}) FROM STDIN").format(
        sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, columns))
    )
    copied = 0
    with gzip.open(path, "rt", newline="", encoding="utf-8") as source:
        rows = csv.reader(source)
        with connection.cursor().copy(command) as copy:
            for row in rows:
                copy.write_row([None if value == NULL_MARKER else value for value in row])
                copied += 1
    return copied


def adjust_identity_sequences(connection: psycopg.Connection) -> None:
    with connection.cursor() as cursor:
        for table, column in IDENTITY_COLUMNS.items():
            statement = sql.SQL(
                "SELECT setval(pg_get_serial_sequence(%s, %s), COALESCE(MAX({}), 1), COUNT(*) > 0) FROM {}"
            ).format(sql.Identifier(column), sql.Identifier(table))
            cursor.execute(statement, [table, column])


def measure_table_stats(connection: psycopg.Connection) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = {}
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT c.relname,
                      pg_table_size(c.oid),
                      pg_indexes_size(c.oid),
                      pg_total_relation_size(c.oid)
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = current_schema()
                  AND c.relkind = 'r'
                  AND c.relname::text = ANY(%s)
                ORDER BY c.relname""",
            [list(TABLE_COLUMNS)],
        )
        sizes = {
            row[0]: {"table_bytes": row[1], "index_bytes": row[2], "total_bytes": row[3]}
            for row in cursor.fetchall()
        }
    for table in TABLE_COLUMNS:
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table)))
            stats[table] = {"row_count": cursor.fetchone()[0], **sizes.get(table, {})}
    return stats


def create_spool(args: argparse.Namespace, root: Path) -> dict[str, int]:
    rng = random.Random(args.seed + 1)
    date_rng = random.Random(args.seed + 2)
    warehouse_rng = random.Random(args.seed + 3)
    spool = Spool(root)
    parsed_as_of = datetime.fromisoformat(args.as_of.replace("Z", "+00:00"))
    if parsed_as_of.tzinfo is None:
        raise ValueError("--as-of must include a UTC offset")
    as_of = parsed_as_of.astimezone(timezone.utc)
    start = as_of - timedelta(days=5 * 365)

    customer_count = args.customers
    product_count = args.products
    order_count = args.orders
    item_target = args.order_items
    if customer_count < 1 or product_count < 2 or order_count < 1:
        raise ValueError("customers and orders must be positive, and at least two products are required")
    if item_target < order_count or item_target > 3 * order_count:
        raise ValueError("order-items target must be between one and three rows per order for this profile")
    max_lines = 3 if item_target > 2 * order_count else 2
    if product_count < max_lines:
        raise ValueError(f"at least {max_lines} products are required for the selected order-item profile")
    if min(args.transfers, args.alerts, args.recalls) < 0:
        raise ValueError("transfers, alerts, and recalls must be zero or greater")

    # Demo staff are synthetic and have no shared credential; local demo accounts are added by db:seed.
    employees = 99
    manager_id = stable_user_id(args.seed, "manager")
    employee_ids = [stable_user_id(args.seed, f"employee:{i}") for i in range(1, employees + 1)]
    customer_user_ids = [stable_user_id(args.seed, f"customer:{i}") for i in range(1, customer_count + 1)]
    # Hash a fresh unrecorded password so generated accounts have valid, unusable credentials.
    non_login_hash = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt(rounds=12)).decode()
    created_at = timestamp(start)

    spool.emit("users", (manager_id, "manager@synthetic.example.test", non_login_hash, "manager", "active", 0, created_at, created_at))
    for index, user_id in enumerate(employee_ids, start=1):
        spool.emit("users", (user_id, f"staff{index:03d}@synthetic.example.test", non_login_hash, "warehouse_employee", "active", 0, created_at, created_at))
    region_for_customer: list[str] = []
    for customer_id, user_id in enumerate(customer_user_ids, start=1):
        roll = (customer_id - 1) % 10
        region = "east" if roll < 4 else ("central" if roll < 7 else "west")
        region_for_customer.append(region)
        first = FIRST_NAMES[(customer_id * 7 + args.seed) % len(FIRST_NAMES)]
        last = LAST_NAMES[(customer_id * 11 + args.seed) % len(LAST_NAMES)]
        spool.emit("users", (user_id, f"customer{customer_id:06d}@synthetic.example.test", non_login_hash, "customer", "active", 0, created_at, created_at))
        spool.emit("customers", (customer_id, user_id, first, last, region, created_at))
    for warehouse_id, code, name, region, zone in WAREHOUSE_ROWS:
        spool.emit("warehouses", (warehouse_id, code, name, region, zone, True, created_at))
    for index, user_id in enumerate(employee_ids):
        spool.emit("warehouse_memberships", (user_id, (index % 3) + 1, created_at))

    product_cumulative = cumulative_weights(product_count, 1.12)
    customer_cumulative = cumulative_weights(customer_count, 1.08)
    product_weights = [(1.0 / (rank**1.12)) for rank in range(1, product_count + 1)]
    weight_total = sum(product_weights)
    total_weighted_units = item_target * 1.55 * 1.38
    for product_id in range(1, product_count + 1):
        ptype = PRODUCT_TYPES[(product_id * 7 + args.seed) % len(PRODUCT_TYPES)]
        category = PRODUCT_CATEGORIES[(product_id * 3) % len(PRODUCT_CATEGORIES)]
        price = f"{round(7.99 + ((product_id * 137) % 29000) / 100, 2):.2f}"
        name = f"Synthetic {ptype} {product_id:04d}"
        spool.emit("products", (product_id, f"SYN-{product_id:06d}", name, category, price, True, created_at, created_at))

    # Two traceable lots per product are present in each of the three warehouse balances.
    lot_id_for: dict[tuple[int, int], int] = {}
    balance_state: dict[tuple[int, int], dict[str, int]] = {}
    balances_by_product_warehouse: dict[tuple[int, int], list[tuple[int, int]]] = {}
    lot_id = 0
    movement_id = 0
    for product_id in range(1, product_count + 1):
        product_expected = total_weighted_units * product_weights[product_id - 1] / weight_total
        for lot_number in range(2):
            lot_id += 1
            lot_id_for[(product_id, lot_number)] = lot_id
            lot_code = f"GEN-{product_id:06d}-{lot_number + 1}"
            lot_received = start + timedelta(days=(product_id * 17 + lot_number * 131) % 900)
            spool.emit("lots", (lot_id, product_id, lot_code, timestamp(lot_received), None, "active", timestamp(lot_received)))
            for warehouse_id in range(1, 4):
                share = WAREHOUSE_SHARE[warehouse_id - 1]
                total_product_at_warehouse = math.ceil(product_expected * share) + 8
                quantity = total_product_at_warehouse // 2 + (1 if lot_number == 0 and total_product_at_warehouse % 2 else 0)
                state = {"product_id": product_id, "warehouse_id": warehouse_id, "on_hand": quantity, "reserved": 0, "unavailable": 0}
                balance_state[(lot_id, warehouse_id)] = state
                balances_by_product_warehouse.setdefault((product_id, warehouse_id), []).append((lot_id, quantity))
                spool.emit("inventory_balances", (lot_id, warehouse_id, quantity, 0, 0, timestamp(as_of)))
                movement_id += 1
                spool.emit("stock_movements", (
                    movement_id, lot_id, warehouse_id, "initial_receipt", quantity, 0, 0,
                    "initial_stock", lot_id, None, f"seed:{args.seed}:receipt:{lot_id}:{warehouse_id}",
                    timestamp(lot_received), json_text({"source": "synthetic initial stock"}),
                ))

    # Forecast rows are generated from product popularity and warehouse demand shares.
    forecast_id = 0
    for quarter in range(20):
        horizon_start = (start + timedelta(days=quarter * 91)).date()
        horizon_end = horizon_start + timedelta(days=90)
        calculated_at = timestamp(start + timedelta(days=quarter * 91))
        for product_id in range(1, product_count + 1):
            popularity = product_weights[product_id - 1] / weight_total
            for warehouse_id in range(1, 4):
                forecast_id += 1
                predicted = max(0.0, item_target * popularity * REGION_SHARE[warehouse_id - 1] / 20)
                spool.emit("demand_forecasts", (forecast_id, product_id, warehouse_id, horizon_start.isoformat(), horizon_end.isoformat(), f"{predicted:.3f}", "synthetic-v1", calculated_at))

    # Replenishment paperwork groups one selected lot from each product/warehouse pair.
    po_id = 0
    po_item_id = 0
    for warehouse_id in range(1, 4):
        for block in range(20):
            po_id += 1
            ordered_at = start + timedelta(days=block * 91 + warehouse_id * 3)
            spool.emit("purchase_orders", (po_id, warehouse_id, f"Synthetic Supplier {warehouse_id}", "received", (ordered_at + timedelta(days=10)).date().isoformat(), timestamp(ordered_at), timestamp(ordered_at)))
            for offset in range(min(25, product_count)):
                product_id = ((block * 25 + offset) % product_count) + 1
                po_item_id += 1
                lot_id = lot_id_for[(product_id, (block + offset) % 2)]
                qty = next(q for candidate_lot, q in balances_by_product_warehouse[(product_id, warehouse_id)] if candidate_lot == lot_id)
                spool.emit("po_items", (po_item_id, po_id, product_id, qty, qty, lot_id))

    order_days = []
    eligible_days = [start.date() + timedelta(days=i) for i in range(5 * 365 - 60)]
    day_weights = []
    for current in eligible_days:
        seasonal = 1.45 if current.month in (11, 12) else 1.0
        weekend = 1.25 if current.weekday() >= 5 else 1.0
        day_weights.append(seasonal * weekend)
    selected_days = date_rng.choices(eligible_days, weights=day_weights, k=order_count)
    for selected_day in selected_days:
        hour = date_rng.choices((8, 10, 13, 16, 19, 22, 2, 4), weights=(1.1, 1.8, 1.6, 1.1, 1.7, 0.7, 0.2, 0.1), k=1)[0]
        minute = date_rng.randrange(60)
        second = date_rng.randrange(60)
        order_days.append(datetime.combine(selected_day, day_time(hour, minute, second), tzinfo=timezone.utc))
    order_days.sort()

    # Give each order 2 or 3 unique product lines in the default 400k/1M profile.
    line_counts = [2] * order_count
    difference = item_target - 2 * order_count
    line_plan_rng = random.Random(args.seed + 8)
    if difference > 0:
        for index in line_plan_rng.sample(range(order_count), difference):
            line_counts[index] += 1
    elif difference < 0:
        for index in line_plan_rng.sample(range(order_count), -difference):
            line_counts[index] -= 1

    order_item_id = 0
    allocation_id = 0
    shipment_id = 0
    shipment_item_id = 0
    event_id = 0
    return_id = 0
    return_item_id = 0
    inspection_id = 0
    audit_id = 0
    delivered_shipment_items = 0
    order_item_rows = 0
    shipment_rows = 0
    return_rows = 0

    for order_id, placed_at in enumerate(order_days, start=1):
        customer_index = draw_weighted(rng, customer_cumulative)
        customer_id = customer_index + 1
        region = region_for_customer[customer_index]
        destination_city, destination_region, postal = CITY_REGION[region]
        customer_first = FIRST_NAMES[(customer_id * 7 + args.seed) % len(FIRST_NAMES)]
        customer_last = LAST_NAMES[(customer_id * 11 + args.seed) % len(LAST_NAMES)]
        delivery_at = placed_at + timedelta(days=3)
        chosen_products: list[int] = []
        while len(chosen_products) < line_counts[order_id - 1]:
            candidate = draw_weighted(rng, product_cumulative) + 1
            if candidate not in chosen_products:
                chosen_products.append(candidate)
        item_allocations: list[dict[str, Any]] = []
        any_cancelled = False
        any_fulfillable = False
        for product_id in chosen_products:
            order_item_id += 1
            order_item_rows += 1
            quantity = rng.choices((1, 2, 3), weights=(0.55, 0.35, 0.10), k=1)[0]
            cancelled_quantity = rng.randint(1, quantity) if rng.random() < 0.02 else 0
            fulfill_quantity = quantity - cancelled_quantity
            any_cancelled = any_cancelled or cancelled_quantity > 0
            any_fulfillable = any_fulfillable or fulfill_quantity > 0
            price = f"{7.99 + ((product_id * 137) % 29000) / 100:.2f}"
            spool.emit("order_items", (order_item_id, order_id, product_id, quantity, price, cancelled_quantity, timestamp(placed_at)))

            preferred = REGIONS.index(region)
            if warehouse_rng.random() < 0.80:
                warehouse_order = [preferred] + [idx for idx in range(3) if idx != preferred]
            else:
                warehouse_order = warehouse_rng.sample([idx for idx in range(3) if idx != preferred], 2) + [preferred]
            remaining = quantity
            cancel_remaining = cancelled_quantity
            allocations_for_line: list[tuple[int, int, int]] = []
            allocation_quantities: dict[int, int] = {}
            allocation_shipped: dict[int, int] = {}
            for warehouse_index in warehouse_order:
                warehouse_id = warehouse_index + 1
                lots = balances_by_product_warehouse[(product_id, warehouse_id)]
                lots = sorted(lots, key=lambda pair: balance_state[(pair[0], warehouse_id)]["on_hand"] - balance_state[(pair[0], warehouse_id)]["reserved"] - balance_state[(pair[0], warehouse_id)]["unavailable"], reverse=True)
                for current_lot_id, _ in lots:
                    state = balance_state[(current_lot_id, warehouse_id)]
                    available = state["on_hand"] - state["reserved"] - state["unavailable"]
                    allocated = min(remaining, available)
                    if allocated <= 0:
                        continue
                    remaining -= allocated
                    allocation_id += 1
                    allocations_for_line.append((allocation_id, current_lot_id, warehouse_id))
                    allocation_quantities[allocation_id] = allocated
                    state["reserved"] += allocated
                    released_here = min(cancel_remaining, allocated)
                    cancel_remaining -= released_here
                    shipped_here = allocated - released_here
                    allocation_shipped[allocation_id] = shipped_here
                    state["reserved"] -= released_here
                    state["on_hand"] -= shipped_here
                    state["reserved"] -= shipped_here
                    any_fulfillable = any_fulfillable or shipped_here > 0
                    allocation_status = "released" if shipped_here == 0 else ("partially_shipped" if released_here else "shipped")
                    spool.emit("allocations", (
                        allocation_id, order_item_id, order_id, product_id, current_lot_id, warehouse_id,
                        allocated, shipped_here, released_here, allocation_status, timestamp(placed_at), timestamp(delivery_at),
                    ))
                    movement_id += 1
                    spool.emit("stock_movements", (
                        movement_id, current_lot_id, warehouse_id, "order_reserved", 0, allocated, 0,
                        "allocation", allocation_id, None, f"seed:{args.seed}:reserve:{allocation_id}",
                        timestamp(placed_at), json_text({"order_id": order_id, "order_item_id": order_item_id}),
                    ))
                    if released_here:
                        movement_id += 1
                        spool.emit("stock_movements", (
                            movement_id, current_lot_id, warehouse_id, "order_cancel_released", 0, -released_here, 0,
                            "allocation", allocation_id, None, f"seed:{args.seed}:release:{allocation_id}",
                            timestamp(placed_at + timedelta(hours=2)), json_text({"order_id": order_id, "order_item_id": order_item_id}),
                        ))
                    if shipped_here:
                        movement_id += 1
                        spool.emit("stock_movements", (
                            movement_id, current_lot_id, warehouse_id, "order_shipped", -shipped_here, -shipped_here, 0,
                            "allocation", allocation_id, None, f"seed:{args.seed}:ship:{allocation_id}",
                            timestamp(placed_at + timedelta(days=1)), json_text({"order_id": order_id, "order_item_id": order_item_id}),
                        ))
                    if remaining == 0:
                        break
                if remaining == 0:
                    break
            if remaining:
                raise RuntimeError(f"Generated stock insufficient for product {product_id}; increase stock safety factor")
            item_allocations.append({
                "order_item_id": order_item_id,
                "product_id": product_id,
                "quantity": quantity,
                "cancelled_quantity": cancelled_quantity,
                "allocations": allocations_for_line,
                "allocation_qty": allocation_quantities,
                "allocation_shipped": allocation_shipped,
            })

        order_status = "partially_cancelled" if any_cancelled and any_fulfillable else ("cancelled" if not any_fulfillable else "delivered")
        order_updated = delivery_at if any_fulfillable else placed_at
        spool.emit("orders", (
            order_id, customer_id, order_status, "standard",
            str(uuid.uuid5(NAMESPACE, f"request:{args.seed}:{order_id}")),
            f"{customer_first} {customer_last}", f"{100 + (customer_id % 9900)} {STREETS[customer_id % len(STREETS)]}",
            None, destination_city, destination_region, postal, "US", timestamp(placed_at), timestamp(order_updated), None,
        ))
        audit_id += 1
        spool.emit("audit_log", (audit_id, customer_user_ids[customer_index], "order", order_id, "synthetic_order_created", timestamp(placed_at), str(uuid.uuid5(NAMESPACE, f"audit:{args.seed}:order:{order_id}")), None, json_text({"source": "synthetic generator", "partially_cancelled": any_cancelled})))

        by_warehouse: dict[int, list[tuple[dict[str, Any], int, int, int]]] = {}
        for item in item_allocations:
            for allocation_id, current_lot_id, warehouse_id in item["allocations"]:
                allocation_ship_qty = item["allocation_shipped"][allocation_id]
                if allocation_ship_qty:
                    by_warehouse.setdefault(warehouse_id, []).append((item, allocation_id, current_lot_id, allocation_ship_qty))

        for warehouse_id, shipment_lines in by_warehouse.items():
            shipment_id += 1
            shipment_rows += 1
            shipped_at = placed_at + timedelta(days=1)
            delivered_at = delivery_at
            tracking = f"SYN-{shipment_id:010d}"
            spool.emit("shipments", (shipment_id, order_id, warehouse_id, "delivered", tracking, timestamp(delivered_at), timestamp(shipped_at), timestamp(delivered_at), timestamp(placed_at)))
            for event_type, event_time in (("picked", placed_at + timedelta(hours=8)), ("shipped", shipped_at), ("delivered", delivered_at)):
                event_id += 1
                spool.emit("shipment_events", (event_id, shipment_id, event_type, timestamp(event_time), json_text({"source": "synthetic"}), f"seed:{args.seed}:shipment:{shipment_id}:{event_type}", timestamp(event_time)))
            audit_id += 1
            spool.emit("audit_log", (audit_id, employee_ids[(warehouse_id - 1) % employees], "shipment", shipment_id, "synthetic_shipment_delivered", timestamp(delivered_at), str(uuid.uuid5(NAMESPACE, f"audit:{args.seed}:shipment:{shipment_id}")), None, json_text({"order_id": order_id, "warehouse_id": warehouse_id})))

            for item, current_allocation_id, current_lot_id, _ in shipment_lines:
                shipped_quantity = item["allocation_shipped"][current_allocation_id]
                shipment_item_id += 1
                delivered_shipment_items += 1
                spool.emit("shipment_items", (shipment_item_id, shipment_id, order_id, warehouse_id, current_allocation_id, current_lot_id, shipped_quantity))

                if rng.random() < 0.06:
                    return_id += 1
                    return_item_id += 1
                    inspection_id += 1
                    return_rows += 1
                    returned_quantity = rng.randint(1, shipped_quantity)
                    received_at = delivered_at + timedelta(days=rng.randint(5, 45))
                    inspected_at = received_at + timedelta(days=1)
                    outcome = rng.choices(("restockable", "quarantine", "damaged"), weights=(0.72, 0.18, 0.10), k=1)[0]
                    disposition = {"restockable": "restock", "quarantine": "quarantine", "damaged": "damage"}[outcome]
                    rma = f"SYN-RMA-{return_id:08d}"
                    return_request_id = str(uuid.uuid5(NAMESPACE, f"return-request:{args.seed}:{order_id}:{return_id}"))
                    spool.emit("returns", (return_id, order_id, return_request_id, rma, "closed", timestamp(received_at), timestamp(received_at)))
                    spool.emit("return_items", (return_item_id, return_id, order_id, shipment_item_id, returned_quantity, returned_quantity, rng.choice(("changed_mind", "damaged_on_arrival", "wrong_item")), disposition, timestamp(received_at)))
                    inspection_request_id = str(uuid.uuid5(NAMESPACE, f"return-inspection:{args.seed}:{return_item_id}"))
                    spool.emit("return_inspections", (inspection_id, return_item_id, inspection_request_id, employee_ids[(warehouse_id + inspection_id) % employees], outcome, timestamp(inspected_at), "Synthetic inspection result"))
                    state = balance_state[(current_lot_id, warehouse_id)]
                    state["on_hand"] += returned_quantity
                    state["unavailable"] += returned_quantity
                    movement_id += 1
                    spool.emit("stock_movements", (movement_id, current_lot_id, warehouse_id, "return_received_inspection", returned_quantity, 0, returned_quantity, "return_item", return_item_id, employee_ids[(warehouse_id + inspection_id) % employees], f"seed:{args.seed}:return-receive:{return_item_id}", timestamp(received_at), json_text({"outcome": outcome})))
                    if outcome == "restockable":
                        state["unavailable"] -= returned_quantity
                        movement_id += 1
                        spool.emit("stock_movements", (movement_id, current_lot_id, warehouse_id, "return_restocked", 0, 0, -returned_quantity, "return_item", return_item_id, employee_ids[(warehouse_id + inspection_id) % employees], f"seed:{args.seed}:return-restock:{return_item_id}", timestamp(inspected_at), json_text({"outcome": outcome})))

    # Completed, idempotent inter-warehouse transfers use the same lot in both warehouses.
    transfer_id = 0
    transfer_item_id = 0
    transfer_event_id = 0
    transfer_rng = random.Random(args.seed + 5)
    for index in range(args.transfers):
        source = transfer_rng.randrange(1, 4)
        destination = (source + transfer_rng.randrange(1, 3) - 1) % 3 + 1
        candidates = [key for key, state in balance_state.items() if state["warehouse_id"] == source and state["on_hand"] - state["reserved"] - state["unavailable"] > 8]
        if not candidates:
            continue
        current_lot_id, source_warehouse = transfer_rng.choice(candidates)
        state = balance_state[(current_lot_id, source_warehouse)]
        quantity = min(transfer_rng.randint(1, 5), state["on_hand"] - state["reserved"] - state["unavailable"])
        transfer_id += 1
        event_time = as_of - timedelta(days=transfer_rng.randint(5, 60))
        transfer_request_id = str(uuid.uuid5(NAMESPACE, f"transfer-request:{args.seed}:{transfer_id}"))
        spool.emit("transfers", (transfer_id, source, destination, "received", transfer_request_id, manager_id, manager_id, timestamp(event_time - timedelta(days=2)), timestamp(event_time - timedelta(days=1)), timestamp(event_time)))
        transfer_item_id += 1
        spool.emit("transfer_items", (transfer_item_id, transfer_id, source, destination, current_lot_id, quantity, quantity, timestamp(event_time - timedelta(days=2))))
        source_balance = balance_state[(current_lot_id, source)]
        destination_balance = balance_state[(current_lot_id, destination)]
        source_balance["on_hand"] -= quantity
        destination_balance["on_hand"] += quantity
        for event_type, actor, when in (("requested", manager_id, event_time - timedelta(days=2)), ("approved", manager_id, event_time - timedelta(days=2, hours=-1)), ("dispatched", employee_ids[source - 1], event_time - timedelta(days=1)), ("received", employee_ids[destination - 1], event_time)):
            transfer_event_id += 1
            source_event_key = f"seed:{args.seed}:transfer:{transfer_id}:{event_type}"
            spool.emit("transfer_events", (transfer_event_id, transfer_id, event_type, timestamp(when), actor, json_text({"source": "synthetic"}), source_event_key))
        movement_id += 1
        spool.emit("stock_movements", (movement_id, current_lot_id, source, "transfer_dispatched", -quantity, 0, 0, "transfer", transfer_id, employee_ids[source - 1], f"seed:{args.seed}:transfer-out:{transfer_item_id}", timestamp(event_time - timedelta(days=1)), json_text({"destination_warehouse_id": destination})))
        movement_id += 1
        spool.emit("stock_movements", (movement_id, current_lot_id, destination, "transfer_received", quantity, 0, 0, "transfer", transfer_id, employee_ids[destination - 1], f"seed:{args.seed}:transfer-in:{transfer_item_id}", timestamp(event_time), json_text({"source_warehouse_id": source})))
        audit_id += 1
        spool.emit("audit_log", (audit_id, manager_id, "transfer", transfer_id, "synthetic_transfer_received", timestamp(event_time), str(uuid.uuid5(NAMESPACE, f"audit:{args.seed}:transfer:{transfer_id}")), None, json_text({"source": source, "destination": destination})))

    # One final snapshot count per warehouse records the post-generation balance exactly.
    count_id = 0
    count_item_id = 0
    counted_at = as_of - timedelta(days=1)
    for warehouse_id in range(1, 4):
        count_id += 1
        spool.emit("cycle_counts", (
            count_id, warehouse_id, "approved", employee_ids[warehouse_id - 1], manager_id,
            timestamp(counted_at - timedelta(hours=2)), timestamp(counted_at),
        ))
        candidates = [key for key, state in balance_state.items() if state["warehouse_id"] == warehouse_id]
        for current_lot_id, _ in candidates[: min(100, len(candidates))]:
            count_item_id += 1
            quantity = balance_state[(current_lot_id, warehouse_id)]["on_hand"]
            spool.emit("cycle_count_items", (count_item_id, count_id, current_lot_id, warehouse_id, quantity, quantity, timestamp(counted_at)))

    # Scenario alerts are evidence records, not claims that every alert is a confirmed defect.
    alert_id = 0
    alert_rng = random.Random(args.seed + 6)
    alert_candidates = list(balance_state.items())
    alert_rng.shuffle(alert_candidates)
    for (current_lot_id, warehouse_id), state in alert_candidates[: min(args.alerts, len(alert_candidates))]:
        alert_id += 1
        product_id = state["product_id"]
        alert_type = alert_rng.choice(("low_stock_risk", "warehouse_imbalance", "lot_quality_review"))
        status = alert_rng.choices(("open", "acknowledged", "resolved"), weights=(0.55, 0.25, 0.20), k=1)[0]
        opened = as_of - timedelta(days=alert_rng.randint(1, 120))
        spool.emit("alerts", (
            alert_id, alert_type, alert_rng.choice(("warning", "critical")), status,
            product_id, warehouse_id, current_lot_id, f"seed:{args.seed}:alert:{alert_type}:{current_lot_id}:{warehouse_id}",
            json_text({"available": state["on_hand"] - state["reserved"] - state["unavailable"], "generated": True}),
            timestamp(opened), timestamp(opened + timedelta(hours=2)) if status != "open" else None,
            timestamp(opened + timedelta(days=1)) if status == "resolved" else None,
            manager_id,
        ))

    recall_rng = random.Random(args.seed + 7)
    for recall_id in range(1, min(args.recalls, lot_id) + 1):
        selected_lot = recall_rng.randint(1, lot_id)
        opened = as_of - timedelta(days=recall_rng.randint(10, 200))
        spool.emit("recalls", (recall_id, selected_lot, f"SYN-CASE-{recall_id:05d}", "investigating", "Synthetic batch quality investigation", manager_id, timestamp(opened), None))

    spool.close()

    return {
        "users": customer_count + employees + 1,
        "customers": customer_count,
        "products": product_count,
        "lots": lot_id,
        "inventory_balances": len(balance_state),
        "orders": order_count,
        "order_items": order_item_rows,
        "allocations": allocation_id,
        "shipments": shipment_rows,
        "shipment_items": delivered_shipment_items,
        "returns": return_rows,
        "transfers": transfer_id,
        "alerts": alert_id,
        "recalls": min(args.recalls, lot_id),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate and load a reproducible synthetic warehouse workload.")
    parser.add_argument("--database-url", default=None, help="PostgreSQL URL; defaults to DATABASE_URL")
    parser.add_argument("--seed", type=int, default=20261022)
    parser.add_argument("--as-of", default="2026-10-22T23:59:59+00:00", help="Fixed ISO timestamp; include UTC offset")
    parser.add_argument("--customers", type=int, default=50_000)
    parser.add_argument("--products", type=int, default=500)
    parser.add_argument("--orders", type=int, default=400_000)
    parser.add_argument("--order-items", type=int, default=1_000_000)
    parser.add_argument("--transfers", type=int, default=500)
    parser.add_argument("--alerts", type=int, default=1_500)
    parser.add_argument("--recalls", type=int, default=25)
    parser.add_argument("--allow-small", action="store_true", help="Permit a sub-million test load; do not use for the course scale dataset")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.database_url = args.database_url or __import__("os").environ.get("DATABASE_URL")
    if not args.database_url:
        raise SystemExit("Pass --database-url or set DATABASE_URL")
    start_time = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="multiwarehouse-seed-") as temporary:
        root = Path(temporary)
        print(f"Generating synthetic rows with seed={args.seed} as_of={args.as_of}", flush=True)
        staging_started = time.perf_counter()
        counts = create_spool(args, root)
        if counts["order_items"] < 1_000_000 and not args.allow_small:
            raise RuntimeError(f"Generator produced only {counts['order_items']} order-item rows; required minimum is 1,000,000")
        staging_seconds = time.perf_counter() - staging_started
        print("Staging complete; opening database transaction", flush=True)
        loading_started = time.perf_counter()
        with psycopg.connect(args.database_url) as connection:
            ensure_local_database_empty(connection)
            loaded: dict[str, int] = {}
            for table in LOAD_ORDER:
                count = stream_copy(connection, root, table)
                if count:
                    loaded[table] = count
                    print(f"loaded {table}: {count:,}", flush=True)
            adjust_identity_sequences(connection)
            # The stock balance rows were staged at their initial receipt state.
            # Movement rows reconcile the final state; replay is summarized into balances below.
            as_of = datetime.fromisoformat(args.as_of.replace("Z", "+00:00")).astimezone(timezone.utc)
            apply_movement_totals(connection, as_of)
            connection.commit()
            table_stats = measure_table_stats(connection)
        elapsed = time.perf_counter() - start_time
        load_seconds = time.perf_counter() - loading_started
        print(json.dumps({
            "seed": args.seed,
            "as_of": args.as_of,
            "loaded_rows": loaded,
            "table_stats": table_stats,
            "staging_seconds": round(staging_seconds, 2),
            "database_load_seconds": round(load_seconds, 2),
            "elapsed_seconds": round(elapsed, 2),
        }, indent=2))


def apply_movement_totals(connection: psycopg.Connection, as_of: datetime) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """UPDATE inventory_balances b
                  SET on_hand = m.on_hand,
                      reserved = m.reserved,
                      unavailable = m.unavailable,
                      updated_at = %s
                 FROM (
                   SELECT lot_id, warehouse_id,
                          sum(on_hand_delta)::integer AS on_hand,
                          sum(reserved_delta)::integer AS reserved,
                          sum(unavailable_delta)::integer AS unavailable
                     FROM stock_movements
                    GROUP BY lot_id, warehouse_id
                 ) m
                WHERE b.lot_id = m.lot_id AND b.warehouse_id = m.warehouse_id""",
            [as_of],
        )


if __name__ == "__main__":
    main()
