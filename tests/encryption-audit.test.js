'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, getVaultKey } = require('./helpers');
const { encrypt, decrypt, generateVaultKey } = require('../src/services/encryption');

async function makeLoggedInUser(app, overrides = {}) {
  const user = await makeUser(app, overrides);
  const logged = await loginUser(app, user);
  return { ...user, sid: logged.sid };
}

describe('Encryption Audit', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  async function createItemDirect() {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'Secrets' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;

    // Get actual field definitions for this record type
    const rt = await api.get(`/api/record-types/${rtId}`).expect(200);
    const fieldDefs = rt.body.fields || [];

    const plainTitle = 'My Super Secret Password Title';
    const itemPayload = {
      title: plainTitle,
      category_id: cat.body.id,
      record_type_id: rtId,
    };
    // Add fields if the record type has field definitions
    if (fieldDefs.length > 0) {
      itemPayload.fields = [{ field_def_id: fieldDefs[0].id, value: 'mysecretvalue123' }];
    }
    const item = await api.post('/api/items').send(itemPayload).expect(201);

    return { user, api, item: item.body, plainTitle, catId: cat.body.id, rtId, fieldDefs };
  }

  // ─── Encrypted storage verification ───
  describe('Data at rest encryption', () => {
    it('title_encrypted column does NOT contain plaintext title', async () => {
      const { plainTitle, item } = await createItemDirect();
      const row = db.prepare('SELECT title_encrypted FROM items WHERE id = ?').get(item.id);
      assert.ok(row.title_encrypted, 'title_encrypted should exist');
      assert.ok(!row.title_encrypted.includes(plainTitle), 'Encrypted column should NOT contain plaintext');
    });

    it('item_fields value_encrypted does NOT contain plaintext', async () => {
      const { item } = await createItemDirect();
      const fields = db.prepare('SELECT value_encrypted FROM item_fields WHERE item_id = ?').all(item.id);
      for (const field of fields) {
        if (field.value_encrypted) {
          assert.ok(!field.value_encrypted.includes('mysecretvalue123'), 'Field value should be encrypted');
        }
      }
    });

    it('encrypted values are hex-encoded', async () => {
      const { item } = await createItemDirect();
      const row = db.prepare('SELECT title_encrypted, title_iv, title_tag FROM items WHERE id = ?').get(item.id);
      assert.match(row.title_encrypted, /^[0-9a-f]+$/i, 'Ciphertext should be hex');
      assert.match(row.title_iv, /^[0-9a-f]+$/i, 'IV should be hex');
      assert.match(row.title_tag, /^[0-9a-f]+$/i, 'Tag should be hex');
    });
  });

  // ─── IV uniqueness ───
  describe('IV uniqueness', () => {
    it('each item has unique IVs (no IV reuse)', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const cat = await api.post('/api/categories').send({ name: 'Test' }).expect(201);
      const types = await api.get('/api/record-types').expect(200);
      const rtId = types.body[0]?.id || 1;

      // Create multiple items
      const ivs = new Set();
      for (let i = 0; i < 5; i++) {
        await api.post('/api/items').send({
          title: `Item ${i}`,
          category_id: cat.body.id,
          record_type_id: rtId,
        }).expect(201);
      }

      const rows = db.prepare('SELECT title_iv FROM items WHERE user_id = ?').all(user.id);
      for (const row of rows) {
        assert.ok(!ivs.has(row.title_iv), `IV should be unique, found duplicate: ${row.title_iv}`);
        ivs.add(row.title_iv);
      }
      assert.equal(ivs.size, rows.length, 'All IVs should be unique');
    });
  });

  // ─── Decryption with wrong key ───
  describe('Wrong key decryption', () => {
    it('decryption with wrong key fails', () => {
      const correctKey = generateVaultKey();
      const wrongKey = generateVaultKey();
      const encrypted = encrypt('sensitive data', correctKey);

      assert.throws(() => {
        decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag, wrongKey);
      }, 'Decryption with wrong key should throw');
    });

    it('decryption with tampered ciphertext is detected', () => {
      const key = generateVaultKey();
      const encrypted = encrypt('test data', key);

      // Tamper with ciphertext
      const tampered = encrypted.ciphertext.slice(0, -4) + 'ffff';
      assert.throws(() => {
        decrypt(tampered, encrypted.iv, encrypted.tag, key);
      }, 'Tampered ciphertext should be detected');
    });

    it('decryption with tampered tag fails', () => {
      const key = generateVaultKey();
      const encrypted = encrypt('test data', key);

      // Tamper with auth tag
      const tamperedTag = encrypted.tag.slice(0, -4) + 'abcd';
      assert.throws(() => {
        decrypt(encrypted.ciphertext, encrypted.iv, tamperedTag, key);
      }, 'Tampered auth tag should be detected');
    });
  });

  // ─── Vault key not stored in plaintext ───
  describe('Vault key storage', () => {
    it('vault key is not stored in plaintext in DB', async () => {
      const user = await makeLoggedInUser(app);
      const vaultKey = getVaultKey(user.sid);
      const vaultKeyHex = vaultKey.toString('hex');

      // Check users table
      const row = db.prepare('SELECT vault_key_encrypted, master_key_salt FROM users WHERE id = ?').get(user.id);
      assert.ok(!row.vault_key_encrypted.includes(vaultKeyHex), 'vault_key_encrypted should not contain plaintext vault key');
      // vault_key_encrypted should be wrapped (JSON with ciphertext, iv, tag)
      const wrapped = JSON.parse(row.vault_key_encrypted);
      assert.ok(wrapped.ciphertext, 'Should have ciphertext');
      assert.ok(wrapped.iv, 'Should have iv');
      assert.ok(wrapped.tag, 'Should have tag');
    });

    it('master_key_salt is not the vault key', async () => {
      const user = await makeLoggedInUser(app);
      const vaultKey = getVaultKey(user.sid);
      const row = db.prepare('SELECT master_key_salt FROM users WHERE id = ?').get(user.id);
      assert.notEqual(row.master_key_salt, vaultKey.toString('hex'));
    });

    it('vault key is not stored in sessions table', async () => {
      const user = await makeLoggedInUser(app);
      const vaultKey = getVaultKey(user.sid);
      const vaultKeyHex = vaultKey.toString('hex');

      const session = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(user.sid);
      const sessionStr = JSON.stringify(session);
      assert.ok(!sessionStr.includes(vaultKeyHex), 'Session should not contain vault key');
    });

    it('vault key is not stored in any column of audit_log', async () => {
      const user = await makeLoggedInUser(app);
      const vaultKey = getVaultKey(user.sid);
      const vaultKeyHex = vaultKey.toString('hex');

      const logs = db.prepare('SELECT * FROM audit_log WHERE user_id = ?').all(user.id);
      for (const log of logs) {
        const logStr = JSON.stringify(log);
        assert.ok(!logStr.includes(vaultKeyHex), 'Audit log should not contain vault key');
      }
    });
  });

  // ─── Encrypt/decrypt round-trip ───
  describe('Encryption round-trip', () => {
    it('encrypt then decrypt returns original plaintext', () => {
      const key = generateVaultKey();
      const plaintext = 'Hello, World! 🔐 Special chars: <>&"\'';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag, key);
      assert.equal(decrypted, plaintext);
    });
  });
});
