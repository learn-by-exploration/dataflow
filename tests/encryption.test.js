'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Use low argon2 params for tests
process.env.NODE_ENV = 'test';

const {
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
} = require('../src/services/encryption');

describe('Encryption Service', () => {
  // ─── Encrypt / Decrypt round-trip ───
  it('encrypts and decrypts plaintext correctly', () => {
    const key = crypto.randomBytes(32);
    const plaintext = 'Hello, DataFlow!';
    const { ciphertext, iv, tag } = encrypt(plaintext, key);
    assert.ok(ciphertext);
    assert.ok(iv);
    assert.ok(tag);
    assert.notEqual(ciphertext, plaintext);
    const result = decrypt(ciphertext, iv, tag, key);
    assert.equal(result, plaintext);
  });

  it('encrypts empty string', () => {
    const key = crypto.randomBytes(32);
    const { ciphertext, iv, tag } = encrypt('', key);
    const result = decrypt(ciphertext, iv, tag, key);
    assert.equal(result, '');
  });

  it('encrypts unicode content', () => {
    const key = crypto.randomBytes(32);
    const plaintext = '日本語テスト 🔑 émojis 中文';
    const { ciphertext, iv, tag } = encrypt(plaintext, key);
    const result = decrypt(ciphertext, iv, tag, key);
    assert.equal(result, plaintext);
  });

  it('encrypts long content', () => {
    const key = crypto.randomBytes(32);
    const plaintext = 'x'.repeat(10000);
    const { ciphertext, iv, tag } = encrypt(plaintext, key);
    const result = decrypt(ciphertext, iv, tag, key);
    assert.equal(result, plaintext);
  });

  it('produces unique IVs for same plaintext', () => {
    const key = crypto.randomBytes(32);
    const r1 = encrypt('same', key);
    const r2 = encrypt('same', key);
    assert.notEqual(r1.iv, r2.iv);
    assert.notEqual(r1.ciphertext, r2.ciphertext);
  });

  // ─── Tamper detection ───
  it('detects tampered ciphertext', () => {
    const key = crypto.randomBytes(32);
    const { ciphertext, iv, tag } = encrypt('secret', key);
    // Flip a character in ciphertext
    const tampered = ciphertext.slice(0, -2) + 'ff';
    assert.throws(() => decrypt(tampered, iv, tag, key));
  });

  it('detects tampered IV', () => {
    const key = crypto.randomBytes(32);
    const { ciphertext, iv, tag } = encrypt('secret', key);
    const tampered = 'ff' + iv.slice(2);
    assert.throws(() => decrypt(ciphertext, tampered, tag, key));
  });

  it('detects tampered tag', () => {
    const key = crypto.randomBytes(32);
    const { ciphertext, iv, tag } = encrypt('secret', key);
    const tampered = tag.slice(0, -2) + 'ff';
    assert.throws(() => decrypt(ciphertext, iv, tampered, key));
  });

  it('rejects wrong key', () => {
    const key1 = crypto.randomBytes(32);
    const key2 = crypto.randomBytes(32);
    const { ciphertext, iv, tag } = encrypt('secret', key1);
    assert.throws(() => decrypt(ciphertext, iv, tag, key2));
  });

  // ─── Key derivation ───
  it('derives a 32-byte key from password', async () => {
    const salt = crypto.randomBytes(32);
    const key = await deriveKey('mypassword', salt, { memoryCost: 1024, timeCost: 1, parallelism: 1 });
    assert.ok(Buffer.isBuffer(key));
    assert.equal(key.length, 32);
  });

  it('derives same key for same inputs', async () => {
    const salt = crypto.randomBytes(32);
    const params = { memoryCost: 1024, timeCost: 1, parallelism: 1 };
    const k1 = await deriveKey('password', salt, params);
    const k2 = await deriveKey('password', salt, params);
    assert.deepEqual(k1, k2);
  });

  it('derives different keys for different passwords', async () => {
    const salt = crypto.randomBytes(32);
    const params = { memoryCost: 1024, timeCost: 1, parallelism: 1 };
    const k1 = await deriveKey('password1', salt, params);
    const k2 = await deriveKey('password2', salt, params);
    assert.notDeepEqual(k1, k2);
  });

  it('derives different keys for different salts', async () => {
    const params = { memoryCost: 1024, timeCost: 1, parallelism: 1 };
    const k1 = await deriveKey('password', crypto.randomBytes(32), params);
    const k2 = await deriveKey('password', crypto.randomBytes(32), params);
    assert.notDeepEqual(k1, k2);
  });

  // ─── Vault key generation ───
  it('generates a 32-byte vault key', () => {
    const key = generateVaultKey();
    assert.ok(Buffer.isBuffer(key));
    assert.equal(key.length, 32);
  });

  it('generates unique vault keys', () => {
    const k1 = generateVaultKey();
    const k2 = generateVaultKey();
    assert.notDeepEqual(k1, k2);
  });

  // ─── Vault key wrapping ───
  it('wraps and unwraps vault key', () => {
    const vaultKey = generateVaultKey();
    const derivedKey = crypto.randomBytes(32);
    const wrapped = wrapVaultKey(vaultKey, derivedKey);
    assert.ok(wrapped.ciphertext);
    assert.ok(wrapped.iv);
    assert.ok(wrapped.tag);
    const unwrapped = unwrapVaultKey(wrapped, derivedKey);
    assert.deepEqual(unwrapped, vaultKey);
  });

  it('rejects unwrap with wrong key', () => {
    const vaultKey = generateVaultKey();
    const k1 = crypto.randomBytes(32);
    const k2 = crypto.randomBytes(32);
    const wrapped = wrapVaultKey(vaultKey, k1);
    assert.throws(() => unwrapVaultKey(wrapped, k2));
  });

  // ─── Sort key computation ───
  it('computeSortKey is deterministic (same title + same key = same hash)', () => {
    const key = crypto.randomBytes(32);
    const h1 = computeSortKey('My Title', key);
    const h2 = computeSortKey('My Title', key);
    assert.equal(h1, h2);
  });

  it('computeSortKey differs for different titles', () => {
    const key = crypto.randomBytes(32);
    const h1 = computeSortKey('Alpha', key);
    const h2 = computeSortKey('Beta', key);
    assert.notEqual(h1, h2);
  });

  it('computeSortKey differs for different keys', () => {
    const k1 = crypto.randomBytes(32);
    const k2 = crypto.randomBytes(32);
    const h1 = computeSortKey('Same Title', k1);
    const h2 = computeSortKey('Same Title', k2);
    assert.notEqual(h1, h2);
  });

  it('computeSortKey returns hex string', () => {
    const key = crypto.randomBytes(32);
    const h = computeSortKey('test', key);
    assert.match(h, /^[a-f0-9]{64}$/);
  });

  // ─── File encryption (sync, legacy) ───
  describe('File encryption (sync)', () => {
    let tmpDir;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-enc-test-'));
    });

    after(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('encrypts and decrypts a file', () => {
      const key = crypto.randomBytes(32);
      const inputPath = path.join(tmpDir, 'input.txt');
      const encPath = path.join(tmpDir, 'input.enc');
      const outPath = path.join(tmpDir, 'output.txt');

      fs.writeFileSync(inputPath, 'File content for encryption test');
      const { iv, tag } = encryptFileSync(inputPath, encPath, key);
      assert.ok(iv);
      assert.ok(tag);

      // Encrypted file should differ from input
      const encData = fs.readFileSync(encPath);
      const origData = fs.readFileSync(inputPath);
      assert.notDeepEqual(encData, origData);

      decryptFileSync(encPath, outPath, iv, tag, key);
      const result = fs.readFileSync(outPath, 'utf8');
      assert.equal(result, 'File content for encryption test');
    });

    it('detects tampered encrypted file', () => {
      const key = crypto.randomBytes(32);
      const inputPath = path.join(tmpDir, 'tamper-in.txt');
      const encPath = path.join(tmpDir, 'tamper.enc');
      const outPath = path.join(tmpDir, 'tamper-out.txt');

      fs.writeFileSync(inputPath, 'sensitive data');
      const { iv, tag } = encryptFileSync(inputPath, encPath, key);

      // Tamper with encrypted file
      const data = fs.readFileSync(encPath);
      data[0] = data[0] ^ 0xff;
      fs.writeFileSync(encPath, data);

      assert.throws(() => decryptFileSync(encPath, outPath, iv, tag, key));
    });

    it('encrypts binary file', () => {
      const key = crypto.randomBytes(32);
      const inputPath = path.join(tmpDir, 'binary.bin');
      const encPath = path.join(tmpDir, 'binary.enc');
      const outPath = path.join(tmpDir, 'binary-out.bin');

      const binaryData = crypto.randomBytes(1024);
      fs.writeFileSync(inputPath, binaryData);
      const { iv, tag } = encryptFileSync(inputPath, encPath, key);
      decryptFileSync(encPath, outPath, iv, tag, key);
      const result = fs.readFileSync(outPath);
      assert.deepEqual(result, binaryData);
    });
  });

  // ─── File encryption (streaming) ───
  describe('File encryption (streaming)', () => {
    let tmpDir;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-enc-stream-'));
    });

    after(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('streaming encrypt → decrypt round-trip produces identical content', async () => {
      const key = crypto.randomBytes(32);
      const inputPath = path.join(tmpDir, 'stream-in.txt');
      const encPath = path.join(tmpDir, 'stream.enc');
      const outPath = path.join(tmpDir, 'stream-out.txt');

      fs.writeFileSync(inputPath, 'Streaming encryption test content');
      const { iv, tag } = await encryptFile(inputPath, encPath, key);
      assert.ok(iv);
      assert.ok(tag);

      await decryptFile(encPath, outPath, iv, tag, key);
      const result = fs.readFileSync(outPath, 'utf8');
      assert.equal(result, 'Streaming encryption test content');
    });

    it('streams 1MB file without issues', async () => {
      const key = crypto.randomBytes(32);
      const inputPath = path.join(tmpDir, 'large-in.bin');
      const encPath = path.join(tmpDir, 'large.enc');
      const outPath = path.join(tmpDir, 'large-out.bin');

      const largeData = crypto.randomBytes(1024 * 1024); // 1MB
      fs.writeFileSync(inputPath, largeData);
      const { iv, tag } = await encryptFile(inputPath, encPath, key);
      await decryptFile(encPath, outPath, iv, tag, key);
      const result = fs.readFileSync(outPath);
      assert.deepEqual(result, largeData);
    });

    it('encrypted file is not identical to original', async () => {
      const key = crypto.randomBytes(32);
      const inputPath = path.join(tmpDir, 'diff-in.txt');
      const encPath = path.join(tmpDir, 'diff.enc');

      fs.writeFileSync(inputPath, 'plaintext data for comparison');
      await encryptFile(inputPath, encPath, key);

      const origData = fs.readFileSync(inputPath);
      const encData = fs.readFileSync(encPath);
      assert.notDeepEqual(encData, origData);
    });

    it('tampered encrypted file fails decryption (auth tag mismatch)', async () => {
      const key = crypto.randomBytes(32);
      const inputPath = path.join(tmpDir, 'tamper-stream-in.txt');
      const encPath = path.join(tmpDir, 'tamper-stream.enc');
      const outPath = path.join(tmpDir, 'tamper-stream-out.txt');

      fs.writeFileSync(inputPath, 'Integrity check data');
      const { iv, tag } = await encryptFile(inputPath, encPath, key);

      // Tamper with encrypted file
      const data = fs.readFileSync(encPath);
      data[0] = data[0] ^ 0xff;
      fs.writeFileSync(encPath, data);

      await assert.rejects(() => decryptFile(encPath, outPath, iv, tag, key));
    });
  });

  // ─── Buffer zeroing ───
  it('zeros a buffer', () => {
    const buf = Buffer.from('sensitive data in memory');
    zeroBuffer(buf);
    assert.ok(buf.every(b => b === 0), 'Buffer should be all zeros');
  });

  it('handles non-buffer input gracefully', () => {
    assert.doesNotThrow(() => zeroBuffer(null));
    assert.doesNotThrow(() => zeroBuffer(undefined));
    assert.doesNotThrow(() => zeroBuffer('string'));
  });

  // ─── Integration: full key derivation + wrap/unwrap flow ───
  it('full flow: derive key, wrap vault key, unwrap with same password', async () => {
    const password = 'MyMasterPassword!123';
    const salt = crypto.randomBytes(32);
    const params = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

    const derivedKey = await deriveKey(password, salt, params);
    const vaultKey = generateVaultKey();
    const wrapped = wrapVaultKey(vaultKey, derivedKey);
    zeroBuffer(derivedKey);

    // Re-derive with same password
    const derivedKey2 = await deriveKey(password, salt, params);
    const unwrapped = unwrapVaultKey(wrapped, derivedKey2);
    assert.deepEqual(unwrapped, vaultKey);
    zeroBuffer(derivedKey2);
  });

  it('full flow: wrong password fails unwrap', async () => {
    const salt = crypto.randomBytes(32);
    const params = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

    const derivedKey = await deriveKey('correct_password', salt, params);
    const vaultKey = generateVaultKey();
    const wrapped = wrapVaultKey(vaultKey, derivedKey);
    zeroBuffer(derivedKey);

    const wrongKey = await deriveKey('wrong_password', salt, params);
    assert.throws(() => unwrapVaultKey(wrapped, wrongKey));
    zeroBuffer(wrongKey);
  });
});
