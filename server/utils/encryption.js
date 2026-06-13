'use strict';

/**
 * AES-256-GCM encryption helpers for sensitive data at rest (Feature 3).
 *
 * The key comes from `process.env.ENCRYPTION_KEY` and must be exactly 32
 * characters (256 bits). The key is read lazily inside encrypt/decrypt so the
 * server still boots when it is absent — only an actual encrypt/decrypt call
 * fails. This keeps a deploy that hasn't set the key yet from crashing on
 * startup; it is intentionally NOT part of the required-secret boot guard.
 *
 * Wire format of an encrypted value:  `iv:authTag:cipherText`
 *   - iv         16 random bytes, hex
 *   - authTag    GCM authentication tag, hex
 *   - cipherText the encrypted payload, hex
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Resolve and validate the 32-char encryption key from the environment.
 * @returns {Buffer}
 * @throws {Error} when ENCRYPTION_KEY is missing or not exactly 32 chars.
 */
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (typeof key !== 'string' || key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be set to exactly ${KEY_LENGTH} characters to use encryption.`,
    );
  }
  return Buffer.from(key, 'utf8');
}

/**
 * Encrypt a UTF-8 string. Returns `iv:authTag:cipherText` (all hex).
 * Non-string / empty inputs are returned unchanged so callers can apply this
 * blindly to optional fields.
 *
 * @param {string} text
 * @returns {string}
 */
function encrypt(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a value produced by {@link encrypt}. Returns the original plaintext,
 * or `null` if the input is malformed or authentication fails (tampering,
 * wrong key, etc.) — never throws, so a corrupt value can't crash a request.
 *
 * @param {string} encryptedString
 * @returns {string | null}
 */
function decrypt(encryptedString) {
  if (typeof encryptedString !== 'string' || encryptedString.length === 0) {
    return null;
  }
  try {
    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      return null;
    }
    const [ivHex, authTagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (_err) {
    return null;
  }
}

/**
 * Heuristic: does a stored string already look like our `iv:tag:data` format?
 * Used by models to avoid double-encrypting an already-encrypted value.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  return (
    parts.length === 3 &&
    /^[0-9a-f]{32}$/i.test(parts[0]) &&
    /^[0-9a-f]{32}$/i.test(parts[1]) &&
    /^[0-9a-f]+$/i.test(parts[2])
  );
}

module.exports = { encrypt, decrypt, isEncrypted };
