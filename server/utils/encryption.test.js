'use strict';

/**
 * Unit tests for the AES-256-GCM encryption helpers (Feature 3).
 */

const { encrypt, decrypt, isEncrypted } = require('./encryption');

const PREV_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  // Deterministic 32-char key for the suite.
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
});

afterAll(() => {
  if (PREV_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = PREV_KEY;
});

describe('encryption util', () => {
  test('round-trips a value: decrypt(encrypt(x)) === x', () => {
    const secret = 'ACCT-1234567890';
    const enc = encrypt(secret);
    expect(enc).not.toBe(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(decrypt(enc)).toBe(secret);
  });

  test('produces a different ciphertext each call (random IV)', () => {
    const a = encrypt('same-value');
    const b = encrypt('same-value');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same-value');
    expect(decrypt(b)).toBe('same-value');
  });

  test('emits the iv:authTag:cipherText wire format', () => {
    const parts = encrypt('hello').split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16-byte IV in hex
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // GCM tag in hex
  });

  test('decrypt returns null for malformed input', () => {
    expect(decrypt('not-encrypted')).toBeNull();
    expect(decrypt('a:b')).toBeNull();
    expect(decrypt('')).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  test('decrypt returns null when the auth tag fails (tampering)', () => {
    const enc = encrypt('tamper-me');
    const [iv, , data] = enc.split(':');
    // Swap in a wrong (but well-formed) auth tag.
    const tampered = `${iv}:${'0'.repeat(32)}:${data}`;
    expect(decrypt(tampered)).toBeNull();
  });

  test('encrypt passes through empty / non-string values unchanged', () => {
    expect(encrypt('')).toBe('');
    expect(encrypt(null)).toBeNull();
    expect(encrypt(undefined)).toBeUndefined();
  });

  test('encrypt throws when the key is the wrong length', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'too-short';
    try {
      expect(() => encrypt('x')).toThrow(/32 characters/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });
});
