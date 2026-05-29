import { z } from 'zod';
import { AuditAction } from '@prisma/client';
import { paginationQuerySchema, uuidSchema } from '../../shared/validation/common.schemas.js';

// Audit logs are only ever sorted by createdAt — exposing other sort columns
// would imply field-level indexes we don't carry. Lock sortBy to the one value
// allowed by the schema and let users flip direction only.
const sortLocked = z.literal('createdAt').default('createdAt');

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  entity: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  action: z.nativeEnum(AuditAction).optional(),
  userId: uuidSchema.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: sortLocked,
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const entityHistoryQuerySchema = paginationQuerySchema.extend({
  sortBy: sortLocked,
  sortDir: z.enum(['asc', 'desc']).default('asc'), // chronological
});

export const userHistoryQuerySchema = paginationQuerySchema.extend({
  entity: z.string().trim().min(1).max(100).optional(),
  action: z.nativeEnum(AuditAction).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: sortLocked,
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const auditLogIdParamSchema = z.object({ id: uuidSchema });

export const entityHistoryParamSchema = z.object({
  entity: z.string().trim().min(1).max(100),
  entityId: z.string().trim().min(1).max(100),
});

export const userHistoryParamSchema = z.object({
  userId: uuidSchema,
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
export type EntityHistoryQuery = z.infer<typeof entityHistoryQuerySchema>;
export type UserHistoryQuery = z.infer<typeof userHistoryQuerySchema>;
