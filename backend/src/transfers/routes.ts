import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../auth/middleware.js";
import { inTransaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";

const positiveId = z.number().int().positive().safe();
const receipt = z.object({
  items: z.array(z.object({
    transfer_item_id: positiveId,
    received_quantity: z.number().int().positive().max(2147483647),
  })).nonempty(),
});

export const transferRouter = Router();
transferRouter.post("/:transferId/receive", requireAuth, requireRoles("manager", "warehouse_employee"), async (req, res) => {
  const transferId = positiveId.safeParse(Number(req.params.transferId));
  const body = receipt.safeParse(req.body);
  const key = req.header("Idempotency-Key")?.trim();
  if (!transferId.success || !body.success || !key || key.length > 200) {
    throw new ApiError(400, "VALIDATION_ERROR", "Supply a valid transfer ID, receipt items and Idempotency-Key");
  }
  const items = body.data.items.sort((a, b) => a.transfer_item_id - b.transfer_item_id);
  if (new Set(items.map(item => item.transfer_item_id)).size !== items.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "Include each transfer item only once");
  }
  const id = transferId.data;
  const actor = req.auth!;
  const eventKey = JSON.stringify(["receipt", actor.userId, key]);
  const result = await inTransaction(async client => {
    const transfer = (await client.query(
      "SELECT destination_warehouse_id, status FROM transfers WHERE transfer_id=$1 FOR UPDATE", [id],
    )).rows[0];
    if (!transfer) throw new ApiError(404, "NOT_FOUND", "Transfer not found");
    const warehouse = transfer.destination_warehouse_id;
    if (actor.role !== "manager" && !actor.warehouseIds.includes(Number(warehouse))) {
      throw new ApiError(403, "FORBIDDEN", "Destination warehouse access required");
    }
    const prior = (await client.query(
      "SELECT details, details->'items' = $3::jsonb AS matches FROM transfer_events WHERE transfer_id=$1 AND source_event_key=$2",
      [id, eventKey, JSON.stringify(items)],
    )).rows[0];
    if (prior) {
      if (!prior.matches) throw new ApiError(409, "CONFLICT", "This key already identifies a different receipt");
      return prior.details.result;
    }
    if (!["in_transit", "partially_received"].includes(transfer.status)) {
      throw new ApiError(409, "CONFLICT", "Transfer is not awaiting receipt");
    }
    for (const item of items) {
      const quantity = item.received_quantity;
      const updated = await client.query(
        `UPDATE transfer_items SET received_quantity=received_quantity+$3
          WHERE transfer_id=$1 AND transfer_item_id=$2 AND quantity-received_quantity >= $3
          RETURNING lot_id`, [id, item.transfer_item_id, quantity],
      );
      if (!updated.rowCount) throw new ApiError(409, "CONFLICT", "Item or quantity does not match the outstanding transfer");
      const lot = updated.rows[0].lot_id;
      await client.query(
        `INSERT INTO inventory_balances(lot_id,warehouse_id,on_hand) VALUES ($1,$2,$3)
         ON CONFLICT (lot_id,warehouse_id) DO UPDATE
         SET on_hand=inventory_balances.on_hand+EXCLUDED.on_hand, updated_at=now()`, [lot, warehouse, quantity],
      );
      await client.query(
        `INSERT INTO stock_movements(lot_id,warehouse_id,on_hand_delta,event_type,reference_type,reference_id,actor_user_id,idempotency_key)
         VALUES ($1,$2,$3,'transfer_received','transfer',$4,$5,$6)`,
        [lot, warehouse, quantity, id, actor.userId, JSON.stringify([id, item.transfer_item_id, eventKey])],
      );
    }
    const totals = (await client.query(
      "SELECT sum(received_quantity) AS received, sum(quantity-received_quantity) AS remaining FROM transfer_items WHERE transfer_id=$1", [id],
    )).rows[0];
    const remaining = Number(totals.remaining);
    const status = remaining === 0 ? "received" : "partially_received";
    await client.query(
      "UPDATE transfers SET status=$2, received_at=CASE WHEN $2='received' THEN now() END WHERE transfer_id=$1", [id, status],
    );
    const data = { operation_id: id, status, received_quantity: Number(totals.received), in_transit_quantity: remaining };
    await client.query(
      `INSERT INTO transfer_events(transfer_id,event_type,actor_user_id,source_event_key,details)
       VALUES ($1,'transfer_received',$2,$3,$4)`, [id, actor.userId, eventKey, JSON.stringify({ items, result: data })],
    );
    return data;
  });
  res.json({ data: result, request_id: req.requestId });
});

transferRouter.post("/:transferId/dispatch", requireAuth, requireRoles("manager", "warehouse_employee"), async (req, res) => {
  const parsedId = positiveId.safeParse(Number(req.params.transferId));
  const key = req.header("Idempotency-Key")?.trim();
  if (!parsedId.success || !key || key.length > 200 || (req.body !== undefined && !z.object({}).strict().safeParse(req.body).success)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Dispatch takes a transfer ID, an Idempotency-Key and no items");
  }
  const id = parsedId.data;
  const actor = req.auth!;
  const eventKey = JSON.stringify(["dispatch", actor.userId, key]);
  const result = await inTransaction(async client => {
    const transfer = (await client.query(
      "SELECT source_warehouse_id, status FROM transfers WHERE transfer_id=$1 FOR UPDATE", [id],
    )).rows[0];
    if (!transfer) throw new ApiError(404, "NOT_FOUND", "Transfer not found");
    const source = transfer.source_warehouse_id;
    if (actor.role !== "manager" && !actor.warehouseIds.includes(Number(source))) {
      throw new ApiError(403, "FORBIDDEN", "Source warehouse access required");
    }
    const prior = await client.query(
      "SELECT details FROM transfer_events WHERE transfer_id=$1 AND source_event_key=$2", [id, eventKey],
    );
    if (prior.rowCount) return prior.rows[0].details.result;
    if (!["approved", "picking"].includes(transfer.status)) {
      throw new ApiError(409, "CONFLICT", "Transfer is not awaiting dispatch");
    }

    const items = await client.query(
      `SELECT i.lot_id, i.quantity, i.received_quantity,
              (SELECT sum(m.reserved_delta) FROM stock_movements m
                WHERE m.reference_type='transfer' AND m.reference_id=i.transfer_id
                  AND m.lot_id=i.lot_id AND m.warehouse_id=i.source_warehouse_id) AS held
         FROM transfer_items i WHERE i.transfer_id=$1 ORDER BY i.lot_id FOR UPDATE OF i`, [id],
    );
    if (!items.rowCount) throw new ApiError(409, "CONFLICT", "Transfer has no items");
    let dispatched = 0;
    for (const item of items.rows) {
      if (item.received_quantity !== 0 || Number(item.held) !== item.quantity) {
        throw new ApiError(409, "CONFLICT", "The approved lot quantity must be reserved for this transfer");
      }
      const balance = await client.query(
        `UPDATE inventory_balances SET on_hand=on_hand-$3, reserved=reserved-$3, updated_at=now()
          WHERE warehouse_id=$1 AND lot_id=$2 AND reserved >= $3`, [source, item.lot_id, item.quantity],
      );
      if (!balance.rowCount) throw new ApiError(409, "CONFLICT", "Source balance has insufficient reserved stock");
      await client.query(
        `INSERT INTO stock_movements(lot_id,warehouse_id,on_hand_delta,reserved_delta,event_type,reference_type,
                                     reference_id,actor_user_id,idempotency_key)
         VALUES ($1,$2,$3,$3,'transfer_dispatched','transfer',$4,$5,$6)`,
        [item.lot_id, source, -item.quantity, id, actor.userId, JSON.stringify([id, item.lot_id, eventKey])],
      );
      dispatched += item.quantity;
    }
    await client.query("UPDATE transfers SET status='in_transit', dispatched_at=now() WHERE transfer_id=$1", [id]);
    const data = { operation_id: id, status: "in_transit", in_transit_quantity: dispatched };
    await client.query(
      `INSERT INTO transfer_events(transfer_id,event_type,actor_user_id,source_event_key,details)
       VALUES ($1,'dispatched',$2,$3,$4)`, [id, actor.userId, eventKey, JSON.stringify({ result: data })],
    );
    return data;
  });
  res.json({ data: result, request_id: req.requestId });
});

const approval = z.object({
  source_warehouse_id: positiveId,
  destination_warehouse_id: positiveId,
  items: z.array(z.object({
    lot_id: positiveId,
    quantity: z.number().int().positive().max(2147483647),
  })).nonempty(),
});

transferRouter.post("/", requireAuth, requireRoles("manager"), async (req, res) => {
  const parsed = approval.safeParse(req.body);
  const key = z.string().uuid().safeParse(req.header("Idempotency-Key"));
  if (!parsed.success || !key.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Supply both warehouses, transfer items and a UUID Idempotency-Key");
  }
  const { source_warehouse_id: source, destination_warehouse_id: destination, items } = parsed.data;
  items.sort((a, b) => a.lot_id - b.lot_id);
  if (source === destination || new Set(items.map(item => item.lot_id)).size !== items.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "Choose distinct warehouses and include each lot once");
  }
  const manager = req.auth!.userId;
  const payload = JSON.stringify(parsed.data);
  const result = await inTransaction(async client => {
    const warehouses = await client.query(
      "SELECT warehouse_id FROM warehouses WHERE warehouse_id IN ($1,$2) ORDER BY warehouse_id FOR KEY SHARE", [source, destination],
    );
    if (warehouses.rowCount !== 2) throw new ApiError(404, "NOT_FOUND", "Warehouse not found");
    const created = await client.query(
      `INSERT INTO transfers(source_warehouse_id,destination_warehouse_id,status,requested_by,approved_by,request_id)
       VALUES ($1,$2,'approved',$3,$3,$4) ON CONFLICT (requested_by,request_id) DO NOTHING RETURNING transfer_id`,
      [source, destination, manager, key.data],
    );
    if (!created.rowCount) {
      const prior = (await client.query(
        `SELECT e.details->'result' AS result, e.details->'request'=$3::jsonb AS matches
           FROM transfers t JOIN transfer_events e USING (transfer_id)
          WHERE t.requested_by=$1 AND t.request_id=$2 AND e.source_event_key='manager-approval'`,
        [manager, key.data, payload],
      )).rows[0];
      if (!prior?.matches) throw new ApiError(409, "CONFLICT", "This key already identifies another transfer request");
      return prior.result;
    }
    const id = Number(created.rows[0].transfer_id);
    const approvedItems = [];
    for (const item of items) {
      const eligible = await client.query(
        `SELECT lot_id FROM lots WHERE lot_id=$1 AND status='active'
           AND (expires_on IS NULL OR expires_on >= CURRENT_DATE) FOR SHARE`, [item.lot_id],
      );
      if (!eligible.rowCount) throw new ApiError(409, "CONFLICT", "Lot is unavailable for transfer");
      const reserved = await client.query(
        `UPDATE inventory_balances SET reserved=reserved+$3, updated_at=now()
          WHERE warehouse_id=$1 AND lot_id=$2 AND available >= $3`, [source, item.lot_id, item.quantity],
      );
      if (!reserved.rowCount) throw new ApiError(409, "CONFLICT", "Insufficient available stock for this transfer");
      const line = await client.query(
        `INSERT INTO transfer_items(transfer_id,source_warehouse_id,destination_warehouse_id,lot_id,quantity)
         VALUES ($1,$2,$3,$4,$5) RETURNING transfer_item_id`, [id, source, destination, item.lot_id, item.quantity],
      );
      approvedItems.push({ ...item, transfer_item_id: Number(line.rows[0].transfer_item_id) });
      await client.query(
        `INSERT INTO stock_movements(lot_id,warehouse_id,reserved_delta,event_type,reference_type,reference_id,actor_user_id,idempotency_key)
         VALUES ($1,$2,$3,'transfer_reserved','transfer',$4,$5,$6)`,
        [item.lot_id, source, item.quantity, id, manager, JSON.stringify(["approval", id, item.lot_id])],
      );
    }
    const data = { operation_id: id, status: "approved", items: approvedItems };
    await client.query(
      `INSERT INTO transfer_events(transfer_id,event_type,actor_user_id,source_event_key,details)
       VALUES ($1,'approved',$2,'manager-approval',$3)`, [id, manager, JSON.stringify({ request: parsed.data, result: data })],
    );
    return data;
  });
  res.json({ data: result, request_id: req.requestId });
});
