import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { env } from '../config/env.js';

export function generateOpaqueToken(byteLength = 48): string {
  return randomBytes(byteLength).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ---------- Reversible secret encryption (AES-256-GCM) ----------
//
// For secrets that must be stored AND read back (e.g. a third-party API key in
// the settings table) — distinct from sha256 (one-way) and DPAPI (decrypt-only,
// service-host bootstrap). The 256-bit key is derived via HKDF from the app's
// existing JWT secret (service.json in production, .env in dev), so no NEW
// secret needs provisioning. Output is a self-describing, versioned string:
//   v1:<iv b64>:<authTag b64>:<ciphertext b64>
// Rotating JWT_ACCESS_SECRET invalidates stored ciphertexts by design (re-enter
// the secret) — the v1 prefix leaves room for a future migration scheme.

const SECRET_VERSION = 'v1';

function deriveSecretKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', env.JWT_ACCESS_SECRET, 'cp-secret-salt', 'cp-secret-encryption', 32),
  );
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveSecretKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SECRET_VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(
    ':',
  );
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== SECRET_VERSION) {
    throw new Error('Unsupported encrypted secret format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', deriveSecretKey(), Buffer.from(ivB64!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64!, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
