// bcryptjs (pure-JS) instead of the native `bcrypt` addon: the backend runs
// as an Electron child process via ELECTRON_RUN_AS_NODE in production, where a
// native addon would need an Electron-ABI rebuild. bcryptjs produces the same
// $2a$/$2b$ hash format, so existing hashes remain valid.
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
