import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common.schemas.js';

const nullableString = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v === '' ? null : v ?? null));

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: nullableString(50),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null)),
  address: nullableString(500),
  notes: nullableString(2000),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(['name', 'createdAt']).default('createdAt'),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
