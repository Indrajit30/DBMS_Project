import type { RequestHandler } from "express";
import { pool } from "../db/pool.js";
import { ApiError } from "../shared/errors.js";
import { USER_ROLES, type AuthenticatedUser, type UserRole } from "../shared/types.js";
import { readAccessToken } from "./token.js";

type AuthRow = {
  user_id: string;
  role: string;
  status: string;
  auth_version: number;
  customer_id: string | null;
  warehouse_ids: string[] | null;
};

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    const header = request.header("authorization");
    const match = header?.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1];
    const claims = token ? readAccessToken(token) : null;
    if (!claims) throw new ApiError(401, "UNAUTHENTICATED", "A valid bearer token is required");

    const result = await pool.query<AuthRow>(
      `SELECT u.user_id, u.role, u.status, u.auth_version, c.customer_id,
              array_agg(wm.warehouse_id) FILTER (WHERE wm.warehouse_id IS NOT NULL) AS warehouse_ids
         FROM users u
         LEFT JOIN customers c ON c.user_id = u.user_id
         LEFT JOIN warehouse_memberships wm ON wm.user_id = u.user_id
        WHERE u.user_id = $1
        GROUP BY u.user_id, u.role, u.status, u.auth_version, c.customer_id`,
      [claims.userId],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active" || row.auth_version !== claims.authVersion || !USER_ROLES.includes(row.role as UserRole)) {
      throw new ApiError(401, "UNAUTHENTICATED", "The account is unavailable or the token has expired");
    }

    const auth: AuthenticatedUser = {
      userId: row.user_id,
      role: row.role as UserRole,
      customerId: row.customer_id === null ? null : Number(row.customer_id),
      warehouseIds: (row.warehouse_ids ?? []).map(Number),
    };
    if (auth.role === "customer" && auth.customerId === null) {
      throw new ApiError(403, "FORBIDDEN", "Customer account is missing its customer profile");
    }
    request.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRoles(...allowed: UserRole[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth) return next(new ApiError(401, "UNAUTHENTICATED", "Authentication is required"));
    if (!allowed.includes(request.auth.role)) return next(new ApiError(403, "FORBIDDEN", "This role cannot access the resource"));
    next();
  };
}

export function requireWarehouseScope(parameter = "warehouseId"): RequestHandler {
  return (request, _response, next) => {
    const auth = request.auth;
    if (!auth) return next(new ApiError(401, "UNAUTHENTICATED", "Authentication is required"));
    const warehouseId = Number(request.params[parameter]);
    if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0) {
      return next(new ApiError(400, "VALIDATION_ERROR", "A valid warehouse ID is required"));
    }
    if (auth.role === "manager" || (auth.role === "warehouse_employee" && auth.warehouseIds.includes(warehouseId))) {
      return next();
    }
    next(new ApiError(403, "FORBIDDEN", "This account is not assigned to that warehouse"));
  };
}

export async function customerOwnsOrder(customerId: number, orderId: number): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM orders WHERE order_id = $1 AND customer_id = $2",
    [orderId, customerId],
  );
  return result.rowCount === 1;
}

export async function requireOrderOwnership(orderId: number, auth: AuthenticatedUser): Promise<void> {
  if (auth.role === "manager") return;
  if (auth.role !== "customer" || auth.customerId === null) {
    throw new ApiError(403, "FORBIDDEN", "This account cannot access customer orders");
  }
  if (!(await customerOwnsOrder(auth.customerId, orderId))) {
    // Deliberately avoid distinguishing a missing order from another customer's order.
    throw new ApiError(404, "NOT_FOUND", "Order not found");
  }
}
