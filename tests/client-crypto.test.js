'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const clientCrypto = require('../public/js/crypto');

describe('Client Crypto Module', () => {
  // ─── #21: Core crypto functions ───

  describe('deriveKey', () => {
    it('produces a 32-byte key', async () => {
      const salt = clientCrypto.generateSalt();
      const key = await clientCrypto.deriveKey('password123', salt, 1000);
      assert.equal(key.length, 32);
    });

    it('produces consistent output for same inputs', async () => {
      const salt = clientCrypto.generateSalt();
      const key1 = await clientCrypto.deriveKey('password', salt, 1000);
      const key2 = await clientCrypto.deriveKey('password', salt, 1000);
      assert.deepEqual(key1, key2);
    });

    it('produces different output for different passwords', async () => {
      const salt = clientCrypto.generateSalt();
      const key1 = await clientCrypto.deriveKey('password1', salt, 1000);
      const key2 = await clientCrypto.deriveKey('password2', salt, 1000);
      assert.notDeepEqual(key1, key2);
    });

    it('produces different output for different salts', async () => {
      const salt1 = clientCrypto.generateSalt();
      const salt2 = clientCrypto.generateSalt();
      const key1 = await clientCrypto.deriveKey('password', salt1, 1000);
      const key2 = await clientCrypto.deriveKey('password', salt2, 1000);
      assert.notDeepEqual(key1, key2);
    });
  });

  describe('generateSalt', () => {
    it('returns 64-char hex string (32 bytes)', () => {
      const salt = clientCrypto.generateSalt();
      assert.equal(salt.length, 64);
      assert.match(salt, /^[0-9a-f]{64}$/);
    });

    it('produces unique values', () => {
      const s1 = clientCrypto.generateSalt();
      const s2 = clientCrypto.generateSalt();
      assert.notEqual(s1, s2);
    });
  });

  describe('generateIV', () => {
    it('returns 24-char hex string (12 bytes)', () => {
      const iv = clientCrypto.generateIV();
      assert.equal(iv.length, 24);
      assert.match(iv, /^[0-9a-f]{24}$/);
    });
  });

  describe('encrypt / decrypt', () => {
    it('round-trips plaintext correctly', () => {
      const key = crypto.randomBytes(32);
      const plaintext = 'Hello, DataFlow!';
      const { ciphertext, iv, tag } = clientCrypto.encrypt(plaintext, key);
      assert.ok(ciphertext);
      assert.ok(iv);
      assert.ok(tag);
      const result = clientCrypto.decrypt(ciphertext, iv, tag, key);
      assert.equal(result, plaintext);
    });

    it('round-trips empty string', () => {
      const key = crypto.randomBytes(32);
      const { ciphertext, iv, tag } = clientCrypto.encrypt('', key);
      assert.equal(clientCrypto.decrypt(ciphertext, iv, tag, key), '');
    });

    it('round-trips unicode content', () => {
      const key = crypto.randomBytes(32);
      const plaintext = '日本語テスト 🔑 émojis 中文';
      const { ciphertext, iv, tag } = clientCrypto.encrypt(plaintext, key);
      assert.equal(clientCrypto.decrypt(ciphertext, iv, tag, key), plaintext);
    });

    it('fails with wrong key', () => {
      const key1 = crypto.randomBytes(32);
      const key2 = crypto.randomBytes(32);
      const { ciphertext, iv, tag } = clientCrypto.encrypt('secret', key1);
      assert.throws(() => clientCrypto.decrypt(ciphertext, iv, tag, key2));
    });

    it('fails with tampered ciphertext', () => {
      const key = crypto.randomBytes(32);
      const { ciphertext, iv, tag } = clientCrypto.encrypt('secret', key);
      const tampered = ciphertext.slice(0, -2) + 'ff';
      assert.throws(() => clientCrypto.decrypt(tampered, iv, tag, key));
    });

    it('fails with tampered tag', () => {
      const key = crypto.randomBytes(32);
      const { ciphertext, iv, tag } = clientCrypto.encrypt('secret', key);
      const tampered = tag.slice(0, -2) + 'ff';
      assert.throws(() => clientCrypto.decrypt(ciphertext, iv, tampered, key));
    });

    it('produces unique IVs for same plaintext', () => {
      const key = crypto.randomBytes(32);
      const r1 = clientCrypto.encrypt('same', key);
      const r2 = clientCrypto.encrypt('same', key);
      assert.notEqual(r1.iv, r2.iv);
    });

    it('output format is hex strings', () => {
      const key = crypto.randomBytes(32);
      const { ciphertext, iv, tag } = clientCrypto.encrypt('test', key);
      assert.match(ciphertext, /^[0-9a-f]+$/);
      assert.match(iv, /^[0-9a-f]{24}$/);
      assert.match(tag, /^[0-9a-f]{32}$/);
    });
  });

  // ─── #22: Server-side crypto format compatibility ───

  describe('Cross-compatibility with server crypto', () => {
    const serverCrypto = require('../src/services/encryption');

    it('client-encrypted data decrypts with server module', () => {
      const key = crypto.randomBytes(32);
      const plaintext = 'Cross-compat test';
      const { ciphertext, iv, tag } = clientCrypto.encrypt(plaintext, key);
      const result = serverCrypto.decrypt(ciphertext, iv, tag, key);
      assert.equal(result, plaintext);
    });

    it('server-encrypted data decrypts with client module', () => {
      const key = crypto.randomBytes(32);
      const plaintext = 'Server-to-client';
      const { ciphertext, iv, tag } = serverCrypto.encrypt(plaintext, key);
      const result = clientCrypto.decrypt(ciphertext, iv, tag, key);
      assert.equal(result, plaintext);
    });

    it('format match: both produce hex ciphertext, iv, tag', () => {
      const key = crypto.randomBytes(32);
      const clientEnc = clientCrypto.encrypt('format test', key);
      const serverEnc = serverCrypto.encrypt('format test', key);

      // Both have same format: hex strings
      assert.match(clientEnc.ciphertext, /^[0-9a-f]+$/);
      assert.match(serverEnc.ciphertext, /^[0-9a-f]+$/);
      assert.equal(clientEnc.iv.length, serverEnc.iv.length); // 24 hex chars (12 bytes)
      assert.equal(clientEnc.tag.length, serverEnc.tag.length); // 32 hex chars (16 bytes)
    });

    it('cross-compat with unicode data', () => {
      const key = crypto.randomBytes(32);
      const text = '🔐 Ünîcödé crøss-cömpat ✅';
      const clientEnc = clientCrypto.encrypt(text, key);
      assert.equal(serverCrypto.decrypt(clientEnc.ciphertext, clientEnc.iv, clientEnc.tag, key), text);
      const serverEnc = serverCrypto.encrypt(text, key);
      assert.equal(clientCrypto.decrypt(serverEnc.ciphertext, serverEnc.iv, serverEnc.tag, key), text);
    });

    it('cross-compat with empty string', () => {
      const key = crypto.randomBytes(32);
      const clientEnc = clientCrypto.encrypt('', key);
      assert.equal(serverCrypto.decrypt(clientEnc.ciphertext, clientEnc.iv, clientEnc.tag, key), '');
    });

    it('cross-compat with long content', () => {
      const key = crypto.randomBytes(32);
      const text = 'x'.repeat(10000);
      const clientEnc = clientCrypto.encrypt(text, key);
      assert.equal(serverCrypto.decrypt(clientEnc.ciphertext, clientEnc.iv, clientEnc.tag, key), text);
    });
  });

  // ─── #23: Key wrapping cross-compatibility ───

  describe('Vault Key Management', () => {
    it('generateVaultKey returns 32 bytes', () => {
      const vk = clientCrypto.generateVaultKey();
      assert.equal(vk.length, 32);
    });

    it('generateVaultKey produces unique values', () => {
      const vk1 = clientCrypto.generateVaultKey();
      const vk2 = clientCrypto.generateVaultKey();
      assert.notDeepEqual(vk1, vk2);
    });

    it('wrapVaultKey / unwrapVaultKey round-trip', () => {
      const derivedKey = crypto.randomBytes(32);
      const vaultKey = clientCrypto.generateVaultKey();
      const wrapped = clientCrypto.wrapVaultKey(vaultKey, derivedKey);
      assert.ok(wrapped.ciphertext);
      assert.ok(wrapped.iv);
      assert.ok(wrapped.tag);
      const unwrapped = clientCrypto.unwrapVaultKey(wrapped, derivedKey);
      assert.deepEqual(unwrapped, vaultKey);
    });

    it('unwrapVaultKey fails with wrong key', () => {
      const key1 = crypto.randomBytes(32);
      const key2 = crypto.randomBytes(32);
      const vaultKey = clientCrypto.generateVaultKey();
      const wrapped = clientCrypto.wrapVaultKey(vaultKey, key1);
      assert.throws(() => clientCrypto.unwrapVaultKey(wrapped, key2));
    });

    describe('Cross-compat with server key wrapping', () => {
      const serverCrypto = require('../src/services/encryption');

      it('client-wrapped key unwraps with server module', () => {
        const derivedKey = crypto.randomBytes(32);
        const vaultKey = clientCrypto.generateVaultKey();
        const wrapped = clientCrypto.wrapVaultKey(vaultKey, derivedKey);
        const unwrapped = serverCrypto.unwrapVaultKey(wrapped, derivedKey);
        assert.deepEqual(unwrapped, vaultKey);
      });

      it('server-wrapped key unwraps with client module', () => {
        const derivedKey = crypto.randomBytes(32);
        const vaultKey = serverCrypto.generateVaultKey();
        const wrapped = serverCrypto.wrapVaultKey(vaultKey, derivedKey);
        const unwrapped = clientCrypto.unwrapVaultKey(wrapped, derivedKey);
        assert.deepEqual(unwrapped, vaultKey);
      });

      it('full server-client vault key exchange works', () => {
        const derivedKey = crypto.randomBytes(32);

        // Server generates & wraps
        const serverVaultKey = serverCrypto.generateVaultKey();
        const serverWrapped = serverCrypto.wrapVaultKey(serverVaultKey, derivedKey);

        // Client unwraps & re-wraps
        const clientVaultKey = clientCrypto.unwrapVaultKey(serverWrapped, derivedKey);
        assert.deepEqual(clientVaultKey, serverVaultKey);

        const clientWrapped = clientCrypto.wrapVaultKey(clientVaultKey, derivedKey);

        // Server unwraps client-wrapped
        const finalKey = serverCrypto.unwrapVaultKey(clientWrapped, derivedKey);
        assert.deepEqual(finalKey, serverVaultKey);
      });

      it('cross-compat wrap preserves exact key bytes', () => {
        const derivedKey = crypto.randomBytes(32);
        const vaultKey = Buffer.from('a'.repeat(64), 'hex'); // known key
        const wrapped = clientCrypto.wrapVaultKey(vaultKey, derivedKey);
        const unwrapped = serverCrypto.unwrapVaultKey(wrapped, derivedKey);
        assert.deepEqual(unwrapped, vaultKey);
      });
    });
  });

  // ─── #28: File/Buffer encryption ───

  describe('Buffer Encryption', () => {
    it('encryptBuffer / decryptBuffer round-trip', () => {
      const key = crypto.randomBytes(32);
      const data = Buffer.from('Hello file content');
      const { encrypted, iv, tag } = clientCrypto.encryptBuffer(data, key);
      assert.ok(Buffer.isBuffer(encrypted));
      assert.notDeepEqual(encrypted, data);
      const result = clientCrypto.decryptBuffer(encrypted, iv, tag, key);
      assert.deepEqual(result, data);
    });

    it('round-trips a 1MB buffer', () => {
      const key = crypto.randomBytes(32);
      const data = crypto.randomBytes(1024 * 1024);
      const { encrypted, iv, tag } = clientCrypto.encryptBuffer(data, key);
      const result = clientCrypto.decryptBuffer(encrypted, iv, tag, key);
      assert.deepEqual(result, data);
    });

    it('round-trips empty buffer', () => {
      const key = crypto.randomBytes(32);
      const data = Buffer.alloc(0);
      const { encrypted, iv, tag } = clientCrypto.encryptBuffer(data, key);
      const result = clientCrypto.decryptBuffer(encrypted, iv, tag, key);
      assert.deepEqual(result, data);
    });

    it('fails with wrong key', () => {
      const key1 = crypto.randomBytes(32);
      const key2 = crypto.randomBytes(32);
      const data = Buffer.from('secret file');
      const { encrypted, iv, tag } = clientCrypto.encryptBuffer(data, key1);
      assert.throws(() => clientCrypto.decryptBuffer(encrypted, iv, tag, key2));
    });

    it('returns hex iv and tag', () => {
      const key = crypto.randomBytes(32);
      const { iv, tag } = clientCrypto.encryptBuffer(Buffer.from('test'), key);
      assert.match(iv, /^[0-9a-f]{24}$/);
      assert.match(tag, /^[0-9a-f]{32}$/);
    });

    it('handles binary data with all byte values', () => {
      const key = crypto.randomBytes(32);
      const data = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      const { encrypted, iv, tag } = clientCrypto.encryptBuffer(data, key);
      const result = clientCrypto.decryptBuffer(encrypted, iv, tag, key);
      assert.deepEqual(result, data);
    });
  });
});
