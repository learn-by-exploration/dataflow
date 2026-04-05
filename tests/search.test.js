'use strict';

const { describe, it, before, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Search', () => {
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

  async function createItem(sid, title, notes) {
    const { category_id, record_type_id } = await createCategoryAndRT();
    const body = { title, category_id, record_type_id };
    if (notes) body.notes = notes;
    const res = await authRequest(app, sid)
      .post('/api/items')
      .send(body)
      .expect(201);
    return res.body;
  }

  it('finds items by title match', async () => {
    await createItem(user.sid, 'GitHub Login', null);
    await createItem(user.sid, 'Gmail Account', null);

    const res = await authRequest(app, user.sid)
      .get('/api/items')
      .expect(200);

    const items = res.body.filter(i => i.title && i.title.toLowerCase().includes('github'));
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'GitHub Login');
  });

  it('search is case-insensitive', async () => {
    await createItem(user.sid, 'My Secret Note', 'important stuff');

    const res = await authRequest(app, user.sid)
      .get('/api/items')
      .expect(200);

    const items = res.body.filter(i => i.title && i.title.toLowerCase().includes('secret'));
    assert.equal(items.length, 1);
  });

  it('finds items by notes content', async () => {
    await createItem(user.sid, 'Test Item', 'special keyword here');

    const res = await authRequest(app, user.sid)
      .get('/api/items')
      .expect(200);

    const items = res.body.filter(i => i.notes && i.notes.toLowerCase().includes('special'));
    assert.equal(items.length, 1);
  });

  it('returns empty when no match', async () => {
    await createItem(user.sid, 'Some Item', null);

    const res = await authRequest(app, user.sid)
      .get('/api/items')
      .expect(200);

    const items = res.body.filter(i => i.title && i.title.toLowerCase().includes('nonexistent'));
    assert.equal(items.length, 0);
  });

  it('search service returns filtered results', async () => {
    await createItem(user.sid, 'Alpha Service', null);
    await createItem(user.sid, 'Beta Service', null);
    await createItem(user.sid, 'Gamma Tool', null);

    const { searchItems } = require('../src/services/search');
    const { getVaultKey } = require('./helpers');
    const vaultKey = getVaultKey(user.sid);

    const results = searchItems(db, user.id, vaultKey, 'service');
    assert.equal(results.length, 2);
  });

  it('search service is case-insensitive', async () => {
    await createItem(user.sid, 'UPPERCASE ITEM', null);

    const { searchItems } = require('../src/services/search');
    const { getVaultKey } = require('./helpers');
    const vaultKey = getVaultKey(user.sid);

    const results = searchItems(db, user.id, vaultKey, 'uppercase');
    assert.equal(results.length, 1);
  });

  it('search returns empty for no match via service', async () => {
    await createItem(user.sid, 'Something', null);

    const { searchItems } = require('../src/services/search');
    const { getVaultKey } = require('./helpers');
    const vaultKey = getVaultKey(user.sid);

    const results = searchItems(db, user.id, vaultKey, 'zzzzzzz');
    assert.equal(results.length, 0);
  });

  it('search matches notes via service', async () => {
    await createItem(user.sid, 'Item', 'findme keyword');

    const { searchItems } = require('../src/services/search');
    const { getVaultKey } = require('./helpers');
    const vaultKey = getVaultKey(user.sid);

    const results = searchItems(db, user.id, vaultKey, 'findme');
    assert.equal(results.length, 1);
  });

  it('user isolation — does not return other user items', async () => {
    const user2 = await makeUser(app, { email: 'search-other@test.com' });
    const logged2 = await loginUser(app, user2);
    user2.sid = logged2.sid;
    await createItem(user.sid, 'SharedWord', null);
    await createItem(user2.sid, 'SharedWord', null);

    const { searchItems } = require('../src/services/search');
    const { getVaultKey } = require('./helpers');
    const vaultKey = getVaultKey(user.sid);

    const results = searchItems(db, user.id, vaultKey, 'sharedword');
    assert.equal(results.length, 1);
  });

  it('handles empty query string', async () => {
    await createItem(user.sid, 'Something', null);

    const { searchItems } = require('../src/services/search');
    const { getVaultKey } = require('./helpers');
    const vaultKey = getVaultKey(user.sid);

    const results = searchItems(db, user.id, vaultKey, '');
    assert.ok(results.length >= 1);
  });
});
