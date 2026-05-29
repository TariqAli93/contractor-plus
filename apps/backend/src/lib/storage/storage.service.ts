// Re-export the public storage surface. Callers should only depend on
// `StorageService` and `getStorage()` so the underlying implementation can
// be swapped (e.g. to S3) without touching feature code.
export { getStorage, LocalStorageService } from './local-storage.service.js';
export { buildPublicUrl, buildPublicUrlFromBucket } from './url-builder.js';
export type {
  PrivateStorageBucket,
  PublicStorageBucket,
  StorageBucket,
  StorageHealth,
  StorageService,
  StoredFile,
  SaveOptions,
} from './storage.types.js';
