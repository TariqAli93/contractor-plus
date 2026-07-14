import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Phase 2.5 — authenticated symmetric encryption for the OpenRouter API key at
// rest in the DB. AES-256-GCM (node:crypto, no external dependency). The key
// material comes ONLY from ENCRYPTION_KEY (env / service.json) and is NEVER
// stored in the DB, returned by any endpoint, or logged.
//
// Threat model (documented for honesty): this protects the stored key against
// DB-only exposure — a database dump, backup, or read-replica leak cannot
// reveal it without ENCRYPTION_KEY. It does NOT defend against an attacker who
// can already read the server configuration where ENCRYPTION_KEY lives; in
// production that file is DPAPI-encrypted + ACL-locked by the setup wizard.

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce
const AUTH_TAG_BYTES = 16;

export class SecretCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCipherError';
  }
}

/** The stored, at-rest form of a secret. None of these reveal the plaintext. */
export interface SealedSecret {
  /** base64 */
  ciphertext: string;
  /** base64 (12-byte GCM nonce, unique per encryption) */
  iv: string;
  /** base64 (16-byte GCM authentication tag) */
  authTag: string;
}

/**
 * Decode an ENCRYPTION_KEY string into exactly 32 key bytes. Accepts hex
 * (64 chars), standard base64, or a raw ≥32-byte passphrase, in that order of
 * preference (deterministic — never mis-reads a passphrase as base64). Throws
 * when the decoded material is shorter than 32 bytes.
 */
export function resolveEncryptionKey(raw: string): Buffer {
  let decoded: Buffer;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    decoded = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length % 4 === 0) {
    decoded = Buffer.from(raw, 'base64');
  } else {
    decoded = Buffer.from(raw, 'utf8');
  }
  if (decoded.length < KEY_BYTES) {
    throw new SecretCipherError(
      `ENCRYPTION_KEY must decode to at least ${KEY_BYTES} bytes (got ${decoded.length})`,
    );
  }
  // Use exactly 32 bytes for AES-256; copy so we never retain a longer buffer.
  return Buffer.from(decoded.subarray(0, KEY_BYTES));
}

export class SecretCipher {
  private readonly key: Buffer;

  /** @throws {SecretCipherError} when the key is shorter than 32 bytes. */
  constructor(encryptionKey: string) {
    this.key = resolveEncryptionKey(encryptionKey);
  }

  encrypt(plaintext: string): SealedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  /** @throws {SecretCipherError} on any tamper (wrong key, altered ciphertext/tag). */
  decrypt(sealed: SealedSecret): string {
    const iv = Buffer.from(sealed.iv, 'base64');
    const authTag = Buffer.from(sealed.authTag, 'base64');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new SecretCipherError('malformed IV or auth tag');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      // Never surface the underlying crypto error (could leak detail); a
      // failed GCM auth means the data was tampered with or the key is wrong.
      throw new SecretCipherError('decryption failed: data has been tampered with or the key is wrong');
    }
  }
}

/**
 * Build a cipher, or return null when key management is unavailable (absent or
 * too-short ENCRYPTION_KEY) — the safe-disable path. Callers treat null as
 * "DB-stored key management is off"; nothing crashes.
 */
export function createSecretCipher(encryptionKey: string | undefined | null): SecretCipher | null {
  if (!encryptionKey) return null;
  try {
    return new SecretCipher(encryptionKey);
  } catch {
    return null;
  }
}

/** The last 4 chars, for masked display (`••••••{lastFour}`). Never the key. */
export function lastFour(value: string): string {
  return value.length <= 4 ? value : value.slice(-4);
}
