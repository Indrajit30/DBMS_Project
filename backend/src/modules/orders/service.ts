import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthenticatedUser } from "../../shared/types.js";
import type {
  CreateOrderRequest,
  CancelOrderRequest,
  CreateReturnRequest,
} from "../../shared/contracts.js";
import { ApiError } from "../../shared/errors.js";
import { planAllocation, type Balance } from "./allocation.js";
import {
  transaction,
  operationLock,
  audit,
  fingerprint,
} from "./transaction.js";
import { readOrder } from "./read.js";
function customer(auth: AuthenticatedUser): number {
  if (auth.role !== "customer" || auth.customerId === null)
    throw new ApiError(403, "FORBIDDEN", "A customer account is required");
  return auth.customerId;
}
function canonical(input: CreateOrderRequest) {
  return {
    service_level: input.service_level ?? "standard",
    destination: {
      ...input.destination,
      line2: input.destination.line2 || null,
    },
    items: [...input.items].sort((a, b) => a.product_id - b.product_id),
  };
}
function canonicalHash(input: CreateOrderRequest): string {
  const normalized = canonical(input);
  // Explicit field order makes equality independent of client JSON property ordering.
  const d = normalized.destination;
  return fingerprint({
    service_level: normalized.service_level,
    destination: {
      name: d.name,
      line1: d.line1,
      line2: d.line2,
      city: d.city,
      region: d.region,
      postal_code: d.postal_code,
      country_code: d.country_code,
    },
    items: normalized.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
    })),
  });
}
async function ownLocked(client: PoolClient, id: number, customerId: number) {
  const result = await client.query(
    "SELECT * FROM orders WHERE order_id=$1 AND customer_id=$2 FOR UPDATE",
    [id, customerId],
  );
  if (!result.rows[0]) throw new ApiError(404, "NOT_FOUND", "Order not found");
  return result.rows[0];
}
export async function createOrder(
  auth: AuthenticatedUser,
  input: CreateOrderRequest,
  key: string,
) {
  const customerId = customer(auth),
    normalized = canonical(input),
    hash = canonicalHash(input);
  return transaction(async (client) => {
    await operationLock(client, customerId, "order", key);
    const old = await client.query(
      "SELECT * FROM orders WHERE customer_id=$1 AND request_id=$2",
      [customerId, key],
    );
    if (old.rows[0]) {
      const o = old.rows[0];
      const saved = await client.query(
        "SELECT after_data->>'fingerprint' AS fingerprint FROM audit_log WHERE entity_type='order' AND entity_id=$1 AND action='customer_order_placed' ORDER BY audit_id LIMIT 1",
        [o.order_id],
      );
      let oldHash = saved.rows[0]?.fingerprint as string | undefined;
      if (!oldHash) {
        const lines = await client.query(
          "SELECT product_id::float8 AS product_id,quantity FROM order_items WHERE order_id=$1 ORDER BY product_id",
          [o.order_id],
        );
        oldHash = canonicalHash({
          service_level: o.service_level,
          destination: {
            name: o.destination_name,
            line1: o.destination_line1,
            line2: o.destination_line2,
            city: o.destination_city,
            region: o.destination_region,
            postal_code: o.destination_postal_code,
            country_code: o.destination_country_code,
          },
          items: lines.rows,
        });
      }
      if (oldHash !== hash)
        throw new ApiError(
          409,
          "CONFLICT",
          "Idempotency key was used for a different order payload",
        );
      return {
        order: await readOrder(client, customerId, Number(o.order_id)),
        replayed: true,
      };
    }
    const ids = normalized.items.map((i) => i.product_id);
    const products = await client.query<{
      product_id: number;
      list_price: string;
      is_active: boolean;
    }>(
      "SELECT product_id::float8 AS product_id,list_price::text,is_active FROM products WHERE product_id=ANY($1::bigint[]) ORDER BY product_id FOR SHARE",
      [ids],
    );
    if (
      products.rows.length !== ids.length ||
      products.rows.some((p) => !p.is_active)
    )
      throw new ApiError(
        409,
        "CONFLICT",
        "One or more products are unavailable",
      );
    const warehouses = await client.query<{ warehouse_id: string }>(
      "SELECT warehouse_id FROM warehouses WHERE is_active ORDER BY warehouse_id FOR SHARE",
    );
    const lots = await client.query<{ lot_id: string }>(
      "SELECT lot_id FROM lots WHERE product_id=ANY($1::bigint[]) AND status='active' AND (expires_on IS NULL OR expires_on>=CURRENT_DATE) ORDER BY lot_id FOR SHARE",
      [ids],
    );
    const balances = await client.query<Balance>(
      `SELECT b.lot_id::float8 AS lot_id,b.warehouse_id::float8 AS warehouse_id,l.product_id::float8 AS product_id,b.available,l.received_at FROM inventory_balances b JOIN lots l ON l.lot_id=b.lot_id WHERE b.lot_id=ANY($1::bigint[]) AND b.warehouse_id=ANY($2::bigint[]) ORDER BY b.warehouse_id,b.lot_id FOR UPDATE OF b`,
      [
        lots.rows.map((l) => l.lot_id),
        warehouses.rows.map((w) => w.warehouse_id),
      ],
    );
    let plan;
    try {
      plan = planAllocation(normalized.items, balances.rows);
    } catch {
      throw new ApiError(
        409,
        "CONFLICT",
        "Insufficient eligible stock; no items were reserved",
      );
    }
    const d = normalized.destination;
    const order = await client.query<{ order_id: string }>(
      `INSERT INTO orders(customer_id,status,service_level,request_id,destination_name,destination_line1,destination_line2,destination_city,destination_region,destination_postal_code,destination_country_code) VALUES($1,'allocated',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING order_id`,
      [
        customerId,
        normalized.service_level,
        key,
        d.name,
        d.line1,
        d.line2,
        d.city,
        d.region,
        d.postal_code,
        d.country_code,
      ],
    );
    const orderId = Number(order.rows[0]!.order_id);
    const itemIds = new Map<number, number>();
    for (const item of normalized.items) {
      const result = await client.query<{ order_item_id: string }>(
        "INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES($1,$2,$3,$4::numeric) RETURNING order_item_id",
        [
          orderId,
          item.product_id,
          item.quantity,
          products.rows.find((p) => p.product_id === item.product_id)!
            .list_price,
        ],
      );
      itemIds.set(item.product_id, Number(result.rows[0]!.order_item_id));
    }
    for (const a of plan) {
      const updated = await client.query(
        "UPDATE inventory_balances SET reserved=reserved+$3,updated_at=now() WHERE lot_id=$1 AND warehouse_id=$2 AND available>=$3 RETURNING lot_id",
        [a.lot_id, a.warehouse_id, a.quantity],
      );
      if (updated.rowCount !== 1)
        throw new ApiError(
          409,
          "CONFLICT",
          "Stock changed; no items were reserved",
        );
      const allocation = await client.query<{ allocation_id: string }>(
        `INSERT INTO allocations(order_item_id,order_id,product_id,lot_id,warehouse_id,allocated_quantity) VALUES($1,$2,$3,$4,$5,$6) RETURNING allocation_id`,
        [
          itemIds.get(a.product_id),
          orderId,
          a.product_id,
          a.lot_id,
          a.warehouse_id,
          a.quantity,
        ],
      );
      await client.query(
        `INSERT INTO stock_movements(lot_id,warehouse_id,event_type,reserved_delta,reference_type,reference_id,actor_user_id,idempotency_key) VALUES($1,$2,'order_reserved',$3,'order',$4,$5,$6)`,
        [
          a.lot_id,
          a.warehouse_id,
          a.quantity,
          orderId,
          auth.userId,
          `customer:reserve:${allocation.rows[0]!.allocation_id}`,
        ],
      );
    }
    await audit(
      client,
      auth.userId,
      "order",
      orderId,
      "customer_order_placed",
      key,
      { fingerprint: hash },
    );
    return {
      order: await readOrder(client, customerId, orderId),
      replayed: false,
    };
  });
}
export async function cancelOrder(
  auth: AuthenticatedUser,
  orderId: number,
  input: CancelOrderRequest,
  key: string,
) {
  const customerId = customer(auth),
    normalized = [...input.items]
      .sort((a, b) => a.order_item_id - b.order_item_id)
      .map((i) => ({ order_item_id: i.order_item_id, quantity: i.quantity }));
  const hash = fingerprint({ order_id: orderId, items: normalized });
  return transaction(async (client) => {
    await operationLock(client, customerId, "cancel", key);
    const replay = await client.query(
      "SELECT entity_id,after_data FROM audit_log WHERE actor_user_id=$1 AND action='customer_order_cancelled' AND request_id=$2 ORDER BY audit_id LIMIT 1",
      [auth.userId, key],
    );
    if (replay.rows[0]) {
      if (
        Number(replay.rows[0].entity_id) !== orderId ||
        replay.rows[0].after_data.fingerprint !== hash
      )
        throw new ApiError(
          409,
          "CONFLICT",
          "Idempotency key was used for another cancellation",
        );
      return readOrder(client, customerId, orderId);
    }
    await ownLocked(client, orderId, customerId);
    const items = await client.query<{
      order_item_id: number;
      quantity: number;
      cancelled_quantity: number;
    }>(
      "SELECT order_item_id::float8 AS order_item_id,quantity,cancelled_quantity FROM order_items WHERE order_id=$1 ORDER BY order_item_id FOR UPDATE",
      [orderId],
    );
    const allocations = await client.query<{
      allocation_id: number;
      order_item_id: number;
      lot_id: number;
      warehouse_id: number;
      allocated_quantity: number;
      shipped_quantity: number;
      released_quantity: number;
    }>(
      `SELECT allocation_id::float8 AS allocation_id,order_item_id::float8 AS order_item_id,lot_id::float8 AS lot_id,warehouse_id::float8 AS warehouse_id,allocated_quantity,shipped_quantity,released_quantity FROM allocations WHERE order_id=$1 ORDER BY allocation_id FOR UPDATE`,
      [orderId],
    );
    const releases: Array<{
      allocation: (typeof allocations.rows)[number];
      quantity: number;
    }> = [];
    for (const requested of normalized) {
      const item = items.rows.find(
        (i) => i.order_item_id === requested.order_item_id,
      );
      if (!item) throw new ApiError(404, "NOT_FOUND", "Order item not found");
      let needed = requested.quantity;
      for (const a of allocations.rows.filter(
        (a) => a.order_item_id === item.order_item_id,
      )) {
        const q = Math.min(
          needed,
          a.allocated_quantity - a.shipped_quantity - a.released_quantity,
        );
        if (q > 0) releases.push({ allocation: a, quantity: q });
        needed -= q;
        if (!needed) break;
      }
      if (
        needed ||
        requested.quantity > item.quantity - item.cancelled_quantity
      )
        throw new ApiError(
          409,
          "CONFLICT",
          "Only currently reserved unshipped quantities can be cancelled",
        );
    }
    const balances = [
      ...new Map(
        releases.map((r) => [
          `${r.allocation.warehouse_id}:${r.allocation.lot_id}`,
          r.allocation,
        ]),
      ).values(),
    ].sort((a, b) => a.warehouse_id - b.warehouse_id || a.lot_id - b.lot_id);
    for (const a of balances)
      await client.query(
        "SELECT lot_id FROM inventory_balances WHERE lot_id=$1 AND warehouse_id=$2 FOR UPDATE",
        [a.lot_id, a.warehouse_id],
      );
    for (const { allocation: a, quantity: q } of releases) {
      const result = await client.query(
        "UPDATE inventory_balances SET reserved=reserved-$3,updated_at=now() WHERE lot_id=$1 AND warehouse_id=$2 AND reserved>=$3 RETURNING lot_id",
        [a.lot_id, a.warehouse_id, q],
      );
      if (result.rowCount !== 1)
        throw new ApiError(
          409,
          "CONFLICT",
          "Reservation changed; cancellation was not applied",
        );
      await client.query(
        `UPDATE allocations SET released_quantity=released_quantity+$2,status=CASE WHEN shipped_quantity=0 AND released_quantity+$2=allocated_quantity THEN 'cancelled' WHEN shipped_quantity+released_quantity+$2=allocated_quantity THEN 'shipped' ELSE status END,updated_at=now() WHERE allocation_id=$1`,
        [a.allocation_id, q],
      );
      await client.query(
        `INSERT INTO stock_movements(lot_id,warehouse_id,event_type,reserved_delta,reference_type,reference_id,actor_user_id,idempotency_key) VALUES($1,$2,'order_cancelled',$3,'order',$4,$5,$6)`,
        [
          a.lot_id,
          a.warehouse_id,
          -q,
          orderId,
          auth.userId,
          `customer:cancel:${orderId}:${key}:${a.allocation_id}`,
        ],
      );
    }
    for (const i of normalized)
      await client.query(
        "UPDATE order_items SET cancelled_quantity=cancelled_quantity+$2 WHERE order_item_id=$1",
        [i.order_item_id, i.quantity],
      );
    await client.query(
      `UPDATE orders SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=$1 AND cancelled_quantity<quantity) THEN 'cancelled' ELSE 'partially_cancelled' END,updated_at=now() WHERE order_id=$1`,
      [orderId],
    );
    await audit(
      client,
      auth.userId,
      "order",
      orderId,
      "customer_order_cancelled",
      key,
      { fingerprint: hash, items: normalized },
    );
    return readOrder(client, customerId, orderId);
  });
}
export async function createReturn(
  auth: AuthenticatedUser,
  input: CreateReturnRequest,
  key: string,
) {
  const customerId = customer(auth),
    normalized = [...input.items]
      .sort((a, b) => a.shipment_item_id - b.shipment_item_id)
      .map((i) => ({
        shipment_item_id: i.shipment_item_id,
        quantity: i.quantity,
        reason: i.reason,
      }));
  return transaction(async (client) => {
    await operationLock(client, customerId, "return", key);
    const existing = await client.query(
      "SELECT r.return_id::float8 AS return_id,r.order_id::float8 AS order_id,r.rma_code,r.status FROM returns r JOIN orders o ON o.order_id=r.order_id WHERE o.customer_id=$1 AND r.request_id=$2",
      [customerId, key],
    );
    if (existing.rows[0]) {
      const old = existing.rows[0];
      const saved = await client.query(
        "SELECT shipment_item_id::float8 AS shipment_item_id,requested_quantity AS quantity,reason FROM return_items WHERE return_id=$1 ORDER BY shipment_item_id",
        [old.return_id],
      );
      if (fingerprint(saved.rows) !== fingerprint(normalized))
        throw new ApiError(
          409,
          "CONFLICT",
          "Idempotency key was used for another return request",
        );
      return { result: { ...old, items: saved.rows }, replayed: true };
    }
    const ids = normalized.map((i) => i.shipment_item_id);
    const own = await client.query<{ order_id: string }>(
      `SELECT DISTINCT si.order_id FROM shipment_items si JOIN orders o ON o.order_id=si.order_id WHERE si.shipment_item_id=ANY($1::bigint[]) AND o.customer_id=$2`,
      [ids, customerId],
    );
    if (own.rows.length !== 1)
      throw new ApiError(
        404,
        "NOT_FOUND",
        "Eligible shipment items not found in one own order",
      );
    const orderId = Number(own.rows[0]!.order_id);
    await ownLocked(client, orderId, customerId);
    const shipmentItems = await client.query<{
      shipment_item_id: number;
      quantity: number;
      status: string;
      delivered_at: Date | null;
    }>(
      `SELECT si.shipment_item_id::float8 AS shipment_item_id,si.quantity,s.status,s.delivered_at FROM shipment_items si JOIN shipments s ON s.shipment_id=si.shipment_id WHERE si.shipment_item_id=ANY($1::bigint[]) AND si.order_id=$2 ORDER BY si.shipment_item_id FOR UPDATE OF si,s`,
      [ids, orderId],
    );
    if (shipmentItems.rows.length !== ids.length)
      throw new ApiError(404, "NOT_FOUND", "Shipment item not found");
    for (const item of normalized) {
      const shipped = shipmentItems.rows.find(
        (i) => i.shipment_item_id === item.shipment_item_id,
      )!;
      const used = await client.query<{ quantity: number }>(
        "SELECT COALESCE(sum(CASE WHEN r.status='rejected' THEN ri.received_quantity ELSE ri.requested_quantity END),0)::integer AS quantity FROM return_items ri JOIN returns r ON r.return_id=ri.return_id WHERE ri.shipment_item_id=$1",
        [item.shipment_item_id],
      );
      if (
        shipped.status !== "delivered" ||
        !shipped.delivered_at ||
        item.quantity > shipped.quantity - used.rows[0]!.quantity
      )
        throw new ApiError(
          409,
          "CONFLICT",
          "Return quantity exceeds currently eligible delivered units",
        );
    }
    const result = await client.query(
      `INSERT INTO returns(order_id,request_id,rma_code) VALUES($1,$2,$3) RETURNING return_id::float8 AS return_id,order_id::float8 AS order_id,rma_code,status`,
      [orderId, key, `RMA-${randomUUID()}`],
    );
    for (const item of normalized)
      await client.query(
        "INSERT INTO return_items(return_id,order_id,shipment_item_id,requested_quantity,reason) VALUES($1,$2,$3,$4,$5)",
        [
          result.rows[0]!.return_id,
          orderId,
          item.shipment_item_id,
          item.quantity,
          item.reason,
        ],
      );
    await audit(
      client,
      auth.userId,
      "return",
      result.rows[0]!.return_id,
      "customer_return_requested",
      key,
      { items: normalized },
    );
    return {
      result: { ...result.rows[0], items: normalized },
      replayed: false,
    };
  });
}
