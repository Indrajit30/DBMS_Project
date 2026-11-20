import { z } from "zod";
import { ApiError } from "../../shared/errors.js";
export const idSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const quantity = z.number().int().positive().max(1_000_000);
export const addressSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    line1: z.string().trim().min(1).max(200),
    line2: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((v) => v || null),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().min(1).max(100),
    postal_code: z.string().trim().min(1).max(20),
    country_code: z.literal("US"),
  })
  .strict();
export const createOrderSchema = z
  .object({
    service_level: z.enum(["standard", "expedited"]).default("standard"),
    destination: addressSchema,
    items: z
      .array(z.object({ product_id: idSchema, quantity }).strict())
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.product_id)).size !== v.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate product lines are not allowed",
      });
  });
export const cancellationSchema = z
  .object({
    items: z
      .array(z.object({ order_item_id: idSchema, quantity }).strict())
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.items.map((i) => i.order_item_id)).size !== v.items.length)
      c.addIssue({
        code: "custom",
        message: "Duplicate order items are not allowed",
      });
  });
export const returnSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            shipment_item_id: idSchema,
            quantity,
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.items.map((i) => i.shipment_item_id)).size !== v.items.length)
      c.addIssue({
        code: "custom",
        message: "Duplicate shipment items are not allowed",
      });
  });
export function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Invalid request",
      result.error.flatten(),
    );
  return result.data;
}
export function key(value: string | undefined): string {
  return parse(
    z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    value,
  );
}
export function positiveId(value: unknown): number {
  return parse(
    z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(idSchema),
    value,
  );
}
export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(1000).optional(),
});
