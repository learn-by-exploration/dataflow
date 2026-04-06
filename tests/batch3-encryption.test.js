'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, getVaultKey } = require('./helpers');

describe('Batch 3: Client-Side Encryption Features', () => {
  let app, db, user, api;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  beforeEach(async () => {
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
    api = authRequest(app, user.sid);
  });

  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  async function createCategoryAndRT() {
    const catRes = await api.post('/api/categories').send({ name: 'Test Cat' }).expect(201);
    const rt = getBuiltinRT();
    return { category_id: catRes.body.id, record_type_id: rt.id };
  }

  // ─── #24: Encryption mode flag ───

  describe('#24: Encryption mode column', () => {
    it('migration adds encryption_mode column', () => {
      const cols = db.pragma('table_info(users)').map(c => c.name);
      assert.ok(cols.includes('encryption_mode'));
    });

    it('new users default to server mode', () => {
      const row = db.prepare('SELECT encryption_mode FROM users WHERE id = ?').get(user.id);
      assert.equal(row.encryption_mode, 'server');
    });

    it('encryption_mode accepts client value', () => {
      db.prepare('UPDATE users SET encryption_mode = ? WHERE id = ?').run('client', user.id);
      const row = db.prepare('SELECT encryption_mode FROM users WHERE id = ?').get(user.id);
      assert.equal(row.encryption_mode, 'client');
    });

    it('encryption_mode rejects invalid values', () => {
      assert.throws(() => {
        db.prepare('UPDATE users SET encryption_mode = ? WHERE id = ?').run('invalid', user.id);
      });
    });
  });

  // ─── #25: Client-encrypt API support ───

  describe('#25: Client-encrypted items via API', () => {
    it('creates a client-encrypted item', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      const titleEnc = clientCrypto.encrypt('Client Secret Title', vaultKey);
      const notesEnc = clientCrypto.encrypt('Client Secret Note', vaultKey);

      const res = await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
        notes_encrypted: notesEnc,
      }).expect(201);

      assert.ok(res.body.id);
      assert.equal(res.body.client_encrypted, 1);
    });

    it('retrieves a client-encrypted item without server decryption', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      const titleEnc = clientCrypto.encrypt('Encrypted Title', vaultKey);

      const createRes = await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      const getRes = await api.get(`/api/items/${createRes.body.id}`).expect(200);
      assert.equal(getRes.body.client_encrypted, 1);
      // Title should not be decrypted (no title field set, only encrypted payload)
      assert.equal(getRes.body.title_encrypted, titleEnc.ciphertext);
    });

    it('server did not re-encrypt client-encrypted item', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      const titleEnc = clientCrypto.encrypt('No Double Encrypt', vaultKey);

      const res = await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      // Verify the exact ciphertext stored matches what we sent
      const raw = db.prepare('SELECT title_encrypted, title_iv, title_tag FROM items WHERE id = ?').get(res.body.id);
      assert.equal(raw.title_encrypted, titleEnc.ciphertext);
      assert.equal(raw.title_iv, titleEnc.iv);
      assert.equal(raw.title_tag, titleEnc.tag);
    });

    it('client_encrypted column defaults to 0 for server-encrypted items', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const res = await api.post('/api/items').send({
        title: 'Server Item',
        category_id,
        record_type_id,
      }).expect(201);

      const raw = db.prepare('SELECT client_encrypted FROM items WHERE id = ?').get(res.body.id);
      assert.equal(raw.client_encrypted, 0);
    });

    it('can update a client-encrypted item', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      const titleEnc = clientCrypto.encrypt('Original Title', vaultKey);
      const createRes = await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      const newTitleEnc = clientCrypto.encrypt('Updated Title', vaultKey);
      await api.put(`/api/items/${createRes.body.id}`).send({
        encrypted: true,
        title_encrypted: newTitleEnc,
      }).expect(200);

      const raw = db.prepare('SELECT title_encrypted FROM items WHERE id = ?').get(createRes.body.id);
      assert.equal(raw.title_encrypted, newTitleEnc.ciphertext);
    });

    it('can create item with client-encrypted fields', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      const titleEnc = clientCrypto.encrypt('With Fields', vaultKey);
      const fieldEnc = clientCrypto.encrypt('secret-value', vaultKey);

      const res = await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
        fields: [{
          field_def_id: null,
          value_encrypted: fieldEnc.ciphertext,
          value_iv: fieldEnc.iv,
          value_tag: fieldEnc.tag,
        }],
      }).expect(201);

      assert.ok(res.body.id);
    });

    it('GET /api/items returns client_encrypted flag in list', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      // Create one server-encrypted and one client-encrypted
      await api.post('/api/items').send({
        title: 'Server Item',
        category_id,
        record_type_id,
      }).expect(201);

      const titleEnc = clientCrypto.encrypt('Client Item', vaultKey);
      await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      const res = await api.get('/api/items').expect(200);
      const serverItem = res.body.find(i => i.title === 'Server Item');
      const clientItem = res.body.find(i => i.client_encrypted === 1);
      assert.ok(serverItem);
      assert.ok(clientItem);
    });

    it('mixed client/server items coexist correctly', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      // Server-encrypted
      await api.post('/api/items').send({
        title: 'Server Item',
        category_id,
        record_type_id,
      }).expect(201);

      // Client-encrypted
      const titleEnc = clientCrypto.encrypt('Client Item', vaultKey);
      await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      const res = await api.get('/api/items').expect(200);
      assert.equal(res.body.length, 2);
    });

    it('count endpoint works with client-encrypted items', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      const titleEnc = clientCrypto.encrypt('Counted', vaultKey);
      await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      const res = await api.get('/api/items/count').expect(200);
      assert.equal(res.body.count, 1);
    });
  });

  // ─── #26: Data migration endpoint ───

  describe('#26: POST /api/data/migrate-encryption', () => {
    it('returns all server-encrypted items decrypted', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({
        title: 'Migration Item 1',
        category_id,
        record_type_id,
      }).expect(201);
      await api.post('/api/items').send({
        title: 'Migration Item 2',
        notes: 'Some notes',
        category_id,
        record_type_id,
      }).expect(201);

      const res = await api.post('/api/data/migrate-encryption').expect(200);
      assert.equal(res.body.total, 2);
      assert.equal(res.body.items.length, 2);
      // Items should be decrypted (plaintext)
      const titles = res.body.items.map(i => i.title).sort();
      assert.deepEqual(titles, ['Migration Item 1', 'Migration Item 2']);
    });

    it('excludes client-encrypted items from migration', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      await api.post('/api/items').send({
        title: 'Server Item',
        category_id,
        record_type_id,
      }).expect(201);

      const titleEnc = clientCrypto.encrypt('Client Item', vaultKey);
      await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      const res = await api.post('/api/data/migrate-encryption').expect(200);
      assert.equal(res.body.total, 1);
      assert.equal(res.body.items[0].title, 'Server Item');
    });

    it('tracks migration progress in settings', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({
        title: 'Item',
        category_id,
        record_type_id,
      }).expect(201);

      await api.post('/api/data/migrate-encryption').expect(200);

      const setting = db.prepare(
        "SELECT value FROM settings WHERE user_id = ? AND key = 'encryption_migration_progress'"
      ).get(user.id);
      assert.ok(setting);
      const progress = JSON.parse(setting.value);
      assert.equal(progress.total, 1);
      assert.equal(progress.status, 'in_progress');
      assert.ok(progress.started_at);
    });

    it('requires vault key', async () => {
      // Use a fresh user that's logged out
      const user2 = await makeUser(app, { email: 'miguser@test.com' });
      const api2 = authRequest(app, 'invalidsession');
      const res = await api2.post('/api/data/migrate-encryption').expect(401);
      assert.ok(res.body.error);
    });

    it('returns items with fields and metadata', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({
        title: 'Detailed Item',
        notes: 'Has notes',
        category_id,
        record_type_id,
        favorite: true,
      }).expect(201);

      const res = await api.post('/api/data/migrate-encryption').expect(200);
      const item = res.body.items[0];
      assert.equal(item.title, 'Detailed Item');
      assert.equal(item.notes, 'Has notes');
      assert.equal(item.favorite, true);
      assert.equal(item.category_id, category_id);
    });

    it('migration of empty vault returns no items', async () => {
      const res = await api.post('/api/data/migrate-encryption').expect(200);
      assert.equal(res.body.total, 0);
      assert.equal(res.body.items.length, 0);
    });

    it('items include id for client to PUT back', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const createRes = await api.post('/api/items').send({
        title: 'Track Me',
        category_id,
        record_type_id,
      }).expect(201);

      const res = await api.post('/api/data/migrate-encryption').expect(200);
      assert.equal(res.body.items[0].id, createRes.body.id);
    });

    it('full migration round-trip: get, re-encrypt, put back', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      await api.post('/api/items').send({
        title: 'Migrate Me',
        notes: 'Migrate notes',
        category_id,
        record_type_id,
      }).expect(201);

      // Get decrypted items for migration
      const migRes = await api.post('/api/data/migrate-encryption').expect(200);
      const itemToMigrate = migRes.body.items[0];

      // Client re-encrypts
      const titleEnc = clientCrypto.encrypt(itemToMigrate.title, vaultKey);
      const notesEnc = clientCrypto.encrypt(itemToMigrate.notes, vaultKey);

      // PUT back as client-encrypted
      await api.put(`/api/items/${itemToMigrate.id}`).send({
        encrypted: true,
        title_encrypted: titleEnc,
        notes_encrypted: notesEnc,
      }).expect(200);

      // Verify it's now client-encrypted
      const raw = db.prepare('SELECT client_encrypted, title_encrypted FROM items WHERE id = ?').get(itemToMigrate.id);
      assert.equal(raw.client_encrypted, 1);
      assert.equal(raw.title_encrypted, titleEnc.ciphertext);
    });
  });

  // ─── #27: User key pairs ───

  describe('#27: User key pairs', () => {
    it('migration adds public_key column', () => {
      const cols = db.pragma('table_info(users)').map(c => c.name);
      assert.ok(cols.includes('public_key'));
    });

    it('migration adds encrypted_private_key column', () => {
      const cols = db.pragma('table_info(users)').map(c => c.name);
      assert.ok(cols.includes('encrypted_private_key'));
    });

    it('key pair columns default to null', () => {
      const row = db.prepare('SELECT public_key, encrypted_private_key FROM users WHERE id = ?').get(user.id);
      assert.equal(row.public_key, null);
      assert.equal(row.encrypted_private_key, null);
    });

    it('can store and retrieve key pair via repository', () => {
      const createAuthRepo = require('../src/repositories/auth.repository');
      const authRepo = createAuthRepo(db);
      const vaultKey = getVaultKey(user.sid);
      const clientCrypto = require('../public/js/crypto');

      // Generate key pair
      const keyPair = crypto.generateKeyPairSync('x25519');
      const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
      const privateKeyDer = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
      const encPriv = clientCrypto.encrypt(privateKeyDer.toString('hex'), vaultKey);

      authRepo.updateKeyPair(user.id, {
        publicKey,
        encryptedPrivateKey: JSON.stringify(encPriv),
      });

      const pair = authRepo.getKeyPair(user.id);
      assert.equal(pair.public_key, publicKey);
      assert.ok(pair.encrypted_private_key);
    });

    it('encrypted private key can be decrypted with vault key', () => {
      const createAuthRepo = require('../src/repositories/auth.repository');
      const authRepo = createAuthRepo(db);
      const vaultKey = getVaultKey(user.sid);
      const clientCrypto = require('../public/js/crypto');

      const keyPair = crypto.generateKeyPairSync('x25519');
      const privateKeyDer = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
      const encPriv = clientCrypto.encrypt(privateKeyDer.toString('hex'), vaultKey);

      authRepo.updateKeyPair(user.id, {
        publicKey: 'test-pub-key',
        encryptedPrivateKey: JSON.stringify(encPriv),
      });

      const pair = authRepo.getKeyPair(user.id);
      const decrypted = clientCrypto.decrypt(
        encPriv.ciphertext, encPriv.iv, encPriv.tag, vaultKey
      );
      assert.equal(decrypted, privateKeyDer.toString('hex'));
    });

    it('wrong vault key cannot decrypt private key', () => {
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);
      const wrongKey = crypto.randomBytes(32);

      const privateKey = crypto.randomBytes(48).toString('hex');
      const encPriv = clientCrypto.encrypt(privateKey, vaultKey);

      assert.throws(() => {
        clientCrypto.decrypt(encPriv.ciphertext, encPriv.iv, encPriv.tag, wrongKey);
      });
    });

    it('each user has independent key pairs', async () => {
      const user2 = await makeUser(app, { email: 'keypair2@test.com' });
      const logged2 = await loginUser(app, user2);
      const createAuthRepo = require('../src/repositories/auth.repository');
      const authRepo = createAuthRepo(db);

      authRepo.updateKeyPair(user.id, { publicKey: 'pub1', encryptedPrivateKey: 'enc1' });
      authRepo.updateKeyPair(user2.id, { publicKey: 'pub2', encryptedPrivateKey: 'enc2' });

      const pair1 = authRepo.getKeyPair(user.id);
      const pair2 = authRepo.getKeyPair(user2.id);

      assert.equal(pair1.public_key, 'pub1');
      assert.equal(pair2.public_key, 'pub2');
    });

    it('encryption_mode can be updated', () => {
      const createAuthRepo = require('../src/repositories/auth.repository');
      const authRepo = createAuthRepo(db);

      assert.equal(authRepo.getEncryptionMode(user.id), 'server');
      authRepo.updateEncryptionMode(user.id, 'client');
      assert.equal(authRepo.getEncryptionMode(user.id), 'client');
    });

    it('key pair update does not affect other user fields', () => {
      const createAuthRepo = require('../src/repositories/auth.repository');
      const authRepo = createAuthRepo(db);

      const before = authRepo.findUserById(user.id);
      authRepo.updateKeyPair(user.id, { publicKey: 'new-pub', encryptedPrivateKey: 'new-enc' });
      const after = authRepo.findUserById(user.id);

      assert.equal(before.email, after.email);
      assert.equal(before.password_hash, after.password_hash);
      assert.equal(after.public_key, 'new-pub');
    });

    it('can generate and store X25519 key pair', () => {
      const keyPair = crypto.generateKeyPairSync('x25519');
      assert.ok(keyPair.publicKey);
      assert.ok(keyPair.privateKey);
      const pub = keyPair.publicKey.export({ type: 'spki', format: 'der' });
      const priv = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
      assert.ok(pub.length > 0);
      assert.ok(priv.length > 0);
    });
  });

  // ─── #29: Vault key rotation endpoint ───

  describe('#29: POST /api/auth/rotate-vault-key', () => {
    it('rotates vault key and re-encrypts items', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({
        title: 'Rotated Item 1',
        category_id,
        record_type_id,
      }).expect(201);
      await api.post('/api/items').send({
        title: 'Rotated Item 2',
        notes: 'With notes',
        category_id,
        record_type_id,
      }).expect(201);

      const res = await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewMasterPass123!',
      }).expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.items_rotated, 2);
    });

    it('items are still readable after rotation', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({
        title: 'Still Readable',
        category_id,
        record_type_id,
      }).expect(201);

      await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewMaster123!',
      }).expect(200);

      const res = await api.get('/api/items').expect(200);
      assert.equal(res.body[0].title, 'Still Readable');
    });

    it('old vault key no longer works after rotation', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const createRes = await api.post('/api/items').send({
        title: 'Old Key Test',
        category_id,
        record_type_id,
      }).expect(201);

      const oldVaultKey = Buffer.from(getVaultKey(user.sid));

      await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewMaster123!',
      }).expect(200);

      // Get the raw encrypted data
      const raw = db.prepare('SELECT title_encrypted, title_iv, title_tag FROM items WHERE id = ?').get(createRes.body.id);
      const serverCrypto = require('../src/services/encryption');

      // Old key should fail to decrypt
      assert.throws(() => {
        serverCrypto.decrypt(raw.title_encrypted, raw.title_iv, raw.title_tag, oldVaultKey);
      });
    });

    it('login with new master password works after rotation', async () => {
      await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'BrandNewMaster123!',
      }).expect(200);

      const loginRes = await loginUser(app, {
        email: user.email,
        password: user.password,
        master_password: 'BrandNewMaster123!',
      });
      assert.ok(loginRes.sid);
    });

    it('requires new_master_password', async () => {
      const res = await api.post('/api/auth/rotate-vault-key').send({}).expect(400);
      assert.ok(res.body.error);
    });

    it('records rotation date in settings', async () => {
      await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewMaster123!',
      }).expect(200);

      const setting = db.prepare(
        "SELECT value FROM settings WHERE user_id = ? AND key = 'last_vault_key_rotation'"
      ).get(user.id);
      assert.ok(setting);
      assert.ok(setting.value); // ISO date string
    });

    it('re-encrypts item fields during rotation', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const rtFields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ?').all(record_type_id);
      const fieldDef = rtFields[0];

      if (fieldDef) {
        await api.post('/api/items').send({
          title: 'With Fields',
          category_id,
          record_type_id,
          fields: [{ field_def_id: fieldDef.id, value: 'field-secret' }],
        }).expect(201);

        const oldVaultKey = Buffer.from(getVaultKey(user.sid));

        await api.post('/api/auth/rotate-vault-key').send({
          new_master_password: 'NewM123!',
        }).expect(200);

        // Item fields should still be readable
        const items = await api.get('/api/items').expect(200);
        const item = items.body.find(i => i.title === 'With Fields');
        assert.ok(item);
      }
    });

    it('skips client-encrypted items during rotation', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      // Create client-encrypted item
      const titleEnc = clientCrypto.encrypt('Client Item', vaultKey);
      await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      // Also create a server-encrypted item
      await api.post('/api/items').send({
        title: 'Server Item',
        category_id,
        record_type_id,
      }).expect(201);

      const res = await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewMaster123!',
      }).expect(200);

      // Only server items rotated
      assert.equal(res.body.items_rotated, 1);

      // Client-encrypted item's ciphertext unchanged
      const raw = db.prepare('SELECT title_encrypted FROM items WHERE client_encrypted = 1').get();
      assert.equal(raw.title_encrypted, titleEnc.ciphertext);
    });

    it('handles rotation with empty vault', async () => {
      const res = await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewMaster123!',
      }).expect(200);

      assert.equal(res.body.ok, true);
      assert.equal(res.body.items_rotated, 0);
    });

    it('multiple rotations work correctly', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({
        title: 'Multi Rotate',
        category_id,
        record_type_id,
      }).expect(201);

      // First rotation
      await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewPass1!',
      }).expect(200);

      // Second rotation
      await api.post('/api/auth/rotate-vault-key').send({
        new_master_password: 'NewPass2!',
      }).expect(200);

      // Item still readable
      const items = await api.get('/api/items').expect(200);
      assert.equal(items.body[0].title, 'Multi Rotate');
    });
  });

  // ─── #30: Encryption health check ───

  describe('#30: GET /api/stats/encryption-health', () => {
    it('returns encryption health stats', async () => {
      const res = await api.get('/api/stats/encryption-health').expect(200);
      assert.ok('total' in res.body);
      assert.ok('server_encrypted' in res.body);
      assert.ok('client_encrypted' in res.body);
      assert.ok('unencrypted' in res.body);
      assert.ok('last_rotation_date' in res.body);
    });

    it('counts server-encrypted items correctly', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({
        title: 'Enc1',
        category_id,
        record_type_id,
      }).expect(201);
      await api.post('/api/items').send({
        title: 'Enc2',
        category_id,
        record_type_id,
      }).expect(201);

      const res = await api.get('/api/stats/encryption-health').expect(200);
      assert.equal(res.body.total, 2);
      assert.equal(res.body.server_encrypted, 2);
      assert.equal(res.body.client_encrypted, 0);
    });

    it('counts client-encrypted items correctly', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const clientCrypto = require('../public/js/crypto');
      const vaultKey = getVaultKey(user.sid);

      const titleEnc = clientCrypto.encrypt('Client', vaultKey);
      await api.post('/api/items').send({
        category_id,
        record_type_id,
        encrypted: true,
        title_encrypted: titleEnc,
      }).expect(201);

      await api.post('/api/items').send({
        title: 'Server',
        category_id,
        record_type_id,
      }).expect(201);

      const res = await api.get('/api/stats/encryption-health').expect(200);
      assert.equal(res.body.total, 2);
      assert.equal(res.body.server_encrypted, 1);
      assert.equal(res.body.client_encrypted, 1);
    });

    it('returns last rotation date when available', async () => {
      db.prepare(
        "INSERT INTO settings (user_id, key, value) VALUES (?, 'last_vault_key_rotation', ?)"
      ).run(user.id, '2026-04-06T00:00:00.000Z');

      const res = await api.get('/api/stats/encryption-health').expect(200);
      assert.equal(res.body.last_rotation_date, '2026-04-06T00:00:00.000Z');
    });
  });
});
