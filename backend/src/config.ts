import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32).optional(),
  DB_SSL: z.enum(["true", "false"]).default("false"),
  DB_SSL_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).default("true"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = {
  ...parsed.data,
  databaseSsl:
    parsed.data.DB_SSL === "true"
      ? { rejectUnauthorized: parsed.data.DB_SSL_REJECT_UNAUTHORIZED === "true" }
      : undefined,
};

export function getJwtSecret(): string {
  if (!config.JWT_SECRET) {
    throw new Error("JWT_SECRET must be set to at least 32 characters to use authentication");
  }
  return config.JWT_SECRET;
}
