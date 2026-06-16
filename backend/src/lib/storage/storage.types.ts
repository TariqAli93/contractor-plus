// Storage layer types — kept narrow so swapping the LocalStorageService for
// an S3/MinIO implementation later only requires re-implementing this surface.
//
// Phase 2.5 introduces a public/private split:
//   - PublicStorageBucket  → mounted at /uploads/, world-readable.
//   - PrivateStorageBucket → never mounted; only the upload service can
//     read/write these and the resulting URLs are not addressable from
//     outside the API. (Signed download URLs land in Phase 3.)
//
// Both bucket names embed their visibility class as the first segment so a
// human glancing at a path always knows whether it's public.

export type PublicStorageBucket = 'public/company/logos' | 'public/company/stamps';

export type PrivateStorageBucket =
  | 'private/contracts'
  | 'private/templates'
  | 'private/temp';

export type StorageBucket = PublicStorageBucket | PrivateStorageBucket;

export interface StoredFile {
  /** Bucket the file lives in. */
  bucket: StorageBucket;
  /** Server-generated UUID-based filename, e.g. "a1b2-...ext". */
  filename: string;
  /** Relative path under the storage root: "<bucket>/<filename>". */
  relativePath: string;
  /**
   * Public URL the frontend uses to fetch the file. `null` for private
   * buckets — those require a signed/authorized download endpoint that
   * doesn't exist yet.
   */
  publicUrl: string | null;
  /** Stored size in bytes. */
  size: number;
  /** Mime type validated against the bucket's allowlist. */
  mimeType: string;
}

export interface SaveOptions {
  bucket: StorageBucket;
  /** Buffered file contents. */
  contents: Buffer;
  /** Pre-validated mime type (validation lives in the upload service). */
  mimeType: string;
  /** Extension to preserve, *without* the leading dot. Lowercased. */
  extension: string;
}

export interface StorageHealth {
  ok: boolean;
  root: string;
  publicRoot: string;
  privateRoot: string;
  /** Populated when ok=false to explain what failed. */
  error?: string;
}

export interface StorageService {
  save(opts: SaveOptions): Promise<StoredFile>;
  /** Remove a file by its relative path. Idempotent — missing is a no-op. */
  remove(relativePath: string): Promise<void>;
  /** Resolve a relative path to an absolute filesystem path (for serving). */
  resolveAbsolutePath(relativePath: string): string;
  /** Storage root used for static serving of public assets. */
  getPublicRoot(): string;
  /** Filesystem root for private assets (never statically served). */
  getPrivateRoot(): string;
  /** Top-level filesystem root containing both public/ and private/. */
  getRoot(): string;
  /** URL prefix the frontend uses to fetch public assets. */
  getPublicPrefix(): string;
  /** Health check — confirms the roots exist and are writable. */
  checkHealth(): Promise<StorageHealth>;
}
