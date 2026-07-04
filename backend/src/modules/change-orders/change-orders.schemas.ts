import { z } from 'zod';
import { ChangeOrderStatus } from '@prisma/client';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';

// A change-order amount is a SIGNED delta: positive adds to the contract value,
// negative deducts. Zero is meaningless, so it's rejected.
const signedAmount = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n) || n === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount must be a non-zero number' });
    return z.NEVER;
  }
  return n;
});

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

export const createChangeOrderSchema = z.object({
  contractId: uuidSchema,
  title: z.string().trim().min(1).max(200),
  description: nullableString(2000),
  amount: signedAmount,
});

export const updateChangeOrderSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: nullableString(2000).optional(),
  amount: signedAmount.optional(),
});

export const listChangeOrdersQuerySchema = paginationQuerySchema.extend({
  contractId: uuidSchema.optional(),
  status: z.nativeEnum(ChangeOrderStatus).optional(),
  sortBy: z.enum(['number', 'createdAt', 'amount']).default('number'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export const changeOrderIdParamSchema = z.object({ id: uuidSchema });
export const contractIdParamSchema = z.object({ id: uuidSchema });

export type CreateChangeOrderInput = z.infer<typeof createChangeOrderSchema>;
export type UpdateChangeOrderInput = z.infer<typeof updateChangeOrderSchema>;
export type ListChangeOrdersQuery = z.infer<typeof listChangeOrdersQuerySchema>;
