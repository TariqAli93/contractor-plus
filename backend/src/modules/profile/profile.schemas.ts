import { z } from 'zod';
import { passwordSchema } from '../users/users.schemas.js';

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

// Self can edit only contact details — never role, isActive, or username.
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  email: nullableEmail,
  phone: nullablePhone,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
