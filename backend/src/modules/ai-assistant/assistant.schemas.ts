import { z } from 'zod';

/** Query params for GET /ai/audit — strings from the querystring are coerced. */
export const auditQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  toolName: z.string().trim().max(50).optional(),
  transactionResult: z.enum(['executed', 'failed', 'cancelled', 'not_required']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
