/**
 * Security-critical unit tests for the AES-256-GCM secret cipher (Phase 2.5).
 * Covers the round-trip, key-material rejection, and tamper detection — the
 * three properties the OpenRouter-key-at-rest guarantee rests on.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  SecretCipher,
  SecretCipherError,
  createSecretCipher,
  lastFour,
  resolveEncryptionKey,
} from '../../src/lib/crypto/secret-cipher.js';

const HEX_KEY = randomBytes(32).toString('hex'); // 64 hex chars = 32 bytes
const BASE64_KEY = randomBytes(32).toString('base64');
const SECRET = 'sk-or-v1-abcdef0123456789-THE-REAL-OPENROUTER-KEY';

test('round-trip: encrypt then decrypt returns the original plaintext', () => {
  const cipher = new SecretCipher(HEX_KEY);
  const sealed = cipher.encrypt(SECRET);
  assert.equal(cipher.decrypt(sealed), SECRET);
});

test('ciphertext never contains the plaintext, and reveals nothing on its own', () => {
  const cipher = new SecretCipher(HEX_KEY);
  const sealed = cipher.encrypt(SECRET);
  const blob = `${sealed.ciphertext}${sealed.iv}${sealed.authTag}`;
  assert.ok(!blob.includes(SECRET));
  assert.ok(!blob.includes('sk-or'));
});

test('each encryption uses a fresh IV (ciphertext differs for the same input)', () => {
  const cipher = new SecretCipher(HEX_KEY);
  const a = cipher.encrypt(SECRET);
  const b = cipher.encrypt(SECRET);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  // Both still decrypt back to the same secret.
  assert.equal(cipher.decrypt(a), SECRET);
  assert.equal(cipher.decrypt(b), SECRET);
});

test('hex, base64, and raw ≥32-byte passphrases are all accepted', () => {
  // The passphrase has spaces so it is neither valid hex nor base64 → utf8.
  const passphrase = 'correct horse battery staple padding!';
  for (const key of [HEX_KEY, BASE64_KEY, passphrase]) {
    assert.equal(resolveEncryptionKey(key).length, 32);
    const c = new SecretCipher(key);
    assert.equal(c.decrypt(c.encrypt(SECRET)), SECRET);
  }
});

test('a hex-looking 32-char string is 16 bytes → rejected (deterministic decode)', () => {
  // 'a'.repeat(32) is valid hex, so it decodes to 16 bytes, not 32.
  assert.throws(() => resolveEncryptionKey('a'.repeat(32)), (e: unknown) => e instanceof SecretCipherError);
});

test('a too-short key is REJECTED (constructor throws, factory returns null)', () => {
  assert.throws(() => new SecretCipher('tooshort'), (e: unknown) => e instanceof SecretCipherError);
  assert.throws(() => resolveEncryptionKey('short'), (e: unknown) => e instanceof SecretCipherError);
  assert.equal(createSecretCipher('short'), null);
});

test('absent key → factory returns null (safe-disable, no throw)', () => {
  assert.equal(createSecretCipher(undefined), null);
  assert.equal(createSecretCipher(null), null);
  assert.equal(createSecretCipher(''), null);
});

test('a valid key → factory returns a working cipher', () => {
  const cipher = createSecretCipher(HEX_KEY);
  assert.ok(cipher);
  assert.equal(cipher!.decrypt(cipher!.encrypt(SECRET)), SECRET);
});

test('tampered ciphertext fails authentication (GCM tag mismatch)', () => {
  const cipher = new SecretCipher(HEX_KEY);
  const sealed = cipher.encrypt(SECRET);
  // Flip a byte in the ciphertext.
  const bytes = Buffer.from(sealed.ciphertext, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  const tampered = { ...sealed, ciphertext: bytes.toString('base64') };
  assert.throws(() => cipher.decrypt(tampered), (e: unknown) => e instanceof SecretCipherError);
});

test('tampered auth tag fails', () => {
  const cipher = new SecretCipher(HEX_KEY);
  const sealed = cipher.encrypt(SECRET);
  const tag = Buffer.from(sealed.authTag, 'base64');
  tag[0] = tag[0]! ^ 0x01;
  assert.throws(
    () => cipher.decrypt({ ...sealed, authTag: tag.toString('base64') }),
    (e: unknown) => e instanceof SecretCipherError,
  );
});

test('a different key cannot decrypt (no cross-key leakage)', () => {
  const sealed = new SecretCipher(HEX_KEY).encrypt(SECRET);
  const otherKey = randomBytes(32).toString('hex');
  assert.throws(
    () => new SecretCipher(otherKey).decrypt(sealed),
    (e: unknown) => e instanceof SecretCipherError,
  );
});

test('malformed IV / tag are rejected cleanly (not a crash)', () => {
  const cipher = new SecretCipher(HEX_KEY);
  const sealed = cipher.encrypt(SECRET);
  assert.throws(
    () => cipher.decrypt({ ...sealed, iv: Buffer.from('short').toString('base64') }),
    (e: unknown) => e instanceof SecretCipherError,
  );
});

test('lastFour returns only the trailing 4 chars for masked display', () => {
  assert.equal(lastFour('sk-or-verylongsecret-CAFE'), 'CAFE');
  assert.equal(lastFour('ab'), 'ab');
});
