import type { PoolClient } from "pg";
import type { OrderDetail } from "./dto.js";
import { ApiError } from "../../shared/errors.js";
export async function readOrder(
  client: PoolClient,
  customerId: number,
  orderId: number,
): Promise<OrderDetail> {
  const header = await client.query(
    `SELECT order_id::float8 AS order_id,status,service_level,placed_at,destination_name,destination_line1,destination_line2,destination_city,destination_region,destination_postal_code,destination_country_code FROM orders WHERE order_id=$1 AND customer_id=$2`,
    [orderId, customerId],
  );
  if (!header.rows[0]) throw new ApiError(404, "NOT_FOUND", "Order not found");
  const items = await client.query(
    `SELECT i.order_item_id::float8 AS order_item_id,i.product_id::float8 AS product_id,p.name,p.category,i.quantity,i.unit_price::text,i.cancelled_quantity,
    COALESCE((SELECT sum(a.allocated_quantity-a.shipped_quantity-a.released_quantity)::integer FROM allocations a WHERE a.order_item_id=i.order_item_id),0) AS reserved_quantity,
    COALESCE((SELECT sum(a.shipped_quantity)::integer FROM allocations a WHERE a.order_item_id=i.order_item_id),0) AS shipped_quantity,
    COALESCE((SELECT sum(si.quantity)::integer FROM shipment_items si JOIN shipments s ON s.shipment_id=si.shipment_id JOIN allocations a ON a.allocation_id=si.allocation_id WHERE a.order_item_id=i.order_item_id AND s.status='delivered' AND s.delivered_at IS NOT NULL),0) AS delivered_quantity
    FROM order_items i JOIN products p ON p.product_id=i.product_id WHERE i.order_id=$1 ORDER BY i.order_item_id`,
    [orderId],
  );
  const allocations = await client.query(
    `SELECT a.allocation_id::float8 AS allocation_id,a.order_item_id::float8 AS order_item_id,a.product_id::float8 AS product_id,a.lot_id::float8 AS lot_id,l.lot_code,a.warehouse_id::float8 AS warehouse_id,w.name AS warehouse_name,a.allocated_quantity,a.shipped_quantity,a.released_quantity,a.status FROM allocations a JOIN lots l ON l.lot_id=a.lot_id JOIN warehouses w ON w.warehouse_id=a.warehouse_id WHERE a.order_id=$1 ORDER BY a.allocation_id`,
    [orderId],
  );
  const shipments = await client.query(
    `SELECT s.shipment_id::float8 AS shipment_id,s.warehouse_id::float8 AS warehouse_id,w.name AS warehouse_name,s.status,s.tracking_code,s.eta,s.shipped_at,s.delivered_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('shipment_item_id',si.shipment_item_id::float8,'order_item_id',a.order_item_id::float8,'product_id',a.product_id::float8,'lot_code',l.lot_code,'quantity',si.quantity,'returnable_quantity',CASE WHEN s.status='delivered' AND s.delivered_at IS NOT NULL THEN GREATEST(0,si.quantity-COALESCE((SELECT sum(CASE WHEN r.status='rejected' THEN ri.received_quantity ELSE ri.requested_quantity END)::integer FROM return_items ri JOIN returns r ON r.return_id=ri.return_id WHERE ri.shipment_item_id=si.shipment_item_id),0)) ELSE 0 END) ORDER BY si.shipment_item_id) FROM shipment_items si JOIN allocations a ON a.allocation_id=si.allocation_id JOIN lots l ON l.lot_id=si.lot_id WHERE si.shipment_id=s.shipment_id),'[]'::jsonb) AS items,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('event_type',e.event_type,'occurred_at',e.occurred_at,'details',e.details) ORDER BY e.occurred_at,e.shipment_event_id) FROM shipment_events e WHERE e.shipment_id=s.shipment_id),'[]'::jsonb) AS events
    FROM shipments s JOIN warehouses w ON w.warehouse_id=s.warehouse_id WHERE s.order_id=$1 ORDER BY s.shipment_id`,
    [orderId],
  );
  const returns = await client.query(
    `SELECT r.return_id::float8 AS return_id,r.rma_code,r.status,r.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('shipment_item_id',ri.shipment_item_id::float8,'requested_quantity',ri.requested_quantity,'reason',ri.reason) ORDER BY ri.shipment_item_id) FROM return_items ri WHERE ri.return_id=r.return_id),'[]'::jsonb) AS items FROM returns r WHERE r.order_id=$1 ORDER BY r.return_id`,
    [orderId],
  );
  return {
    ...header.rows[0],
    items: items.rows.map((i) => ({
      ...i,
      cancellable_quantity: Math.max(
        0,
        Math.min(
          i.reserved_quantity,
          i.quantity - i.cancelled_quantity - i.shipped_quantity,
        ),
      ),
    })),
    allocations: allocations.rows,
    shipments: shipments.rows,
    returns: returns.rows,
  };
}
