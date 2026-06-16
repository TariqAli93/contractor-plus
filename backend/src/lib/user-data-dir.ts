import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

let cached: string | null = null;

export function getUserDataDir(): string {
  if (cached) return cached;
  const override = process.env[ENV_OVERRIDE];
  const dir = override && override.trim().length > 0 ? path.resolve(override) : platformDefaultDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cached = dir;
  return dir;
}
