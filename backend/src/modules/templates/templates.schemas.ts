import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

const nonNegativeNumber = (label: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v, ctx) => {
      if (v === '' || v === null || v === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is required` });
        return z.NEVER;
      }
      const n = typeof v === 'string' ? Number(v) : v;
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` });
        return z.NEVER;
      }
      if (n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be >= 0` });
        return z.NEVER;
      }
      return n;
    });

const percentageNumber = (label: string) =>
  z
    .union([z.number(), z.string()])
    .transform((v, ctx) => {
      const n = typeof v === 'string' ? Number(v) : v;
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be between 0 and 100`,
        });
        return z.NEVER;
      }
      return n;
    });

const nullablePercentage = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'suggestedProfitMargin must be between 0 and 100',
      });
      return z.NEVER;
    }
    return n;
  });

const nullablePositiveInt = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a positive integer' });
      return z.NEVER;
    }
    return n;
  });

// ---------- Template ----------

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: nullableString(2000),
  estimatedDurationDays: nullablePositiveInt,
  suggestedProfitMargin: nullablePercentage,
  isActive: z.boolean().default(true),
});

export const updateTemplateSchema = createTemplateSchema.partial();

const stringBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listTemplatesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  isActive: stringBool.optional(),
  sortBy: z.enum(['name', 'createdAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

// ---------- Template item ----------

export const createTemplateItemSchema = z.object({
  materialId: uuidSchema,
  // Legacy/internal field. The UI no longer collects it; the service
  // auto-generates a value from estimatedQuantity when omitted so the
  // NOT-NULL DB column stays populated. Kept optional for back-compat with
  // any caller that still sends a formula.
  quantityFormula: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
  estimatedQuantity: nonNegativeNumber('estimatedQuantity'),
  estimatedPrice: nonNegativeNumber('estimatedPrice'),
  notes: nullableString(2000),
});

export const updateTemplateItemSchema = createTemplateItemSchema.partial();

// ---------- Template step ----------

export const createTemplateStepSchema = z.object({
  name: z.string().trim().min(1).max(200),
  percentage: percentageNumber('percentage'),
  sortOrder: z.coerce.number().int().nonnegative(),
  estimatedDays: nullablePositiveInt,
});

export const updateTemplateStepSchema = createTemplateStepSchema.partial();

// ---------- Params ----------

export const templateIdParamSchema = z.object({ id: uuidSchema });
export const templateItemParamSchema = z.object({ id: uuidSchema, itemId: uuidSchema });
export const templateStepParamSchema = z.object({ id: uuidSchema, stepId: uuidSchema });

// ---------- Types ----------

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
export type CreateTemplateItemInput = z.infer<typeof createTemplateItemSchema>;
export type UpdateTemplateItemInput = z.infer<typeof updateTemplateItemSchema>;
export type CreateTemplateStepInput = z.infer<typeof createTemplateStepSchema>;
export type UpdateTemplateStepInput = z.infer<typeof updateTemplateStepSchema>;
