import { getStorage } from './storage.service.js';
import type { StorageBucket } from './storage.types.js';

// Single place that knows how to turn a stored relative path into a public
// URL. Services / serializers should call this instead of concatenating the
// prefix themselves — that way if we ever change the URL scheme (e.g. add a
// CDN prefix or move to signed URLs for public assets too) there's exactly
// one file to update.

/**
 * Build a public URL for an asset stored in a public bucket.
 *
 * @param relativePath  Path as persisted in the DB
 *                      (e.g. "public/company/logos/abc.png").
 * @returns The URL the frontend should `<img src=>`, or null if the path
 *          is empty or points outside the public tree.
 */
export function buildPublicUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned.startsWith('public/')) return null;
  return `${getStorage().getPublicPrefix()}/${cleaned}`;
}

/**
 * Resolve a bucket + filename pair to a public URL. Convenience wrapper for
 * call sites that already hold both pieces (e.g. right after `save()`).
 */
export function buildPublicUrlFromBucket(
  bucket: StorageBucket,
  filename: string,
): string | null {
  return buildPublicUrl(`${bucket}/${filename}`);
}
