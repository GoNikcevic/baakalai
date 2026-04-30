const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Derive a 32-byte encryption key from the server secret.
 * In production, ENCRYPTION_SECRET must be set — the server will crash otherwise.
 * In dev, a fallback is used with a warning.
 */
function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    if (IS_PRODUCTION) {
      throw new Error('ENCRYPTION_SECRET is required in production. Set it in your .env file.');
    }
    console.warn('⚠️  ENCRYPTION_SECRET not set — using insecure fallback. Set it in .env for production.');
    const fallback = 'bakal-default-key-change-me-in-production';
    return crypto.scryptSync(fallback, 'bakal-dev-salt', 32);
  }
  const salt = process.env.ENCRYPTION_SALT || 'bakal-production-salt-v1';
  return crypto.scryptSync(secret, salt, 32);
}

/**
 * Encrypt a plaintext string → "iv:tag:ciphertext" (all hex-encoded)
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt an "iv:tag:ciphertext" string → plaintext
 */
function decrypt(encoded) {
  const key = getEncryptionKey();
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Mask a key for display: show first 7 and last 4 chars.
 * e.g. "sk-ant-api03-xxxx...xxxx" → "sk-ant-***...xxxx"
 */
function maskKey(plaintext) {
  if (!plaintext || plaintext.length < 12) return '***';
  return plaintext.slice(0, 7) + '***...' + plaintext.slice(-4);
}

module.exports = { encrypt, decrypt, maskKey };
