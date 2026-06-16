import { z } from 'zod';

const nullableString = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v === '' ? null : v ?? null));

// Custom role identifier — an ascii slug. The Arabic label goes in displayName.
const roleNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Role name must be at least 2 characters')
  .max(50)
  .regex(/^[a-z][a-z0-9_-]*$/, 'Role name may contain only letters, numbers, underscore, and dash');

export const createRoleSchema = z.object({
  name: roleNameSchema,
  displayName: z.string().trim().min(1).max(100),
  description: nullableString(500),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export const updateRoleSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  description: nullableString(500),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1)).max(500),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;
