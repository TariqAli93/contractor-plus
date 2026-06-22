import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_SERVICE_MODE } from '../config/env.js';

const APP_DIR_NAME = 'ContractorPlus';
const ENV_OVERRIDE = 'CONTRACTOR_PLUS_DATA_DIR';

function platformDefaultDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), APP_DIR_NAME);
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_DIR_NAME);
    default:
      return path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), APP_DIR_NAME);
  }
}

function ensure(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

let cached: string | null = null;

/**
 * Resolve the local data root.
 *
 * In SERVICE mode this is derived from the validated service.json: env.ts sets
 * `UPLOAD_ROOT = <home>/data/uploads`, so the storage service constructs its root
 * directly and this helper is not reached. As a safety net, service mode here
 * fails loudly rather than silently writing into the service account's APPDATA —
 * the per-machine data dir must come from the validated config, never a guess.
 *
 * In dev/test it keeps the platform default (APPDATA / XDG) or an explicit
 * CONTRACTOR_PLUS_DATA_DIR override, so dev behavior is unchanged.
 */
export function getUserDataDir(): string {
  if (cached) return cached;

  const override = process.env[ENV_OVERRIDE];
  if (override && override.trim().length > 0) {
    cached = ensure(path.resolve(override));
    return cached;
  }

  if (IS_SERVICE_MODE) {
    throw new Error(
      `[user-data-dir] ${ENV_OVERRIDE} is not set in service mode — refusing to fall back to ` +
        'APPDATA. The data root must derive from the validated service.json (UPLOAD_ROOT).',
    );
  }

  cached = ensure(platformDefaultDir());
  return cached;
}
