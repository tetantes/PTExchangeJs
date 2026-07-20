const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';

// The hex->Buffer decode is trivial cost per call, but this function used to
// run it fresh on every single encrypt/decrypt (every wallet generated,
// every /export_seed, every legacy import row). Decoding it once at module
// load removes that repeated work entirely - the key never changes at runtime.
let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const key = Buffer.from(config.encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  cachedKey = key;
  return key;
}

// Replaces the old obfuscate(text, uid) - real encryption instead of splitting
// on "|" and stripping a char off each word (which was trivially reversible).
function encrypt(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
