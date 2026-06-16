import { z } from 'zod';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
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

// ----- Create -----

export const createPaymentSchema = z.object({
  projectId: uuidSchema,
  amount: nonNegative('amount'),
  dueDate: z.coerce.date(),
  method: z.nativeEnum(PaymentMethod).nullish().transform((v) => v ?? null),
  reference: nullableString(200),
  notes: nullableString(2000),
});

// ----- Update -----
//
// PATCH never touches `status` or `paymentDate`. Those move only through
// /mark-paid and /cancel. Editing a payment in PAID or CANCELLED status is
// rejected outright — refunds/corrections live in a future module.
export const updatePaymentSchema = z.object({
  amount: nonNegative('amount').optional(),
  dueDate: z.coerce.date().optional(),
  method: z.nativeEnum(PaymentMethod).nullable().optional(),
  reference: nullableString(200).optional(),
  notes: nullableString(2000).optional(),
});

// ----- List query -----

const stringBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  projectId: uuidSchema.optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  late: stringBool.optional(),
  dueDateFrom: z.coerce.date().optional(),
  dueDateTo: z.coerce.date().optional(),
  sortBy: z.enum(['dueDate', 'amount', 'createdAt', 'paymentDate']).default('dueDate'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

// ----- Action bodies -----

export const markPaidBodySchema = z.object({
  paymentDate: z.coerce.date(),
  method: z.nativeEnum(PaymentMethod).optional(),
  reference: z.string().trim().max(200).optional(),
});

export const cancelPaymentBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// ----- Params -----

export const paymentIdParamSchema = z.object({ id: uuidSchema });
export const projectIdParamSchema = z.object({ id: uuidSchema });

// ----- Types -----

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
export type MarkPaidBody = z.infer<typeof markPaidBodySchema>;
export type CancelPaymentBody = z.infer<typeof cancelPaymentBodySchema>;
