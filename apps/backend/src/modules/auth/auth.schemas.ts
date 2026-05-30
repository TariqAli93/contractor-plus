import { z } from 'zod';
import { RoleName } from '@prisma/client';

// Login identifier: trimmed + lowercased, 3–50 chars, letters/numbers/._-.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username must be at most 50 characters')
  .regex(/^[a-z0-9._-]+$/, 'Username may contain only letters, numbers, dot, underscore, and dash');

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  phone: z.string().nullable(),
  role: z.nativeEnum(RoleName),
  lastLoginAt: z.date().nullable(),
});

export const loginResponseSchema = z.object({
  user: userProfileSchema,
  tokens: tokenPairSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
