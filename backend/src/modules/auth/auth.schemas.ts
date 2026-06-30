import { z } from 'zod';

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

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().email().nullable(),
  fullName: z.string(),
  phone: z.string().nullable(),
  // Role name (system or custom) + its display label + effective permissions.
  role: z.string(),
  roleDisplayName: z.string().nullable(),
  permissions: z.array(z.string()),
  lastLoginAt: z.date().nullable(),
});

export const loginResponseSchema = z.object({
  user: userProfileSchema,
  tokens: tokenPairSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
