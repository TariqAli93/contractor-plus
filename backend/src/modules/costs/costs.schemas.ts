import { z } from 'zod';
import { CostCategory } from '@prisma/client';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

const nonNegative = (label: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be >= 0` });
      return z.NEVER;
    }
    return n;
  });

const nullableNonNegative = (label: string) =>
  z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'string' ? Number(v) : v;
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be >= 0` });
        return z.NEVER;
      }
      return n;
    });

// ----- Create -----

export const createCostSchema = z.object({
  projectId: uuidSchema,
  category: z.nativeEnum(CostCategory),
  materialId: uuidSchema.nullish().transform((v) => v ?? null),
  description: z.string().trim().min(1).max(500),
  quantity: nullableNonNegative('quantity'),
  unit: nullableString(50),
  unitPrice: nullableNonNegative('unitPrice'),
  totalAmount: nonNegative('totalAmount').optional(),
  date: z.coerce.date(),
  notes: nullableString(2000),
});

// ----- Update -----
//
// PATCH allows any subset of fields. Cross-field invariants
// (category vs materialId, totalAmount vs quantity*unitPrice) are
// re-evaluated against the merged state in the service.
export const updateCostSchema = z.object({
  category: z.nativeEnum(CostCategory).optional(),
  materialId: uuidSchema.nullable().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  quantity: nullableNonNegative('quantity').optional(),
  unit: nullableString(50).optional(),
  unitPrice: nullableNonNegative('unitPrice').optional(),
  totalAmount: nonNegative('totalAmount').optional(),
  date: z.coerce.date().optional(),
  notes: nullableString(2000).optional(),
});

// ----- List query -----

export const listCostsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  projectId: uuidSchema.optional(),
  category: z.nativeEnum(CostCategory).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z.enum(['date', 'totalAmount', 'createdAt']).default('date'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

// ----- Params -----

export const costIdParamSchema = z.object({ id: uuidSchema });
export const projectIdParamSchema = z.object({ id: uuidSchema });

// ----- Types -----

export type CreateCostInput = z.infer<typeof createCostSchema>;
export type UpdateCostInput = z.infer<typeof updateCostSchema>;
export type ListCostsQuery = z.infer<typeof listCostsQuerySchema>;
