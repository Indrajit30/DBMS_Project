import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { inTransaction } from "../db/transaction.js";
import { ApiError } from "../shared/errors.js";
import type { AuthenticatedUser } from "../shared/types.js";
import { requireAuth } from "./middleware.js";
import { hashPassword, verifyPassword } from "./password.js";
import { authResponse } from "./token.js";

const router = Router();
const DUMMY_PASSWORD_HASH = hashPassword("not-a-real-account-password");
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (request, response) => {
    response.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many authentication attempts; try again later",
        request_id: request.requestId ?? "unknown",
      },
    });
  },
});

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});

const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
});

const authSelect = `
  SELECT u.user_id, u.role, u.auth_version, c.customer_id,
         array_agg(wm.warehouse_id) FILTER (WHERE wm.warehouse_id IS NOT NULL) AS warehouse_ids
    FROM users u
    LEFT JOIN customers c ON c.user_id = u.user_id
    LEFT JOIN warehouse_memberships wm ON wm.user_id = u.user_id
   WHERE u.user_id = $1
   GROUP BY u.user_id, u.role, u.auth_version, c.customer_id
`;

type AuthRecord = {
  user_id: string;
  role: AuthenticatedUser["role"];
  auth_version: number;
  customer_id: string | null;
  warehouse_ids: string[] | null;
};

function mapUser(row: AuthRecord): AuthenticatedUser {
  return {
    userId: row.user_id,
    role: row.role,
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    warehouseIds: (row.warehouse_ids ?? []).map(Number),
  };
}

router.post("/register", authLimiter, async (request, response, next) => {
  try {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid customer registration", parsed.error.flatten());
    }
    const body = parsed.data;
    const passwordHash = await hashPassword(body.password);
    const created = await inTransaction(async (client) => {
      const inserted = await client.query<{ user_id: string; auth_version: number }>(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, 'customer')
         ON CONFLICT DO NOTHING
         RETURNING user_id, auth_version`,
        [body.email.toLowerCase(), passwordHash],
      );
      const user = inserted.rows[0];
      if (!user) throw new ApiError(409, "CONFLICT", "An account with that email already exists");
      const customer = await client.query<{ customer_id: string }>(
        `INSERT INTO customers (user_id, first_name, last_name, region)
         VALUES ($1, $2, $3, $4)
         RETURNING customer_id`,
        [user.user_id, body.first_name, body.last_name, body.region],
      );
      return { user, customerId: Number(customer.rows[0]!.customer_id) };
    });

    const auth: AuthenticatedUser = {
      userId: created.user.user_id,
      role: "customer",
      customerId: created.customerId,
      warehouseIds: [],
    };
    response.status(201).json(authResponse(auth, created.user.auth_version));
  } catch (error) {
    next(error);
  }
});

router.post("/login", authLimiter, async (request, response, next) => {
  try {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid login request", parsed.error.flatten());
    }
    const result = await pool.query<{
      user_id: string;
      password_hash: string;
      role: AuthenticatedUser["role"];
      auth_version: number;
      status: string;
    }>(
      `SELECT user_id, password_hash, role, auth_version, status
         FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [parsed.data.email],
    );
    const record = result.rows[0];
    const passwordMatches = record
      ? await verifyPassword(parsed.data.password, record.password_hash)
      : await verifyPassword(parsed.data.password, await DUMMY_PASSWORD_HASH);
    if (!record || record.status !== "active" || !passwordMatches) {
      throw new ApiError(401, "UNAUTHENTICATED", "Email or password is incorrect");
    }
    const full = await pool.query<AuthRecord>(authSelect, [record.user_id]);
    const user = full.rows[0];
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Email or password is incorrect");
    response.json(authResponse(mapUser(user), user.auth_version));
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (request, response, next) => {
  try {
    const auth = request.auth;
    if (!auth) throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required");
    response.json({
      user_id: auth.userId,
      role: auth.role,
      customer_id: auth.customerId,
      warehouse_ids: auth.warehouseIds,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", requireAuth, (_request, response) => {
  // Access tokens are short lived and stateless. The client should discard its bearer token.
  response.status(204).end();
});

export const authRouter = router;
