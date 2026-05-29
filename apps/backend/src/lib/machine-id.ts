import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getUserDataDir } from './user-data-dir.js';

const MACHINE_ID_FILE = 'machine-id';

let cached: string | null = null;

export function getOrCreateMachineId(): string {
  if (cached) return cached;
  const file = path.join(getUserDataDir(), MACHINE_ID_FILE);
  if (existsSync(file)) {
    const value = readFileSync(file, 'utf8').trim();
    if (value.length > 0) {
      cached = value;
      return value;
    }
  }
  const id = randomUUID();
  writeFileSync(file, id, { mode: 0o600 });
  cached = id;
  return id;
}
