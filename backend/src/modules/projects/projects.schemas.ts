import { z } from 'zod';
import { ProjectStatus } from '@prisma/client';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

const percentage = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'progressPercentage must be between 0 and 100',
    });
    return z.NEVER;
  }
  return n;
});

// ----- Create -----

export const createProjectSchema = z.object({
  contractId: uuidSchema.nullish().transform((v) => v ?? null),
  name: z.string().trim().min(1).max(200),
  startDate: z.coerce.date().nullish().transform((v) => v ?? null),
  deliveryDate: z.coerce.date().nullish().transform((v) => v ?? null),
  notes: nullableString(2000),
});

// ----- Update -----
//
// PATCH is for regular field updates only. Status transitions happen via
// dedicated action endpoints (/start, /pause, /resume, /complete, /cancel).
// `contractId` is immutable post-creation — once set, it cannot be moved.
export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  startDate: z.coerce.date().nullable().optional(),
  deliveryDate: z.coerce.date().nullable().optional(),
  progressPercentage: percentage.optional(),
  notes: nullableString(2000).optional(),
});

// ----- List query -----

const stringBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  delayed: stringBool.optional(),
  contractId: uuidSchema.optional(),
  sortBy: z.enum(['createdAt', 'name', 'deliveryDate', 'startDate']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: stringBool.optional(),
});

// ----- Action bodies -----

// Only /cancel takes a body — the rest are bodyless POSTs.
export const cancelProjectBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// /unlink-contract requires an explicit reason — it is recorded in the audit
// log (audit prompt 10: safe unlink asks for and logs the reason).
export const unlinkContractBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

// ----- Params -----

export const projectIdParamSchema = z.object({ id: uuidSchema });

// ----- Types -----

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type CancelProjectBody = z.infer<typeof cancelProjectBodySchema>;
export type UnlinkContractBody = z.infer<typeof unlinkContractBodySchema>;
