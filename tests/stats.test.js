'use strict';

const { describe, it, before, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Stats Routes', () => {
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
    db.exec('DELETE FROM audit_log');
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

  it('GET /api/stats/dashboard returns counts', async () => {
    const res = await authRequest(app, user.sid)
      .get('/api/stats/dashboard')
      .expect(200);

    assert.ok('items' in res.body);
    assert.ok('categories' in res.body);
    assert.ok('shared' in res.body);
    assert.ok('members' in res.body);
    assert.ok('recent' in res.body);
    assert.equal(typeof res.body.items, 'number');
    assert.equal(typeof res.body.categories, 'number');
  });

  it('dashboard items count reflects actual items', async () => {
    const { category_id, record_type_id } = await createCategoryAndRT();
    await authRequest(app, user.sid)
      .post('/api/items')
      .send({ title: 'Test', category_id, record_type_id })
      .expect(201);

    const res = await authRequest(app, user.sid)
      .get('/api/stats/dashboard')
      .expect(200);

    assert.ok(res.body.items >= 1);
  });

  it('dashboard categories count reflects actual categories', async () => {
    await authRequest(app, user.sid)
      .post('/api/categories')
      .send({ name: 'StatsTestCat' })
      .expect(201);

    const res = await authRequest(app, user.sid)
      .get('/api/stats/dashboard')
      .expect(200);

    assert.ok(res.body.categories >= 1);
  });

  it('dashboard members count > 0', async () => {
    const res = await authRequest(app, user.sid)
      .get('/api/stats/dashboard')
      .expect(200);

    assert.ok(res.body.members >= 1);
  });

  it('dashboard recent is an array', async () => {
    const res = await authRequest(app, user.sid)
      .get('/api/stats/dashboard')
      .expect(200);

    assert.ok(Array.isArray(res.body.recent));
  });

  it('GET /api/stats/activity returns array', async () => {
    const res = await authRequest(app, user.sid)
      .get('/api/stats/activity')
      .expect(200);

    assert.ok(Array.isArray(res.body));
  });

  it('activity returns day/count objects', async () => {
    // Create an item to generate audit activity
    const { category_id, record_type_id } = await createCategoryAndRT();
    await authRequest(app, user.sid)
      .post('/api/items')
      .send({ title: 'ActivityTest', category_id, record_type_id })
      .expect(201);

    const res = await authRequest(app, user.sid)
      .get('/api/stats/activity')
      .expect(200);

    if (res.body.length > 0) {
      assert.ok('day' in res.body[0]);
      assert.ok('count' in res.body[0]);
    }
  });

  it('stats requires authentication', async () => {
    await authRequest(app, 'invalidsid')
      .get('/api/stats/dashboard')
      .expect(401);
  });
});
