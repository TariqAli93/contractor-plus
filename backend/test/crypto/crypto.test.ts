import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../../src/lib/crypto.js';

// 1) Round trip: what goes in comes back out, including unicode + empty string.
test('encryptSecret/decryptSecret round-trips the plaintext', () => {
  for (const plain of ['sk-openrouter-abc123', 'مفتاح سري', '', 'a'.repeat(5000)]) {
    const blob = encryptSecret(plain);
    assert.notEqual(blob, plain, 'ciphertext is not the plaintext');
    assert.match(blob, /^v1:/, 'self-describing versioned blob');
    assert.equal(decryptSecret(blob), plain, 'decrypts back to the original');
  }
});

// 2) Tampering with the GCM auth tag (or ciphertext) must be rejected, not
//    silently accepted — this is the whole point of an AEAD cipher.
test('decryptSecret rejects a tampered auth tag', () => {
  const blob = encryptSecret('do-not-forge-me');
  const [ver, iv, tag, data] = blob.split(':');

  // Flip one byte of the auth tag.
  const tagBuf = Buffer.from(tag!, 'base64');
  tagBuf[0] = tagBuf[0]! ^ 0xff;
  const forgedTag = [ver, iv, tagBuf.toString('base64'), data].join(':');
  assert.throws(() => decryptSecret(forgedTag), 'tampered tag is rejected');

  // Flip one byte of the ciphertext.
  const dataBuf = Buffer.from(data!, 'base64');
  dataBuf[0] = dataBuf[0]! ^ 0xff;
  const forgedData = [ver, iv, tag, dataBuf.toString('base64')].join(':');
  assert.throws(() => decryptSecret(forgedData), 'tampered ciphertext is rejected');
});

// 3) A fresh random IV per call → encrypting the SAME plaintext twice yields
//    different IVs and different ciphertexts (no nonce reuse).
test('encryptSecret uses a unique IV per call', () => {
  const plain = 'same-input-every-time';
  const a = encryptSecret(plain);
  const b = encryptSecret(plain);
  assert.notEqual(a, b, 'two encryptions of the same input differ');

  const ivA = a.split(':')[1];
  const ivB = b.split(':')[1];
  assert.notEqual(ivA, ivB, 'the IV is fresh per call');

  // Both still decrypt back to the same plaintext.
  assert.equal(decryptSecret(a), plain);
  assert.equal(decryptSecret(b), plain);
});

// 4) A malformed blob (wrong shape / unknown version) is rejected cleanly.
test('decryptSecret rejects a malformed blob', () => {
  assert.throws(() => decryptSecret('not-a-valid-blob'));
  assert.throws(() => decryptSecret('v2:aaa:bbb:ccc'), /Unsupported/);
});
