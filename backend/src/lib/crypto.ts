import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';

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
// service-host bootstrap). The 256-bit key is derived via HKDF from a DEDICATED
// secret (SECRET_ENCRYPTION_KEY), so this concern is decoupled from auth: rotating
// the JWT signing secret no longer invalidates stored ciphertexts, and one leaked
// secret does not compromise both. When the dedicated key is not provisioned the
// app falls back to JWT_ACCESS_SECRET (backward-compatible for existing installs)
// and warns at startup — see checkEncryptionKeyConfig().
// Output is a self-describing, versioned string:
//   v1:<iv b64>:<authTag b64>:<ciphertext b64>
// Rotating the derivation secret invalidates stored ciphertexts by design
// (re-enter the secret) — the v1 prefix leaves room for a future migration scheme.

const SECRET_VERSION = 'v1';

/** Minimum length for a usable dedicated encryption secret. */
const MIN_ENCRYPTION_KEY_LEN = 32;

/** The dedicated secret if configured (≥32 chars), else null. */
function dedicatedEncryptionKey(): string | null {
  const key = env.SECRET_ENCRYPTION_KEY?.trim();
  return key && key.length >= MIN_ENCRYPTION_KEY_LEN ? key : null;
}

/** Key material for HKDF: the dedicated secret when provisioned, otherwise the
 *  JWT secret (legacy fallback — flagged at startup by checkEncryptionKeyConfig). */
function encryptionKeyMaterial(): string {
  return dedicatedEncryptionKey() ?? env.JWT_ACCESS_SECRET;
}

function deriveSecretKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', encryptionKeyMaterial(), 'cp-secret-salt', 'cp-secret-encryption', 32),
  );
}

/**
 * Startup validation for the secret-encryption key. Called once from buildApp().
 * A dedicated SECRET_ENCRYPTION_KEY is strongly preferred; when it is absent (or
 * too short) the app falls back to JWT_ACCESS_SECRET. In production that fallback
 * is a hardening gap, so we surface it loudly rather than silently; in dev it is a
 * benign info note.
 */
export function checkEncryptionKeyConfig(): void {
  if (dedicatedEncryptionKey()) return;
  const raw = env.SECRET_ENCRYPTION_KEY?.trim();
  const detail = raw
    ? `SECRET_ENCRYPTION_KEY is set but shorter than ${MIN_ENCRYPTION_KEY_LEN} characters — ignoring it`
    : 'SECRET_ENCRYPTION_KEY is not configured';
  const message =
    `[crypto] ${detail}; falling back to JWT_ACCESS_SECRET for secret encryption. ` +
    `Provision a dedicated ${MIN_ENCRYPTION_KEY_LEN}+ char SECRET_ENCRYPTION_KEY so auth and ` +
    `at-rest secret encryption use independent keys.`;
  if (env.NODE_ENV === 'production') logger.error(message);
  else logger.info(message);
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
