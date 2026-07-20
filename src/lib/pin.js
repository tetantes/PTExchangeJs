const crypto = require('crypto');

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPin(pin, hash, salt) {
  const candidate = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  // Timing-safe compare - avoids leaking how many leading digits matched.
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPin, verifyPin };
