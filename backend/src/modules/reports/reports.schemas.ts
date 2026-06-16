import { z } from 'zod';
import { ProjectStatus } from '@prisma/client';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';

export const listProjectProfitabilityQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(ProjectStatus).optional(),
  customerId: uuidSchema.optional(),
  sortBy: z.enum(['createdAt', 'name', 'deliveryDate', 'startDate']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const projectProfitabilityParamSchema = z.object({
  projectId: uuidSchema,
});

export const cashFlowQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export const overduePaymentsQuerySchema = z.object({
  customerId: uuidSchema.optional(),
});

export const delayedProjectsQuerySchema = z.object({
  customerId: uuidSchema.optional(),
});

export type ListProjectProfitabilityQuery = z.infer<typeof listProjectProfitabilityQuerySchema>;
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;
export type OverduePaymentsQuery = z.infer<typeof overduePaymentsQuerySchema>;
export type DelayedProjectsQuery = z.infer<typeof delayedProjectsQuerySchema>;
