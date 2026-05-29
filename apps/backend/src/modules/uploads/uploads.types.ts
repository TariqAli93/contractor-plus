// Wire-level shape returned by upload + GET endpoints. Mirrors the bits the
// frontend actually needs to render and persist — never the raw filesystem
// path beyond the relative key.

export type CompanyAssetKind = 'logo' | 'stamp';

export interface UploadedAssetResponse {
  kind: CompanyAssetKind;
  /** Public URL the frontend can src= directly (read-only static serving). */
  url: string;
  /** Stored mime type — already validated against the bucket's allowlist. */
  mimeType: string;
  /** Size in bytes (informational). */
  size: number;
  /** Last update timestamp on the owning row. */
  updatedAt: string;
}

export interface CompanyAssetState {
  logo: { url: string; mimeType: string } | null;
  stamp: { url: string; mimeType: string } | null;
}
