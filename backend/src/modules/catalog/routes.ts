import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { ApiError } from "../../shared/errors.js";
import { parse, positiveId } from "../orders/validation.js";
export const catalogRouter = Router();
const querySchema = z
  .object({
    q: z.string().trim().max(120).default(""),
    category: z.string().trim().max(80).default(""),
    sort: z.enum(["featured", "price_asc", "price_desc"]).default("featured"),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    cursor: z.string().max(1000).optional(),
  })
  .strict();
const cursorSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  price: z.string().regex(/^\d{1,10}\.\d{2}$/),
  sort: z.enum(["featured", "price_asc", "price_desc"]),
});
const availabilitySql = `COALESCE((SELECT sum(b.available)::integer FROM inventory_balances b JOIN lots l ON l.lot_id=b.lot_id JOIN warehouses w ON w.warehouse_id=b.warehouse_id WHERE l.product_id=p.product_id AND l.status='active' AND (l.expires_on IS NULL OR l.expires_on>=CURRENT_DATE) AND w.is_active),0)`;
catalogRouter.get("/", async (request, response, next) => {
  try {
    const q = parse(querySchema, request.query);
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (q.cursor) {
      try {
        cursor = parse(
          cursorSchema,
          JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid catalog cursor");
      }
      if (cursor.sort !== q.sort)
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "Cursor sort does not match request",
        );
    }
    const price = q.sort !== "featured";
    const direction = q.sort === "price_desc" ? "DESC" : "ASC";
    const comparison = q.sort === "price_desc" ? "<" : ">";
    const result = await pool.query(
      `SELECT p.product_id::float8 AS product_id,p.sku,p.name,p.category,p.list_price::text,${availabilitySql} AS available_quantity
      FROM products p WHERE p.is_active AND ($1='' OR p.name ILIKE '%'||$1||'%' OR p.sku ILIKE '%'||$1||'%') AND ($2='' OR p.category=$2)
      AND ($3::bigint IS NULL OR ${price ? `(p.list_price,p.product_id) ${comparison} ($4::numeric,$3::bigint)` : `(p.product_id>$3::bigint AND $4::numeric>=0)`})
      ORDER BY ${price ? `p.list_price ${direction},` : ""}p.product_id ${direction} LIMIT $5`,
      [q.q, q.category, cursor?.id ?? null, cursor?.price ?? null, q.limit + 1],
    );
    const data = result.rows.slice(0, q.limit);
    const last = data.at(-1);
    response.json({
      data,
      page: {
        limit: q.limit,
        next_cursor:
          result.rows.length > q.limit && last
            ? Buffer.from(
                JSON.stringify({
                  id: last.product_id,
                  price: last.list_price,
                  sort: q.sort,
                }),
              ).toString("base64url")
            : null,
      },
    });
  } catch (error) {
    next(error);
  }
});
catalogRouter.get("/:productId", async (request, response, next) => {
  try {
    const id = positiveId(request.params.productId);
    const result = await pool.query(
      `SELECT p.product_id::float8 AS product_id,p.sku,p.name,p.category,p.list_price::text,${availabilitySql} AS available_quantity FROM products p WHERE p.product_id=$1 AND p.is_active`,
      [id],
    );
    if (!result.rows[0])
      throw new ApiError(404, "NOT_FOUND", "Product not found");
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});
catalogRouter.get(
  "/:productId/availability",
  async (request, response, next) => {
    try {
      const id = positiveId(request.params.productId);
      const result = await pool.query(
        `SELECT p.product_id::float8 AS product_id,now() AS as_of,
      COALESCE((SELECT jsonb_agg(stock ORDER BY warehouse_id) FROM (
        SELECT w.warehouse_id::float8 AS warehouse_id,w.name,w.region,COALESCE(sum(b.available) FILTER(WHERE l.status='active' AND (l.expires_on IS NULL OR l.expires_on>=CURRENT_DATE)),0)::integer AS available_quantity
        FROM warehouses w LEFT JOIN inventory_balances b ON b.warehouse_id=w.warehouse_id LEFT JOIN lots l ON l.lot_id=b.lot_id AND l.product_id=p.product_id
        WHERE w.is_active GROUP BY w.warehouse_id
      )stock),'[]'::jsonb) AS warehouses
      FROM products p WHERE p.product_id=$1 AND p.is_active`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new ApiError(404, "NOT_FOUND", "Product not found");
      response.json({
        ...row,
        available_quantity: row.warehouses.reduce(
          (n: number, w: { available_quantity: number }) =>
            n + w.available_quantity,
          0,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
