import { apiClient, apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CreateDocumentTemplateBody,
  DocumentCategory,
  DocumentTemplate,
  GeneratedDocument,
  UpdateDocumentTemplateBody,
} from '@/types/document-template';

// Lives at /api/v1/document-templates because /api/v1/templates is taken
// by the building-templates module. Routes are otherwise 1:1 with the
// Phase 3 spec.

export const documentTemplatesApi = {
  list: (params: { category?: DocumentCategory; includeInactive?: boolean } = {}): Promise<{
    items: DocumentTemplate[];
  }> => apiGet('/document-templates', { params }),

  create: async (
    body: CreateDocumentTemplateBody,
    file: File,
    opts: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
  ): Promise<DocumentTemplate> => {
    // IMPORTANT: text fields must precede the file in the multipart body.
    // @fastify/multipart exposes sibling text fields through `file.fields`,
    // but ONLY the parts that arrive in the stream BEFORE the file. If the
    // file is appended first the server-side zod parse fails with "required
    // field missing" while the file stream is still mid-transfer, and the
    // resulting unconsumed-stream + error-response combination triggers
    // ERR_CONNECTION_RESET on the client. Order matters here.
    const fd = new FormData();
    fd.append('name', body.name);
    fd.append('slug', body.slug);
    fd.append('category', body.category);
    if (body.description != null) fd.append('description', body.description);
    if (body.isActive != null) fd.append('isActive', String(body.isActive));
    fd.append('file', file, file.name);
    const res = await apiClient.post<DocumentTemplate>('/document-templates', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal: opts.signal,
      onUploadProgress: (e) => {
        if (!opts.onProgress || !e.total) return;
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return res.data;
  },

  update: (id: string, body: UpdateDocumentTemplateBody): Promise<DocumentTemplate> =>
    apiPatch(`/document-templates/${id}`, body),

  remove: (id: string): Promise<void> => apiDelete(`/document-templates/${id}`),

  setDefault: (id: string): Promise<DocumentTemplate> =>
    apiPost(`/document-templates/${id}/set-default`),

  // Downloads must carry the JWT - we fetch as a blob and trigger a
  // client-side download to keep the authorization header intact.
  downloadTemplate: async (id: string, filename: string): Promise<void> => {
    const res = await apiClient.get<Blob>(`/document-templates/${id}/download`, {
      responseType: 'blob',
    });
    triggerBlobDownload(res.data, filename);
  },
};

export const contractDocxApi = {
  generate: (contractId: string, templateId?: string): Promise<GeneratedDocument> =>
    apiPost(`/contracts/${contractId}/generate-docx`, templateId ? { templateId } : {}),

  listForContract: (contractId: string): Promise<{ items: GeneratedDocument[] }> =>
    apiGet(`/contracts/${contractId}/generated-documents`),
};

export const generatedDocumentsApi = {
  download: async (id: string, filename: string): Promise<void> => {
    const res = await apiClient.get<Blob>(`/generated-documents/${id}/download`, {
      responseType: 'blob',
    });
    triggerBlobDownload(res.data, filename);
  },
};

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click so older browsers don't drop the request.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
