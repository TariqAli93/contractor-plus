import { apiClient, apiDelete, apiGet } from './client';

// Wire shape returned by POST /uploads/company/:kind
export interface UploadedAssetResponse {
  kind: 'logo' | 'stamp';
  url: string;
  mimeType: string;
  size: number;
  updatedAt: string;
}

export interface CompanyAssetState {
  logo: { url: string; mimeType: string } | null;
  stamp: { url: string; mimeType: string } | null;
}

export const uploadsApi = {
  getCompanyAssets: (): Promise<CompanyAssetState> => apiGet('/uploads/company'),

  // We use the raw axios client for multipart so we can set the right
  // Content-Type and (later) attach progress callbacks if needed.
  uploadCompanyAsset: async (
    kind: 'logo' | 'stamp',
    file: File,
    opts: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
  ): Promise<UploadedAssetResponse> => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const res = await apiClient.post<UploadedAssetResponse>(
      `/uploads/company/${kind}`,
      fd,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: opts.signal,
        onUploadProgress: (e) => {
          if (!opts.onProgress || !e.total) return;
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
    return res.data;
  },

  deleteCompanyAsset: (kind: 'logo' | 'stamp'): Promise<void> =>
    apiDelete(`/uploads/company/${kind}`),
};
