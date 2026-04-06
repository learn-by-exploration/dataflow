'use strict';

/**
 * Client-side crypto module for DataFlow.
 * Uses AES-256-GCM (same as server-side encryption.js) — compatible format.
 * Works in both browser (WebCrypto) and Node.js 22+ (crypto module).
 *
 * All outputs are hex-encoded strings to match server format.
 */

// In Node.js, use the full crypto module (has createCipheriv etc.).
// In browser, globalThis.crypto only has WebCrypto — we'd use subtle API.
// Since this module targets Node.js 22+ for now, always use require('crypto').
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

// ─── Helpers ───

function randomBytes(length) {
  if (typeof crypto.randomBytes === 'function') {
    return crypto.randomBytes(length);
  }
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return Buffer.from(buf);
}

function toHex(buf) {
  if (Buffer.isBuffer(buf)) return buf.toString('hex');
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return Buffer.from(hex, 'hex');
}

// ─── Key Derivation ───

/**
 * Derive a 256-bit key from password using PBKDF2 with SHA-256.
 * @param {string} password
 * @param {string} salt - hex-encoded salt
 * @param {number} [iterations=100000]
 * @returns {Promise<Buffer>} 32-byte derived key
 */
async function deriveKey(password, salt, iterations = 100000) {
  const saltBuf = fromHex(salt);
  if (typeof crypto.pbkdf2Sync === 'function') {
    return crypto.pbkdf2Sync(password, saltBuf, iterations, KEY_LENGTH, 'sha256');
  }
  // WebCrypto path
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH * 8
  );
  return Buffer.from(bits);
}

// ─── Random Generation ───

/**
 * Generate a random 32-byte salt (hex-encoded).
 * @returns {string}
 */
function generateSalt() {
  return toHex(randomBytes(SALT_LENGTH));
}

/**
 * Generate a random 12-byte IV (hex-encoded).
 * @returns {string}
 */
function generateIV() {
  return toHex(randomBytes(IV_LENGTH));
}

// ─── Encrypt / Decrypt ───

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {string} plaintext
 * @param {Buffer} key - 32-byte key
 * @returns {{ ciphertext: string, iv: string, tag: string }} hex-encoded
 */
function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted,
    iv: toHex(iv),
    tag: toHex(tag),
  };
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 * @param {string} ciphertext - hex
 * @param {string} iv - hex
 * @param {string} tag - hex
 * @param {Buffer} key - 32-byte key
 * @returns {string} plaintext
 */
function decrypt(ciphertext, iv, tag, key) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, fromHex(iv));
  decipher.setAuthTag(fromHex(tag));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── Vault Key Management ───

/**
 * Generate a random 32-byte vault key.
 * @returns {Buffer}
 */
function generateVaultKey() {
  return randomBytes(KEY_LENGTH);
}

/**
 * Wrap (encrypt) a vault key with a derived key.
 * @param {Buffer} vaultKey
 * @param {Buffer} derivedKey
 * @returns {{ ciphertext: string, iv: string, tag: string }}
 */
function wrapVaultKey(vaultKey, derivedKey) {
  return encrypt(vaultKey.toString('hex'), derivedKey);
}

/**
 * Unwrap (decrypt) a vault key with a derived key.
 * @param {{ ciphertext: string, iv: string, tag: string }} wrapped
 * @param {Buffer} derivedKey
 * @returns {Buffer}
 */
function unwrapVaultKey(wrapped, derivedKey) {
  const hex = decrypt(wrapped.ciphertext, wrapped.iv, wrapped.tag, derivedKey);
  return fromHex(hex);
}

// ─── File/Buffer Encryption ───

/**
 * Encrypt a buffer with AES-256-GCM.
 * @param {Buffer} buffer
 * @param {Buffer} key - 32-byte key
 * @returns {{ encrypted: Buffer, iv: string, tag: string }}
 */
function encryptBuffer(buffer, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted,
    iv: toHex(iv),
    tag: toHex(tag),
  };
}

/**
 * Decrypt a buffer with AES-256-GCM.
 * @param {Buffer} encBuffer
 * @param {string} iv - hex
 * @param {string} tag - hex
 * @param {Buffer} key - 32-byte key
 * @returns {Buffer}
 */
function decryptBuffer(encBuffer, iv, tag, key) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, fromHex(iv));
  decipher.setAuthTag(fromHex(tag));
  return Buffer.concat([decipher.update(encBuffer), decipher.final()]);
}

module.exports = {
  deriveKey,
  generateSalt,
  generateIV,
  encrypt,
  decrypt,
  generateVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  encryptBuffer,
  decryptBuffer,
};
