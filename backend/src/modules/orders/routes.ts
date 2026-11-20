import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../auth/middleware.js";
import { pool } from "../../db/pool.js";
import { ApiError } from "../../shared/errors.js";
import { createOrder, cancelOrder, createReturn } from "./service.js";
import {
  createOrderSchema,
  cancellationSchema,
  returnSchema,
  parse,
  positiveId,
  key,
  pageSchema,
} from "./validation.js";
import { transaction } from "./transaction.js";
import { readOrder } from "./read.js";
export const ordersRouter = Router();
const auth = [requireAuth, requireRoles("customer")];
ordersRouter.post("/orders", ...auth, async (request, response, next) => {
  try {
    const result = await createOrder(
      request.auth!,
      parse(createOrderSchema, request.body),
      key(request.header("idempotency-key")),
    );
    response.status(result.replayed ? 200 : 201).json(result.order);
  } catch (error) {
    next(error);
  }
});
ordersRouter.get("/orders", ...auth, async (request, response, next) => {
  try {
    const q = parse(pageSchema.strict(), request.query);
    let cursor: { id: number; time: string } | null = null;
    if (q.cursor) {
      try {
        cursor = parse(
          z.object({
            id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            time: z.string().datetime({ offset: true }),
          }),
          JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "Invalid order-history cursor",
        );
      }
    }
    const rows = await pool.query(
      `SELECT o.order_id::float8 AS order_id,o.status,o.placed_at,to_char(o.placed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,(SELECT sum(i.quantity)::integer FROM order_items i WHERE i.order_id=o.order_id) AS quantity,(SELECT sum(i.quantity*i.unit_price)::text FROM order_items i WHERE i.order_id=o.order_id) AS total FROM orders o WHERE o.customer_id=$1 AND ($2::timestamptz IS NULL OR (o.placed_at,o.order_id)<($2::timestamptz,$3::bigint)) ORDER BY o.placed_at DESC,o.order_id DESC LIMIT $4`,
      [
        request.auth!.customerId,
        cursor?.time ?? null,
        cursor?.id ?? null,
        q.limit + 1,
      ],
    );
    const selected = rows.rows.slice(0, q.limit),
      last = selected.at(-1);
    response.json({
      data: selected.map(({ cursor_time, ...o }) => o),
      page: {
        limit: q.limit,
        next_cursor:
          rows.rows.length > q.limit && last
            ? Buffer.from(
                JSON.stringify({ id: last.order_id, time: last.cursor_time }),
              ).toString("base64url")
            : null,
      },
    });
  } catch (error) {
    next(error);
  }
});
ordersRouter.get(
  "/orders/:orderId",
  ...auth,
  async (request, response, next) => {
    try {
      const orderId = positiveId(request.params.orderId);
      const result = await transaction(async (client) => {
        await client.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        return readOrder(client, request.auth!.customerId!, orderId);
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  },
);
ordersRouter.post(
  "/orders/:orderId/cancellations",
  ...auth,
  async (request, response, next) => {
    try {
      const result = await cancelOrder(
        request.auth!,
        positiveId(request.params.orderId),
        parse(cancellationSchema, request.body),
        key(request.header("idempotency-key")),
      );
      response.json(result);
    } catch (error) {
      next(error);
    }
  },
);
ordersRouter.post("/returns", ...auth, async (request, response, next) => {
  try {
    const result = await createReturn(
      request.auth!,
      parse(returnSchema, request.body),
      key(request.header("idempotency-key")),
    );
    response.status(result.replayed ? 200 : 201).json(result.result);
  } catch (error) {
    next(error);
  }
});
