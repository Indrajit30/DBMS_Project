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
