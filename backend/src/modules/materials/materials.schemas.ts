import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common.schemas.js';

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

const nullablePrice = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'defaultPrice must be a number' });
      return z.NEVER;
    }
    if (n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'defaultPrice must be >= 0' });
      return z.NEVER;
    }
    return n;
  });

export const createMaterialSchema = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(50),
  defaultPrice: nullablePrice,
  notes: nullableString(2000),
  isActive: z.boolean().default(true),
});

export const updateMaterialSchema = createMaterialSchema.partial();

const stringBool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

export const listMaterialsQuerySchema = paginationQuerySchema.extend({
  // Materials feed pickers (template/contract item editors) that need the full
  // active list in one request, so allow a larger page than the shared default.
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
  search: z.string().trim().min(1).optional(),
  isActive: stringBool.optional(),
  sortBy: z.enum(['name', 'createdAt', 'defaultPrice']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
export type ListMaterialsQuery = z.infer<typeof listMaterialsQuerySchema>;
