import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BINARY_NAME = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

export interface CloudflaredCandidate {
  path: string;
  exists: boolean;
  valid: boolean;
  note: string;
}

export type CloudflaredResolution =
  | { status: 'found'; path: string; candidates: string[]; checked: CloudflaredCandidate[] }
  | { status: 'missing'; path: null; candidates: string[]; checked: CloudflaredCandidate[] };

function pushIf(arr: string[], p: string | undefined | null): void {
  if (!p) return;
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  if (!arr.includes(abs)) arr.push(abs);
}

// Production (Electron / WinSW-installed standalone) layouts place cloudflared
// alongside the bundled backend; dev layout has it under tools/ in the repo.
// Resolution order mirrors nuqta-plus's remoteAccess utility, adjusted for the
// extra apps/backend/ depth in this monorepo.
function buildCandidates(): string[] {
  const envOverride = process.env.CLOUDFLARED_PATH;
  if (envOverride && envOverride.trim().length > 0) {
    return [path.isAbsolute(envOverride) ? envOverride : path.resolve(envOverride)];
  }

  const candidates: string[] = [];

  // 1. Electron-spawned backend
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    pushIf(candidates, path.join(resourcesPath, BINARY_NAME));
    pushIf(candidates, path.join(resourcesPath, 'resources', BINARY_NAME));
  }

  // 2. Production standalone — from apps/backend/dist/lib/cloudflared-path.js
  //    four levels up == package root.
  pushIf(candidates, path.join(__dirname, '..', '..', '..', '..', BINARY_NAME));

  // 3. Dev monorepo — from apps/backend/src/lib/ five levels up == repo root.
  pushIf(
    candidates,
    path.join(__dirname, '..', '..', '..', '..', '..', 'tools', 'cloudflared', BINARY_NAME),
  );

  // 4. cwd fallbacks
  pushIf(candidates, path.resolve(process.cwd(), 'tools', 'cloudflared', BINARY_NAME));
  pushIf(candidates, path.resolve(process.cwd(), BINARY_NAME));

  return candidates;
}

export function resolveCloudflaredPath(): CloudflaredResolution {
  const candidates = buildCandidates();
  const checked: CloudflaredCandidate[] = [];
  let resolved: string | null = null;

  for (const p of candidates) {
    const exists = existsSync(p);
    let valid = false;
    let note = exists ? 'exists' : 'missing';
    if (exists) {
      try {
        const st = statSync(p);
        if (st.isFile() && st.size > 0) {
          valid = true;
        } else if (!st.isFile()) {
          note = 'not a regular file';
        } else {
          note = 'empty file';
        }
      } catch (err) {
        note = `stat failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    checked.push({ path: p, exists, valid, note });
    if (valid && !resolved) {
      resolved = p;
      break;
    }
  }

  if (resolved) return { status: 'found', path: resolved, candidates, checked };
  return { status: 'missing', path: null, candidates, checked };
}
