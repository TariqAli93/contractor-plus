// Single place that decides how to resolve a server-side relative asset
// reference into a URL the browser can fetch.
//
// The backend returns ABSOLUTE-PATH URLs ("/uploads/public/company/logos/<file>").
// In dev that path is proxied by Vite to the backend; in production the
// frontend and backend are same-origin, so the same path resolves directly.
// An optional VITE_ASSET_BASE_URL env var lets a future deployment point at
// a different origin (e.g. an Electron asset host) without changing call sites.

const RAW_BASE = (import.meta.env.VITE_ASSET_BASE_URL as string | undefined) ?? '';
const BASE = RAW_BASE.replace(/\/+$/, '');

/**
 * Resolve a server-provided asset URL/path to one the browser can fetch.
 *
 * - Empty / null input returns null (caller should render the fallback).
 * - Fully-qualified URLs (http://, https://, data:) pass through untouched.
 * - Relative paths are prefixed with VITE_ASSET_BASE_URL when set, else
 *   left absolute so the browser hits the current origin (Vite proxy in
 *   dev, same-origin in prod).
 */
export function resolveAssetUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^(?:https?:|data:)/i.test(trimmed)) return trimmed;
  // Ensure exactly one slash between base and path.
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${BASE}${path}`;
}
