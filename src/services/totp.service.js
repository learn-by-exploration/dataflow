'use strict';

/**
 * TOTP (Time-based One-Time Password) service.
 * Implements RFC 6238 TOTP using HMAC-SHA1, 6 digits, 30-second period.
 */

const crypto = require('crypto');

const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;

/**
 * Decode a base32-encoded string to a Buffer.
 */
function base32Decode(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = encoded.replace(/[\s=-]+/g, '').toUpperCase();

  let bits = '';
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

/**
 * Generate a TOTP code.
 * @param {string} secret - base32-encoded secret
 * @param {number} [timestamp] - Unix time in ms (defaults to Date.now())
 * @param {object} [options]
 * @param {number} [options.period=30] - Time step in seconds
 * @param {number} [options.digits=6] - Number of digits
 * @returns {string} The TOTP code (zero-padded)
 */
function generateCode(secret, timestamp, options = {}) {
  const period = options.period || DEFAULT_PERIOD;
  const digits = options.digits || DEFAULT_DIGITS;
  const time = timestamp != null ? timestamp : Date.now();

  const counter = Math.floor(time / 1000 / period);

  // Convert counter to 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  // Write as big-endian 64-bit (high 32 bits then low 32 bits)
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const keyBuf = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', keyBuf);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  // Dynamic truncation (RFC 4226)
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * Parse an otpauth:// URI.
 * Format: otpauth://totp/LABEL?secret=SECRET&issuer=ISSUER
 * @param {string} uri
 * @returns {{ type: string, label: string, secret: string, issuer: string, account: string, period: number, digits: number }}
 */
function parseOtpauthUri(uri) {
  if (!uri || !uri.startsWith('otpauth://')) {
    throw new Error('Invalid otpauth URI');
  }

  const url = new URL(uri);
  const type = url.hostname; // 'totp' or 'hotp'
  const label = decodeURIComponent(url.pathname.slice(1)); // remove leading /
  const secret = url.searchParams.get('secret') || '';
  const issuer = url.searchParams.get('issuer') || '';
  const period = parseInt(url.searchParams.get('period'), 10) || DEFAULT_PERIOD;
  const digits = parseInt(url.searchParams.get('digits'), 10) || DEFAULT_DIGITS;

  // Parse account from label (may be "issuer:account" or just "account")
  let account = label;
  if (label.includes(':')) {
    account = label.split(':').slice(1).join(':').trim();
  }

  return { type, label, secret, issuer, account, period, digits };
}

/**
 * Get remaining seconds until next code rotation.
 * @param {number} [period=30] - Time step in seconds
 * @returns {number}
 */
function getRemainingSeconds(period) {
  const p = period || DEFAULT_PERIOD;
  const now = Math.floor(Date.now() / 1000);
  return p - (now % p);
}

/**
 * Verify a TOTP code (allows ±1 time window for clock skew).
 * @param {string} code - The code to verify
 * @param {string} secret - base32-encoded secret
 * @param {object} [options]
 * @returns {boolean}
 */
function verifyCode(code, secret, options = {}) {
  const period = options.period || DEFAULT_PERIOD;
  const now = Date.now();

  // Check current and adjacent time windows
  for (let i = -1; i <= 1; i++) {
    const ts = now + i * period * 1000;
    const expected = generateCode(secret, ts, options);
    if (code.length === expected.length && crypto.timingSafeEqual(Buffer.from(code, 'utf8'), Buffer.from(expected, 'utf8'))) return true;
  }
  return false;
}

module.exports = { generateCode, parseOtpauthUri, getRemainingSeconds, verifyCode, base32Decode };
