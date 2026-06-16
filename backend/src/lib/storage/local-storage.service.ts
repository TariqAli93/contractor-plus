import { randomUUID } from 'node:crypto';
import { constants as FS, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { access, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { getUserDataDir } from '../user-data-dir.js';
import type {
  PrivateStorageBucket,
  PublicStorageBucket,
  SaveOptions,
  StorageBucket,
  StorageHealth,
  StorageService,
  StoredFile,
} from './storage.types.js';

// Local filesystem implementation of the StorageService contract.
//
// On-disk layout (under env.UPLOAD_ROOT or <userDataDir>/uploads):
//   public/
//     company/logos/<uuid>.<ext>     ← world-readable via /uploads/public/...
//     company/stamps/<uuid>.<ext>
//   private/
//     contracts/<uuid>.<ext>         ← never statically served
//     templates/<uuid>.<ext>
//     temp/<uuid>.<ext>
//
// The static plugin in app.ts mounts ONLY the public root, so a future
// private file written here can never be reached over HTTP without a
// dedicated authenticated download endpoint.
//
// Public URLs are formed as `<PUBLIC_PREFIX>/<relativePath>` where the
// relative path INCLUDES the "public/" prefix — explicit, predictable, and
// matches the on-disk layout one-to-one.

const PUBLIC_PREFIX = '/uploads';

const PUBLIC_BUCKETS: ReadonlySet<PublicStorageBucket> = new Set<PublicStorageBucket>([
  'public/company/logos',
  'public/company/stamps',
]);

const PRIVATE_BUCKETS: ReadonlySet<PrivateStorageBucket> = new Set<PrivateStorageBucket>([
  'private/contracts',
  'private/templates',
  'private/temp',
]);

const ALL_BUCKETS: ReadonlySet<StorageBucket> = new Set<StorageBucket>([
  ...PUBLIC_BUCKETS,
  ...PRIVATE_BUCKETS,
]);

export class LocalStorageService implements StorageService {
  private readonly root: string;
  private readonly publicRoot: string;
  private readonly privateRoot: string;

  constructor(root?: string) {
    // path.resolve handles spaces, mixed slashes, and Program Files-style
    // paths correctly on Windows. We then run it back through path.normalize
    // so the stored string is the canonical form for the platform.
    this.root = path.normalize(path.resolve(root ?? defaultRoot()));
    this.publicRoot = path.join(this.root, 'public');
    this.privateRoot = path.join(this.root, 'private');
    ensureDir(this.root);
    ensureDir(this.publicRoot);
    ensureDir(this.privateRoot);
    for (const bucket of ALL_BUCKETS) {
      ensureDir(path.join(this.root, ...bucket.split('/')));
    }
    // One-shot relocation of Phase 2 layout (no public/ prefix) to the new
    // layout. Safe to run on every boot: the function only moves files that
    // still live at the legacy path.
    relocateLegacyAssets(this.root);
  }

  async save(opts: SaveOptions): Promise<StoredFile> {
    if (!ALL_BUCKETS.has(opts.bucket)) {
      throw new Error(`storage: unknown bucket "${opts.bucket}"`);
    }
    const ext = sanitizeExtension(opts.extension);
    const filename = `${randomUUID()}.${ext}`;
    const relativePath = `${opts.bucket}/${filename}`;
    const absolute = this.resolveAbsolutePath(relativePath);

    await writeFile(absolute, opts.contents, { mode: 0o600 });

    return {
      bucket: opts.bucket,
      filename,
      relativePath,
      publicUrl: isPublicBucket(opts.bucket) ? `${PUBLIC_PREFIX}/${relativePath}` : null,
      size: opts.contents.length,
      mimeType: opts.mimeType,
    };
  }

  async remove(relativePath: string): Promise<void> {
    if (!relativePath) return;
    let absolute: string;
    try {
      absolute = this.resolveAbsolutePath(relativePath);
    } catch {
      // Path traversal attempt or malformed input — nothing to remove.
      return;
    }
    try {
      await unlink(absolute);
    } catch (err) {
      // Idempotent: missing file is fine; surface only real I/O errors.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  resolveAbsolutePath(relativePath: string): string {
    // Reject anything that tries to leave the root. path.resolve normalises
    // .., empty segments, and Windows backslashes; we then re-check the
    // prefix to make absolutely sure the resolved path stays under root.
    if (!relativePath) {
      throw new Error('storage: empty path');
    }
    const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (cleaned.includes('..')) {
      throw new Error('storage: path traversal rejected');
    }
    const segments = cleaned.split('/').filter((s) => s.length > 0);
    const absolute = path.resolve(this.root, ...segments);
    const rel = path.relative(this.root, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('storage: resolved path escapes root');
    }
    return absolute;
  }

  getRoot(): string {
    return this.root;
  }

  getPublicRoot(): string {
    return this.publicRoot;
  }

  getPrivateRoot(): string {
    return this.privateRoot;
  }

  getPublicPrefix(): string {
    return PUBLIC_PREFIX;
  }

  async checkHealth(): Promise<StorageHealth> {
    const base = {
      root: this.root,
      publicRoot: this.publicRoot,
      privateRoot: this.privateRoot,
    };
    try {
      // R+W check on every root: read access lets the static plugin serve
      // files, write access lets uploads land.
      await access(this.root, FS.R_OK | FS.W_OK);
      await access(this.publicRoot, FS.R_OK | FS.W_OK);
      await access(this.privateRoot, FS.R_OK | FS.W_OK);
      // Write a tiny probe to verify the disk isn't full / read-only mounted.
      const probe = path.join(this.privateRoot, `.health-${randomUUID()}.tmp`);
      try {
        await writeFile(probe, 'ok', { mode: 0o600 });
      } finally {
        await unlink(probe).catch(() => undefined);
      }
      return { ...base, ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ...base, ok: false, error: message };
    }
  }
}

function defaultRoot(): string {
  return path.join(getUserDataDir(), 'uploads');
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true, mode: 0o700 });
}

function sanitizeExtension(ext: string): string {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  if (cleaned.length === 0) throw new Error('storage: empty extension');
  return cleaned;
}

function isPublicBucket(bucket: StorageBucket): boolean {
  return PUBLIC_BUCKETS.has(bucket as PublicStorageBucket);
}

/**
 * Phase 2 wrote company assets at `<root>/company/logos/<file>`.
 * Phase 2.5 puts them under `<root>/public/company/logos/<file>`.
 * On boot, move any leftover files from the legacy path into the new one.
 * Synchronous (the constructor needs the new layout in place before any
 * upload runs) and idempotent — empty dirs are left alone.
 *
 * The companion SQL migration rewrites companyProfile.{logo,stamp}Path
 * rows to add the "public/" prefix so existing DB references still resolve.
 */
function relocateLegacyAssets(root: string) {
  const moves: Array<{ from: string; to: string }> = [
    { from: path.join(root, 'company', 'logos'), to: path.join(root, 'public', 'company', 'logos') },
    { from: path.join(root, 'company', 'stamps'), to: path.join(root, 'public', 'company', 'stamps') },
    { from: path.join(root, 'templates'), to: path.join(root, 'private', 'templates') },
    { from: path.join(root, 'temp'), to: path.join(root, 'private', 'temp') },
  ];
  for (const { from, to } of moves) {
    if (!existsSync(from)) continue;
    let entries: string[];
    try {
      entries = readdirSync(from);
    } catch {
      continue;
    }
    if (entries.length === 0) continue;
    ensureDir(to);
    for (const name of entries) {
      const src = path.join(from, name);
      const dst = path.join(to, name);
      if (existsSync(dst)) continue;
      try {
        renameSync(src, dst);
      } catch (err) {
        console.warn(`[storage] failed to relocate ${src} → ${dst}:`, err);
      }
    }
  }
}

// Module-level singleton. Constructed once at boot via the env-derived
// root; the upload service and the static-serving plugin both share this
// instance so we never end up with two views of the storage directory.
let _instance: LocalStorageService | null = null;

export function getStorage(): LocalStorageService {
  if (!_instance) {
    _instance = new LocalStorageService(env.UPLOAD_ROOT);
  }
  return _instance;
}
