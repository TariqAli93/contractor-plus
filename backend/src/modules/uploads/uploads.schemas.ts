import { z } from 'zod';

// Per-kind upload constraints. Logo + stamp both accept the same image set
// (PNG/JPEG/WebP). Stamps tolerate JPEG/WebP but PNG is "preferred" — the
// preference is surfaced to the user in the UI, not enforced here.

export const ALLOWED_IMAGE_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// Extension allowlist (lowercased). Used as the second line of defence:
// even if a client lies about mime type, the original filename's extension
// must also be on this list. We re-write the stored extension from mime →
// canonical (so "foo.JPEG" becomes ".jpg").
export const ALLOWED_IMAGE_EXTS = new Set<string>([
  'png',
  'jpg',
  'jpeg',
  'webp',
]);

export const companyAssetKindSchema = z.enum(['logo', 'stamp']);
export type CompanyAssetKind = z.infer<typeof companyAssetKindSchema>;
