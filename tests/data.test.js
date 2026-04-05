'use strict';

const { describe, it, before, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Data Routes', () => {
  let app, db, user;

  before(async () => {
    ({ app, db } = setup());
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
  });

  afterEach(() => {
    db.exec('DELETE FROM item_fields');
    db.exec('DELETE FROM item_tags');
    db.exec('DELETE FROM items');
    db.exec('DELETE FROM categories');
  });

  after(() => teardown());

  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  async function createCategoryAndRT() {
    const catRes = await authRequest(app, user.sid)
      .post('/api/categories')
      .send({ name: 'Test Cat' })
      .expect(201);
    const rt = getBuiltinRT();
    return { category_id: catRes.body.id, record_type_id: rt.id };
  }

  // ─── Export ───

  it('GET /api/data/export returns JSON with items', async () => {
    const { category_id, record_type_id } = await createCategoryAndRT();
    await authRequest(app, user.sid)
      .post('/api/items')
      .send({ title: 'ExportMe', category_id, record_type_id, notes: 'export note' })
      .expect(201);

    const res = await authRequest(app, user.sid)
      .get('/api/data/export')
      .expect(200);

    assert.ok(res.body.version);
    assert.ok(res.body.exported_at);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length >= 1);
    const item = res.body.items.find(i => i.title === 'ExportMe');
    assert.ok(item);
    assert.equal(item.notes, 'export note');
  });

  it('export returns empty items array when no items', async () => {
    const res = await authRequest(app, user.sid)
      .get('/api/data/export')
      .expect(200);

    assert.ok(Array.isArray(res.body.items));
  });

  // ─── Import ───

  it('POST /api/data/import with bitwarden JSON data', async () => {
    const data = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [
        { type: 1, name: 'Imported Login', notes: null, favorite: false, folderId: null,
          login: { username: 'u', password: 'p', uris: [{ uri: 'https://example.com' }], totp: null } },
      ],
    });

    const res = await authRequest(app, user.sid)
      .post('/api/data/import')
      .send({ format: 'bitwarden', data })
      .expect(200);

    assert.equal(res.body.imported, 1);
    assert.equal(res.body.total, 1);
  });

  it('import rejects unknown format', async () => {
    const res = await authRequest(app, user.sid)
      .post('/api/data/import')
      .send({ format: 'unknown', data: '{}' })
      .expect(400);

    assert.ok(res.body.error.includes('Unsupported'));
  });

  it('import rejects missing file and data', async () => {
    const res = await authRequest(app, user.sid)
      .post('/api/data/import')
      .send({ format: 'bitwarden' })
      .expect(400);

    assert.ok(res.body.error);
  });

  it('import with chrome CSV data', async () => {
    const csv = 'name,url,username,password,note\nChrome Login,https://chrome.com,user,pass,';

    const res = await authRequest(app, user.sid)
      .post('/api/data/import')
      .send({ format: 'chrome', data: csv })
      .expect(200);

    assert.equal(res.body.imported, 1);
  });

  // ─── Backup ───

  it('POST /api/data/backup creates a backup', async () => {
    const res = await authRequest(app, user.sid)
      .post('/api/data/backup')
      .expect(200);

    assert.ok(res.body.path);
    assert.ok(res.body.created);
  });

  it('GET /api/data/backups lists backups', async () => {
    // Create a backup first
    await authRequest(app, user.sid)
      .post('/api/data/backup')
      .expect(200);

    const res = await authRequest(app, user.sid)
      .get('/api/data/backups')
      .expect(200);

    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1);
    assert.ok(res.body[0].name);
    assert.ok(res.body[0].path);
  });

  // ─── Auth ───

  it('data routes require authentication', async () => {
    await authRequest(app, 'invalidsid')
      .get('/api/data/export')
      .expect(401);
  });

  it('import creates items that show in vault', async () => {
    const data = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [
        { type: 1, name: 'VaultCheck', notes: 'visible', favorite: false, folderId: null,
          login: { username: 'u', password: 'p', uris: [], totp: null } },
      ],
    });

    await authRequest(app, user.sid)
      .post('/api/data/import')
      .send({ format: 'bitwarden', data })
      .expect(200);

    const list = await authRequest(app, user.sid)
      .get('/api/items')
      .expect(200);

    const found = list.body.find(i => i.title === 'VaultCheck');
    assert.ok(found);
  });
});
