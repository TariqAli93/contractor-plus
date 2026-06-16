import type { DocumentCategory } from '@prisma/client';

// Wire-level shapes. Mirrors the Prisma row but strips the raw file path
// (callers should never need it; downloads go through the dedicated route).
export interface DocumentTemplateView {
  id: string;
  name: string;
  slug: string;
  category: DocumentCategory;
  description: string | null;
  mimeType: string;
  isActive: boolean;
  isDefault: boolean;
  placeholders: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedDocumentView {
  id: string;
  templateId: string;
  templateName: string;
  contractId: string | null;
  projectId: string | null;
  customerId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  generatedBy: string | null;
  createdAt: string;
  downloadUrl: string;
}
