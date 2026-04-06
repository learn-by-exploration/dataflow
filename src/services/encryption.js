'use strict';

const crypto = require('crypto');
const argon2 = require('argon2');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {string} plaintext
 * @param {Buffer} key - 32-byte key
 * @returns {{ ciphertext: string, iv: string, tag: string }} hex-encoded
 */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
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
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Derive a key from password using Argon2id.
 * @param {string} password
 * @param {Buffer} salt
 * @param {{ memoryCost?: number, timeCost?: number, parallelism?: number }} params
 * @returns {Promise<Buffer>} 32-byte derived key
 */
async function deriveKey(password, salt, params = {}) {
  const derived = await argon2.hash(password, {
    salt,
    type: argon2.argon2id,
    memoryCost: params.memoryCost || 65536,
    timeCost: params.timeCost || 3,
    parallelism: params.parallelism || 1,
    hashLength: KEY_LENGTH,
    raw: true,
  });
  return derived;
}

/**
 * Generate a random 256-bit vault key.
 * @returns {Buffer} 32-byte key
 */
function generateVaultKey() {
  return crypto.randomBytes(KEY_LENGTH);
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
 * @returns {Buffer} vault key
 */
function unwrapVaultKey(wrapped, derivedKey) {
  const hex = decrypt(wrapped.ciphertext, wrapped.iv, wrapped.tag, derivedKey);
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a file with AES-256-GCM (sync, legacy).
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {Buffer} key
 * @returns {{ iv: string, tag: string }}
 */
function encryptFileSync(inputPath, outputPath, key) {
  const fs = require('fs');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const input = fs.readFileSync(inputPath);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  fs.writeFileSync(outputPath, encrypted);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt a file with AES-256-GCM (sync, legacy).
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} iv - hex
 * @param {string} tag - hex
 * @param {Buffer} key
 */
function decryptFileSync(inputPath, outputPath, iv, tag, key) {
  const fs = require('fs');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const input = fs.readFileSync(inputPath);
  const decrypted = Buffer.concat([decipher.update(input), decipher.final()]);
  fs.writeFileSync(outputPath, decrypted);
}

/**
 * Encrypt a file with AES-256-GCM using streams.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {Buffer} key
 * @returns {Promise<{ iv: string, tag: string }>}
 */
function encryptFile(inputPath, outputPath, key) {
  const fs = require('fs');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    input.on('error', reject);
    output.on('error', reject);
    input.pipe(cipher).pipe(output);
    output.on('finish', () => {
      resolve({
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
      });
    });
  });
}

/**
 * Decrypt a file with AES-256-GCM using streams.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} iv - hex
 * @param {string} tag - hex
 * @param {Buffer} key
 * @returns {Promise<void>}
 */
function decryptFile(inputPath, outputPath, iv, tag, key) {
  const fs = require('fs');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    input.on('error', reject);
    output.on('error', reject);
    decipher.on('error', reject);
    input.pipe(decipher).pipe(output);
    output.on('finish', resolve);
  });
}

/**
 * Zero out a buffer (secure memory cleanup).
 * @param {Buffer} buf
 */
function zeroBuffer(buf) {
  if (Buffer.isBuffer(buf)) {
    buf.fill(0);
  }
}

/**
 * Compute a deterministic sort key using HMAC-SHA256.
 * @param {string} plaintext
 * @param {Buffer} key - 32-byte key
 * @returns {string} hex-encoded HMAC
 */
function computeSortKey(plaintext, key) {
  return crypto.createHmac('sha256', key).update(plaintext).digest('hex');
}

module.exports = {
  encrypt,
  decrypt,
  deriveKey,
  generateVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  encryptFile,
  decryptFile,
  encryptFileSync,
  decryptFileSync,
  zeroBuffer,
  computeSortKey,
};
