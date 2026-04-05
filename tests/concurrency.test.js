'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

async function makeLoggedInUser(app, overrides = {}) {
  const user = await makeUser(app, overrides);
  const logged = await loginUser(app, user);
  return { ...user, sid: logged.sid };
}

describe('Concurrency Tests', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  it('two users creating items simultaneously → no corruption', async () => {
    const userA = await makeLoggedInUser(app, { email: 'conc-a@test.com' });
    const userB = await makeLoggedInUser(app, { email: 'conc-b@test.com' });
    const apiA = authRequest(app, userA.sid);
    const apiB = authRequest(app, userB.sid);

    const catA = await apiA.post('/api/categories').send({ name: 'A Cat' }).expect(201);
    const catB = await apiB.post('/api/categories').send({ name: 'B Cat' }).expect(201);
    const types = await apiA.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;

    // Create items simultaneously
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        apiA.post('/api/items').send({
          title: `A-Item-${i}`,
          category_id: catA.body.id,
          record_type_id: rtId,
        }),
        apiB.post('/api/items').send({
          title: `B-Item-${i}`,
          category_id: catB.body.id,
          record_type_id: rtId,
        })
      );
    }

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 201);
    assert.equal(successes.length, 20, `Expected 20 successful creates, got ${successes.length}`);

    // Verify isolation — each user sees only their items
    const itemsA = await apiA.get('/api/items?limit=100').expect(200);
    const itemsB = await apiB.get('/api/items?limit=100').expect(200);
    assert.equal(itemsA.body.length, 10, 'User A should have 10 items');
    assert.equal(itemsB.body.length, 10, 'User B should have 10 items');
  });

  it('two users reading items simultaneously → correct isolation', async () => {
    const userA = await makeLoggedInUser(app, { email: 'iso-a@test.com' });
    const userB = await makeLoggedInUser(app, { email: 'iso-b@test.com' });
    const apiA = authRequest(app, userA.sid);
    const apiB = authRequest(app, userB.sid);

    const catA = await apiA.post('/api/categories').send({ name: 'A' }).expect(201);
    const catB = await apiB.post('/api/categories').send({ name: 'B' }).expect(201);
    const types = await apiA.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;

    // Create items
    for (let i = 0; i < 5; i++) {
      await apiA.post('/api/items').send({ title: `A-${i}`, category_id: catA.body.id, record_type_id: rtId }).expect(201);
      await apiB.post('/api/items').send({ title: `B-${i}`, category_id: catB.body.id, record_type_id: rtId }).expect(201);
    }

    // Read simultaneously
    const [resA, resB] = await Promise.all([
      apiA.get('/api/items?limit=100'),
      apiB.get('/api/items?limit=100'),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(resA.body.length, 5, 'A sees only A items');
    assert.equal(resB.body.length, 5, 'B sees only B items');

    // Check no cross-contamination
    for (const item of resA.body) {
      assert.ok(!item.title?.startsWith('B-'), 'A should not see B items');
    }
    for (const item of resB.body) {
      assert.ok(!item.title?.startsWith('A-'), 'B should not see A items');
    }
  });

  it('concurrent reads during write → no errors (WAL mode)', async () => {
    const user = await makeLoggedInUser(app, { email: 'wal@test.com' });
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'WAL' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;

    // Create some initial items
    for (let i = 0; i < 5; i++) {
      await api.post('/api/items').send({ title: `WAL-${i}`, category_id: cat.body.id, record_type_id: rtId }).expect(201);
    }

    // Simultaneously write and read
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        api.post('/api/items').send({ title: `New-${i}`, category_id: cat.body.id, record_type_id: rtId }),
        api.get('/api/items?limit=100'),
      );
    }

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.status >= 500);
    assert.equal(errors.length, 0, `Expected no 500 errors, got ${errors.length}`);
  });

  it('concurrent category creation → no duplicates or errors', async () => {
    const user = await makeLoggedInUser(app, { email: 'catconc@test.com' });
    const api = authRequest(app, user.sid);

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(api.post('/api/categories').send({ name: `Cat-${i}` }));
    }

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 201);
    assert.equal(successes.length, 10, 'All 10 categories should be created');

    const list = await api.get('/api/categories').expect(200);
    assert.equal(list.body.length, 10, 'Should list 10 categories');
  });

  it('concurrent tag creation → no corruption', async () => {
    const user = await makeLoggedInUser(app, { email: 'tagconc@test.com' });
    const api = authRequest(app, user.sid);

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(api.post('/api/tags').send({ name: `Tag-${i}` }));
    }

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 201);
    assert.equal(successes.length, 10, 'All 10 tags should be created');
  });

  it('concurrent deletes do not error', async () => {
    const user = await makeLoggedInUser(app, { email: 'del@test.com' });
    const api = authRequest(app, user.sid);

    // Create items to delete
    const cat = await api.post('/api/categories').send({ name: 'Del' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const res = await api.post('/api/items').send({ title: `Del-${i}`, category_id: cat.body.id, record_type_id: rtId }).expect(201);
      ids.push(res.body.id);
    }

    // Delete all concurrently
    const results = await Promise.all(ids.map(id => api.delete(`/api/items/${id}`)));
    const errors = results.filter(r => r.status >= 500);
    assert.equal(errors.length, 0, 'No server errors on concurrent delete');
  });

  it('WAL mode is enabled', () => {
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(mode, 'wal', 'Database should use WAL mode');
  });

  it('simultaneous reads from different users yield consistent data', async () => {
    const userA = await makeLoggedInUser(app, { email: 'consist-a@test.com' });
    const userB = await makeLoggedInUser(app, { email: 'consist-b@test.com' });
    const apiA = authRequest(app, userA.sid);
    const apiB = authRequest(app, userB.sid);

    // Both read categories simultaneously — should get their own empty lists
    const [resA, resB] = await Promise.all([
      apiA.get('/api/categories'),
      apiB.get('/api/categories'),
    ]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.deepEqual(resA.body, []);
    assert.deepEqual(resB.body, []);
  });
});
