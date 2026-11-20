import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config.js";
import type { AuthenticatedUser, LoginResponse } from "../shared/types.js";

const TOKEN_TTL_SECONDS = 15 * 60;

export function issueAccessToken(userId: string, authVersion: number): string {
  return jwt.sign({ ver: authVersion }, getJwtSecret(), {
    algorithm: "HS256",
    subject: userId,
    expiresIn: TOKEN_TTL_SECONDS,
    issuer: "multiwarehouse-api",
    audience: "multiwarehouse-client",
  });
}

export function readAccessToken(token: string): { userId: string; authVersion: number } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
      issuer: "multiwarehouse-api",
      audience: "multiwarehouse-client",
    });
    if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.ver !== "number") {
      return null;
    }
    return { userId: payload.sub, authVersion: payload.ver };
  } catch {
    return null;
  }
}

export function authResponse(user: AuthenticatedUser, authVersion: number): LoginResponse {
  return {
    access_token: issueAccessToken(user.userId, authVersion),
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    user: {
      user_id: user.userId,
      role: user.role,
      customer_id: user.customerId,
      warehouse_ids: user.warehouseIds,
    },
  };
}
