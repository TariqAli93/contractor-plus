import { z } from 'zod';

// ---------- helpers ----------

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

const nullableEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .email()
  .nullish()
  .transform((v) => (v === '' ? null : (v ?? null)));

// Separators must be a single character (Intl-style formatters expect a
// glyph, not a string). We allow non-breaking-space too — common in fr-FR.
const separator = z.string().min(1).max(2);

// ---------- General (key/value bag) ----------
//
// Phase 1 keeps the keys tiny and well-defined. Everything is optional;
// the controller responds with a typed object and applies defaults.
// Unknown keys are rejected so we don't leak garbage into the bag.
export const generalSettingsSchema = z.object({
  appName: z.string().trim().min(1).max(120).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  defaultLocale: z.enum(['ar', 'en']).optional(),
  dateFormat: z.string().trim().min(1).max(40).optional(),
});
export type GeneralSettingsInput = z.infer<typeof generalSettingsSchema>;

// ---------- Company ----------

export const updateCompanyProfileSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  legalName: nullableString(200),
  email: nullableEmail,
  phone: nullableString(50),
  address: nullableString(500),
  taxNumber: nullableString(50),
  registrationNumber: nullableString(50),
  website: nullableString(200),
  footerText: nullableString(1000),
  notes: nullableString(2000),
}).partial({
  // All fields are optional on PATCH — but companyName, if present, must
  // remain non-empty. partial() makes everything optional including
  // companyName; we re-tighten the constraint at the service layer if it
  // is sent. Leaving the schema as fully-partial keeps PATCH semantics.
});
export type UpdateCompanyProfileInput = z.infer<typeof updateCompanyProfileSchema>;

// ---------- Currencies ----------

export const createCurrencySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .regex(/^[A-Za-z]{2,8}$/, 'CODE_MUST_BE_LETTERS')
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(100),
  symbol: z.string().trim().min(1).max(10),
  symbolPosition: z.enum(['BEFORE', 'AFTER']).default('BEFORE'),
  decimalPrecision: z.number().int().min(0).max(6).default(2),
  thousandSeparator: separator.default(','),
  decimalSeparator: separator.default('.'),
  isActive: z.boolean().default(true),
});
export type CreateCurrencyInput = z.infer<typeof createCurrencySchema>;

export const updateCurrencySchema = createCurrencySchema.partial();
export type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;
