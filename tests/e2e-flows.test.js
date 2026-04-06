'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, cleanDb, teardown } = require('./helpers');

describe('#90: E2E user journey flows', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
    cleanDb();
  });

  after(() => teardown());

  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  function resetDb() {
    db.exec('DELETE FROM item_tags'); db.exec('DELETE FROM item_fields');
    db.exec('DELETE FROM item_shares'); db.exec('DELETE FROM category_shares');
    try { db.exec('DELETE FROM item_history'); } catch { /* */ }
    db.exec('DELETE FROM item_attachments');
    db.exec('DELETE FROM items'); db.exec('DELETE FROM tags');
    db.exec('DELETE FROM categories'); db.exec('DELETE FROM emergency_access');
    db.exec('DELETE FROM audit_log'); db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM settings'); db.exec('DELETE FROM recovery_codes');
    db.exec('DELETE FROM login_attempts'); db.exec('DELETE FROM users');
    const sessionVault = require('../src/services/session-vault');
    sessionVault.clearAll();
  }

  async function registerAndAuth(email) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'TestPass123!', master_password: 'MasterPass123!', display_name: 'E2E User' })
      .expect(201);
    const sid = res.headers['set-cookie'].join('; ').match(/df_sid=([a-f0-9]{64})/)[1];
    return { id: res.body.id, sid, auth: `df_sid=${sid}` };
  }

  it('Flow 1: Register → Login → Create category → Create item → Search → Export → Logout', async () => {
    resetDb();
    const { auth } = await registerAndAuth('flow1@test.com');
    const rt = getBuiltinRT();

    const catRes = await request(app).post('/api/categories').set('Cookie', auth)
      .send({ name: 'Passwords', icon: '🔑', color: '#FF0000' }).expect(201);

    const itemRes = await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'Gmail Login', category_id: catRes.body.id, record_type_id: rt.id, fields: [], tags: [] }).expect(201);
    assert.ok(itemRes.body.id);

    const searchRes = await request(app).get('/api/items?search=Gmail').set('Cookie', auth).expect(200);
    const items = searchRes.body.data || searchRes.body;
    assert.ok(items.length >= 1);

    const exportRes = await request(app).get('/api/data/export').set('Cookie', auth).expect(200);
    assert.ok(exportRes.body.items);

    await request(app).post('/api/auth/logout').set('Cookie', auth).expect(200);
  });

  it('Flow 2: Register admin → Add member → View audit log', async () => {
    resetDb();
    const { auth } = await registerAndAuth('admin-flow2@test.com');

    const inviteRes = await request(app).post('/api/members/invite').set('Cookie', auth)
      .send({ email: 'member-flow2@test.com', password: 'TestPass123!', master_password: 'MasterPass123!', display_name: 'Member', role: 'adult' })
      .expect(201);
    assert.ok(inviteRes.body.id);

    const auditRes = await request(app).get('/api/audit').set('Cookie', auth).expect(200);
    assert.ok(auditRes.body.entries || auditRes.body.total !== undefined);
  });

  it('Flow 3: Generate recovery codes → Logout → Recover with code', async () => {
    resetDb();
    const { auth } = await registerAndAuth('recover@test.com');

    const codesRes = await request(app).post('/api/auth/recovery-codes/generate').set('Cookie', auth)
      .send({ password: 'TestPass123!' }).expect(200);
    assert.ok(codesRes.body.codes);
    const code = codesRes.body.codes[0];

    await request(app).post('/api/auth/logout').set('Cookie', auth).expect(200);

    const recoverRes = await request(app).post('/api/auth/recover')
      .send({ email: 'recover@test.com', recovery_code: code, new_password: 'NewPass456!', new_master_password: 'NewMasterPass456!' })
      .expect(200);
    assert.ok(recoverRes.body.ok);
  });

  it('Flow 4: Create item → Delete → View trash → Restore → Verify', async () => {
    resetDb();
    const { auth } = await registerAndAuth('trash@test.com');
    const rt = getBuiltinRT();

    const cat = await request(app).post('/api/categories').set('Cookie', auth).send({ name: 'Test' }).expect(201);

    const item = await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'To Delete', category_id: cat.body.id, record_type_id: rt.id, fields: [], tags: [] }).expect(201);

    await request(app).delete(`/api/items/${item.body.id}`).set('Cookie', auth).expect(204);

    const trashRes = await request(app).get('/api/items/trash').set('Cookie', auth).expect(200);
    const trashItems = trashRes.body.data || trashRes.body;
    assert.ok(trashItems.length >= 1);

    await request(app).post(`/api/items/${item.body.id}/restore`).set('Cookie', auth).expect(200);

    const verifyRes = await request(app).get(`/api/items/${item.body.id}`).set('Cookie', auth).expect(200);
    assert.ok(verifyRes.body.id === item.body.id);
  });

  it('Flow 5: Create category → Create tags → Create item with tags → List', async () => {
    resetDb();
    const { auth } = await registerAndAuth('tagflow@test.com');
    const rt = getBuiltinRT();

    const cat = await request(app).post('/api/categories').set('Cookie', auth).send({ name: 'Finance' }).expect(201);
    const tag = await request(app).post('/api/tags').set('Cookie', auth).send({ name: 'important', color: '#FF0000' }).expect(201);

    await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'Bank Account', category_id: cat.body.id, record_type_id: rt.id, tags: [tag.body.id], fields: [] }).expect(201);

    const listRes = await request(app).get('/api/items').set('Cookie', auth).expect(200);
    const items = listRes.body.data || listRes.body;
    assert.ok(items.length >= 1);

    const usageRes = await request(app).get('/api/tags/usage').set('Cookie', auth).expect(200);
    assert.ok(Array.isArray(usageRes.body));
  });

  it('Flow 6: Set settings → Get settings → Delete setting', async () => {
    resetDb();
    const { auth } = await registerAndAuth('settings@test.com');

    await request(app).put('/api/settings/theme').set('Cookie', auth).send({ value: 'dark' }).expect(200);
    const getRes = await request(app).get('/api/settings').set('Cookie', auth).expect(200);
    assert.ok(getRes.body);
    await request(app).delete('/api/settings/theme').set('Cookie', auth).expect(204);
  });

  it('Flow 7: Register → Check dashboard → Check security score', async () => {
    resetDb();
    const { auth } = await registerAndAuth('stats@test.com');

    const dashRes = await request(app).get('/api/stats/dashboard').set('Cookie', auth).expect(200);
    assert.equal(typeof dashRes.body.items, 'number');

    const scoreRes = await request(app).get('/api/stats/security-score').set('Cookie', auth).expect(200);
    assert.ok(scoreRes.body);
  });

  it('Flow 8: Health check → Metrics → Detailed health (auth)', async () => {
    const healthRes = await request(app).get('/api/health').expect(200);
    assert.equal(healthRes.body.status, 'ok');

    const metricsRes = await request(app).get('/api/metrics').expect(200);
    assert.ok(metricsRes.text.includes('http_requests_total'));

    resetDb();
    const { auth } = await registerAndAuth('healthflow@test.com');

    const detailRes = await request(app).get('/api/health?detail=true').set('Cookie', auth).expect(200);
    assert.ok(detailRes.body.db);
    assert.equal(detailRes.body.db.connected, true);
  });

  it('Flow 9: Generate password → Generate passphrase', async () => {
    resetDb();
    const { auth } = await registerAndAuth('pwgen@test.com');

    const pwRes = await request(app).post('/api/generate-password').set('Cookie', auth).send({ length: 20 }).expect(200);
    assert.ok(pwRes.body.password);

    const ppRes = await request(app).post('/api/generate-passphrase').set('Cookie', auth).send({ words: 4 }).expect(200);
    assert.ok(ppRes.body.passphrase);
  });

  it('Flow 10: Create items → Favorite → Verify', async () => {
    resetDb();
    const { auth } = await registerAndAuth('favs@test.com');
    const rt = getBuiltinRT();

    const cat = await request(app).post('/api/categories').set('Cookie', auth).send({ name: 'General' }).expect(201);
    const item1 = await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'Item 1', category_id: cat.body.id, record_type_id: rt.id, fields: [], tags: [] }).expect(201);

    await request(app).post(`/api/items/${item1.body.id}/favorite`).set('Cookie', auth).expect(200);

    const getRes = await request(app).get(`/api/items/${item1.body.id}`).set('Cookie', auth).expect(200);
    assert.ok(getRes.body.favorite === 1 || getRes.body.favorite === true);
  });

  it('Flow 11: Create data → Backup → List backups', async () => {
    resetDb();
    const { auth } = await registerAndAuth('backup@test.com');
    const rt = getBuiltinRT();

    const cat = await request(app).post('/api/categories').set('Cookie', auth).send({ name: 'Vault' }).expect(201);
    await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'Important Data', category_id: cat.body.id, record_type_id: rt.id, fields: [], tags: [] }).expect(201);

    const backupRes = await request(app).post('/api/data/backup').set('Cookie', auth).expect(200);
    assert.ok(backupRes.body.path);

    const listRes = await request(app).get('/api/data/backups').set('Cookie', auth).expect(200);
    assert.ok(listRes.body.length >= 1);
  });

  it('Flow 12: Login multiple times → List sessions → Revoke one', async () => {
    resetDb();
    const { sid: sid1 } = await registerAndAuth('sessions@test.com');

    const login2 = await request(app).post('/api/auth/login')
      .send({ email: 'sessions@test.com', password: 'TestPass123!', master_password: 'MasterPass123!' }).expect(200);
    const sid2 = login2.headers['set-cookie'].join('; ').match(/df_sid=([a-f0-9]{64})/)[1];

    const sessRes = await request(app).get('/api/auth/sessions').set('Cookie', `df_sid=${sid2}`).expect(200);
    assert.ok(sessRes.body.length >= 2);

    await request(app).delete(`/api/auth/sessions/${sid1}`).set('Cookie', `df_sid=${sid2}`).expect(200);
  });

  it('Flow 13: Create record type → Add fields → Create item', async () => {
    resetDb();
    const { auth } = await registerAndAuth('rectypes@test.com');

    const cat = await request(app).post('/api/categories').set('Cookie', auth).send({ name: 'APIs' }).expect(201);
    const rtRes = await request(app).post('/api/record-types').set('Cookie', auth)
      .send({ name: 'API Key', icon: '🔑', description: 'API key storage' }).expect(201);

    const fieldRes = await request(app).post(`/api/record-types/${rtRes.body.id}/fields`).set('Cookie', auth)
      .send({ name: 'key', field_type: 'password', position: 0 }).expect(201);

    const itemRes = await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'My API Key', category_id: cat.body.id, record_type_id: rtRes.body.id, fields: [{ field_def_id: fieldRes.body.id, value: 'secret-key-123' }], tags: [] })
      .expect(201);
    assert.ok(itemRes.body.id);
  });

  it('Flow 14: Create item → Copy → Verify copy exists', async () => {
    resetDb();
    const { auth } = await registerAndAuth('copy@test.com');
    const rt = getBuiltinRT();

    const cat = await request(app).post('/api/categories').set('Cookie', auth).send({ name: 'Copies' }).expect(201);
    const item = await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'Original', category_id: cat.body.id, record_type_id: rt.id, fields: [], tags: [] }).expect(201);

    const copyRes = await request(app).post(`/api/items/${item.body.id}/copy`).set('Cookie', auth).expect(201);
    assert.ok(copyRes.body.id);
    assert.notEqual(copyRes.body.id, item.body.id);

    const listRes = await request(app).get('/api/items').set('Cookie', auth).expect(200);
    const items = listRes.body.data || listRes.body;
    assert.ok(items.length >= 2);
  });

  it('Flow 15: Create items → Check encryption health', async () => {
    resetDb();
    const { auth } = await registerAndAuth('enc@test.com');
    const rt = getBuiltinRT();

    const cat = await request(app).post('/api/categories').set('Cookie', auth).send({ name: 'Encrypted' }).expect(201);
    await request(app).post('/api/items').set('Cookie', auth)
      .send({ title: 'Encrypted Item', category_id: cat.body.id, record_type_id: rt.id, fields: [], tags: [] }).expect(201);

    const healthRes = await request(app).get('/api/stats/encryption-health').set('Cookie', auth).expect(200);
    assert.equal(typeof healthRes.body.total, 'number');
    assert.ok(healthRes.body.total >= 1);
  });
});
