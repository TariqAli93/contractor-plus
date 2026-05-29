// Mirrors backend DocumentTemplate + GeneratedDocument views. Kept here so
// frontend builds never need the backend's Prisma client types.

export type DocumentCategory = 'CONTRACT' | 'QUOTATION' | 'INVOICE' | 'REPORT';

export interface DocumentTemplate {
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

export interface GeneratedDocument {
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

export interface CreateDocumentTemplateBody {
  name: string;
  slug: string;
  category: DocumentCategory;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateDocumentTemplateBody {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}
