import { z } from 'zod';
import { DocumentCategory } from '@prisma/client';

// DOCX-only. The spec is explicit: doc/pdf/zip/exe are rejected here even
// if some clients lie about the extension — the service performs the same
// check against the buffer's content type.
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCX_EXT = 'docx';

// Slug is lowercase kebab so it's safe to use in URLs / filenames if a
// future generator wants a stable handle.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const documentCategorySchema = z.nativeEnum(DocumentCategory);

export const createDocumentTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(SLUG_RE, 'SLUG_FORMAT_INVALID'),
  category: documentCategorySchema,
  description: z.string().trim().max(2000).optional().nullable(),
  isActive: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? true : v === true || v === 'true')),
});

export const updateDocumentTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const listDocumentTemplatesQuerySchema = z.object({
  category: documentCategorySchema.optional(),
  includeInactive: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export const documentTemplateIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const generatedDocumentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const generateContractDocxBodySchema = z.object({
  templateId: z.string().uuid().optional(),
});

export type CreateDocumentTemplateBody = z.infer<typeof createDocumentTemplateBodySchema>;
export type UpdateDocumentTemplateBody = z.infer<typeof updateDocumentTemplateBodySchema>;
export type ListDocumentTemplatesQuery = z.infer<typeof listDocumentTemplatesQuerySchema>;
export type GenerateContractDocxBody = z.infer<typeof generateContractDocxBodySchema>;
