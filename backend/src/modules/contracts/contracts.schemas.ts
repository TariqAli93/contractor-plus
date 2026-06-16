import { z } from 'zod';
import { ContractStatus } from '@prisma/client';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

const strictlyPositive = (label: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be greater than 0`,
      });
      return z.NEVER;
    }
    return n;
  });

const nonNegative = (label: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be >= 0` });
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
        message: 'expectedProfitMargin must be between 0 and 100',
      });
      return z.NEVER;
    }
    return n;
  });

// ----- Create / Update -----

export const createContractSchema = z.object({
  contractNumber: z.string().trim().min(1).max(50),
  customerId: uuidSchema,
  templateId: uuidSchema.nullish().transform((v) => v ?? null),
  buildingArea: strictlyPositive('buildingArea'),
  floors: z.coerce.number().int().min(1, 'floors must be >= 1'),
  meterPrice: nonNegative('meterPrice'),
  expectedProfitMargin: nullablePercentage,
  notes: nullableString(2000),
});

// PATCH is for regular field updates only. Status transitions happen via
// dedicated action endpoints (/approve, /cancel) — never here.
export const updateContractSchema = z.object({
  contractNumber: z.string().trim().min(1).max(50).optional(),
  customerId: uuidSchema.optional(),
  templateId: uuidSchema.nullable().optional(),
  buildingArea: strictlyPositive('buildingArea').optional(),
  floors: z.coerce.number().int().min(1, 'floors must be >= 1').optional(),
  meterPrice: nonNegative('meterPrice').optional(),
  expectedProfitMargin: nullablePercentage.optional(),
  notes: nullableString(2000).optional(),
});

// ----- List query -----

const stringBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listContractsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  status: z.nativeEnum(ContractStatus).optional(),
  customerId: uuidSchema.optional(),
  sortBy: z.enum(['createdAt', 'contractNumber', 'totalPrice']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: stringBool.optional(),
});

// ----- Action bodies -----

export const approveContractBodySchema = z.object({
  signedAt: z.coerce.date().optional(),
});

export const cancelContractBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const createProjectFromContractBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  startDate: z.coerce.date().optional(),
  deliveryDate: z.coerce.date().optional(),
  notes: nullableString(2000),
});

// Reserved for future overrides (custom scale factor, etc.) — empty for MVP.
export const generateEstimateBodySchema = z.object({}).optional();

// ----- Params -----

export const contractIdParamSchema = z.object({ id: uuidSchema });

// ----- Types -----

export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
export type ListContractsQuery = z.infer<typeof listContractsQuerySchema>;
export type ApproveContractBody = z.infer<typeof approveContractBodySchema>;
export type CancelContractBody = z.infer<typeof cancelContractBodySchema>;
export type CreateProjectFromContractBody = z.infer<typeof createProjectFromContractBodySchema>;
