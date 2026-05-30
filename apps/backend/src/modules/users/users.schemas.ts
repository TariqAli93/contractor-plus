import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/validation/common.schemas.js';
import { usernameSchema } from '../auth/auth.schemas.js';

// A user may be assigned any existing role (system or custom). Existence +
// OWNER-protection are enforced in the service.
const roleNameSchema = z.string().trim().min(2).max(50);

// Reject weak passwords. Kept deliberately simple (length only) — the spec
// asks to reject weak passwords without prescribing a complexity engine.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

const nullableEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .nullish()
  .transform((v) => (v === '' ? null : v ?? null));

const nullablePhone = z
  .string()
  .trim()
  .max(50)
  .nullish()
  .transform((v) => (v === '' ? null : v ?? null));

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(200),
  email: nullableEmail,
  phone: nullablePhone,
  roleName: roleNameSchema,
  isActive: z.boolean().default(true),
});

// Username and password are NOT editable here (use reset-password / never).
export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  email: nullableEmail,
  phone: nullablePhone,
  roleName: roleNameSchema.optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

const stringBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  isActive: stringBool.optional(),
  sortBy: z.enum(['username', 'fullName', 'createdAt', 'lastLoginAt']).default('createdAt'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
