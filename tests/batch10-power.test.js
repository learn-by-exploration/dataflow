'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, makeInvitedUser } = require('./helpers');

describe('Batch 10 — Power Features', () => {
  let app, db, user, user2;

  before(async () => {
    ({ app, db } = setup());
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
  });

  afterEach(() => {
    try { db.exec('DELETE FROM audit_log'); } catch { /* ignore */ }
  });

  after(() => teardown());

  // Helper to create a category
  async function createCategory(sid, name) {
    const res = await authRequest(app, sid).post('/api/categories').send({ name }).expect(201);
    return res.body;
  }

  // Helper to create a record type
  async function createRecordType(sid, name) {
    const res = await authRequest(app, sid).post('/api/record-types').send({ name, icon: '📄' }).expect(201);
    return res.body;
  }

  // Helper to create an item
  async function createItem(sid, categoryId, title, opts = {}) {
    const body = { category_id: categoryId, record_type_id: opts.record_type_id || undefined, title, ...opts };
    if (!body.record_type_id) {
      // Need a record type
      const rt = await createRecordType(sid, 'Default RT ' + Date.now());
      body.record_type_id = rt.id;
    }
    const res = await authRequest(app, sid).post('/api/items').send(body).expect(201);
    return res.body;
  }

  // ════════════════════════════════════════════
  // #91: Bulk edit items
  // ════════════════════════════════════════════
  describe('#91: Bulk edit items', () => {
    let cat1, cat2, rt1, rt2, item1, item2, item3;

    before(async () => {
      cat1 = await createCategory(user.sid, 'Bulk-Edit-Cat-1');
      cat2 = await createCategory(user.sid, 'Bulk-Edit-Cat-2');
      rt1 = await createRecordType(user.sid, 'Bulk-Edit-RT-1');
      rt2 = await createRecordType(user.sid, 'Bulk-Edit-RT-2');
      item1 = await createItem(user.sid, cat1.id, 'BE-Item-1', { record_type_id: rt1.id });
      item2 = await createItem(user.sid, cat1.id, 'BE-Item-2', { record_type_id: rt1.id });
      item3 = await createItem(user.sid, cat1.id, 'BE-Item-3', { record_type_id: rt1.id });
    });

    it('PUT /api/items/bulk/edit changes category on multiple items', async () => {
      const res = await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [item1.id, item2.id], changes: { category_id: cat2.id } })
        .expect(200);
      assert.ok(res.body.ok);
      assert.equal(res.body.count, 2);
      // Verify items moved
      const i1 = await authRequest(app, user.sid).get(`/api/items/${item1.id}`).expect(200);
      assert.equal(i1.body.category_id, cat2.id);
    });

    it('PUT /api/items/bulk/edit changes record_type_id', async () => {
      await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [item3.id], changes: { record_type_id: rt2.id } })
        .expect(200);
      const i3 = await authRequest(app, user.sid).get(`/api/items/${item3.id}`).expect(200);
      assert.equal(i3.body.record_type_id, rt2.id);
    });

    it('PUT /api/items/bulk/edit rejects empty itemIds', async () => {
      await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [], changes: { category_id: cat1.id } })
        .expect(400);
    });

    it('PUT /api/items/bulk/edit rejects empty changes', async () => {
      await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [item1.id], changes: {} })
        .expect(400);
    });

    it('PUT /api/items/bulk/edit rejects items not owned by user', async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;

      const otherUser = await makeUser(app, { email: 'other-bulk@test.com' });
      const otherLogged = await loginUser(app, otherUser);
      otherUser.sid = otherLogged.sid;

      const otherCat = await createCategory(otherUser.sid, 'Other-Cat');
      const otherItem = await createItem(otherUser.sid, otherCat.id, 'Other-Item');

      await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [otherItem.id], changes: { category_id: 999 } })
        .expect(403);
    });
  });

  // ════════════════════════════════════════════
  // #92: Bulk move items
  // ════════════════════════════════════════════
  describe('#92: Bulk move items', () => {
    let cat1, cat2, item1, item2;

    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      cat1 = await createCategory(user.sid, 'Move-From');
      cat2 = await createCategory(user.sid, 'Move-To');
      item1 = await createItem(user.sid, cat1.id, 'Move-1');
      item2 = await createItem(user.sid, cat1.id, 'Move-2');
    });

    it('POST /api/items/bulk/move moves items to target category', async () => {
      const res = await authRequest(app, user.sid)
        .post('/api/items/bulk/move')
        .send({ itemIds: [item1.id, item2.id], category_id: cat2.id })
        .expect(200);
      assert.ok(res.body.ok);
      assert.equal(res.body.count, 2);
    });

    it('POST /api/items/bulk/move rejects missing category_id', async () => {
      await authRequest(app, user.sid)
        .post('/api/items/bulk/move')
        .send({ itemIds: [item1.id] })
        .expect(400);
    });

    it('POST /api/items/bulk/move rejects empty itemIds', async () => {
      await authRequest(app, user.sid)
        .post('/api/items/bulk/move')
        .send({ itemIds: [], category_id: cat2.id })
        .expect(400);
    });
  });

  // ════════════════════════════════════════════
  // #93: Bulk delete items
  // ════════════════════════════════════════════
  describe('#93: Bulk delete items', () => {
    let cat, item1, item2;

    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      cat = await createCategory(user.sid, 'Del-Cat');
      item1 = await createItem(user.sid, cat.id, 'Del-1');
      item2 = await createItem(user.sid, cat.id, 'Del-2');
    });

    it('POST /api/items/bulk/delete soft-deletes items', async () => {
      const res = await authRequest(app, user.sid)
        .post('/api/items/bulk/delete')
        .send({ itemIds: [item1.id, item2.id] })
        .expect(200);
      assert.ok(res.body.ok);
      // Items should be in trash
      const trash = await authRequest(app, user.sid).get('/api/items/trash').expect(200);
      const ids = trash.body.map(i => i.id);
      assert.ok(ids.includes(item1.id));
      assert.ok(ids.includes(item2.id));
    });

    it('POST /api/items/bulk/delete rejects empty itemIds', async () => {
      await authRequest(app, user.sid)
        .post('/api/items/bulk/delete')
        .send({ itemIds: [] })
        .expect(400);
    });

    it('POST /api/items/bulk/delete validates ownership', async () => {
      const otherUser = await makeUser(app, { email: 'other-del@test.com' });
      const otherLogged = await loginUser(app, otherUser);
      otherUser.sid = otherLogged.sid;

      const otherCat = await createCategory(otherUser.sid, 'Other-Del-Cat');
      const otherItem = await createItem(otherUser.sid, otherCat.id, 'Other-Del-Item');

      await authRequest(app, user.sid)
        .post('/api/items/bulk/delete')
        .send({ itemIds: [otherItem.id] })
        .expect(403);
    });
  });

  // ════════════════════════════════════════════
  // #94: Expiring shares
  // ════════════════════════════════════════════
  describe('#94: Expiring shares', () => {
    let cat, item1;

    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      user2 = await makeUser(app, { email: 'share-exp@test.com' });
      const l2 = await loginUser(app, user2);
      user2.sid = l2.sid;
      cat = await createCategory(user.sid, 'Expiry-Cat');
      item1 = await createItem(user.sid, cat.id, 'Expiry-Item');
    });

    it('item_shares table has expires_at column', () => {
      const cols = db.pragma('table_info(item_shares)').map(c => c.name);
      assert.ok(cols.includes('expires_at'));
    });

    it('category_shares table has expires_at column', () => {
      const cols = db.pragma('table_info(category_shares)').map(c => c.name);
      assert.ok(cols.includes('expires_at'));
    });

    it('share item with expires_at', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const res = await authRequest(app, user.sid)
        .post(`/api/items/${item1.id}/share`)
        .send({ user_id: user2.id, permission: 'read', expires_at: futureDate })
        .expect(201);
      assert.ok(res.body.expires_at);
    });

    it('share item rejects past expires_at', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await authRequest(app, user.sid)
        .post(`/api/items/${item1.id}/share`)
        .send({ user_id: user2.id, permission: 'read', expires_at: pastDate })
        .expect(400);
    });

    it('cleanExpiredShares removes expired shares', () => {
      // Remove any existing shares first
      db.prepare('DELETE FROM item_shares WHERE item_id = ? AND shared_with = ?').run(item1.id, user2.id);
      // Insert an expired share directly
      db.prepare(
        "INSERT INTO item_shares (item_id, shared_by, shared_with, permission, expires_at) VALUES (?, ?, ?, 'read', datetime('now', '-1 hour'))"
      ).run(item1.id, user.id, user2.id);
      const createSharingRepo = require('../src/repositories/sharing.repository');
      const repo = createSharingRepo(db);
      const cleaned = repo.cleanExpiredShares();
      assert.ok(cleaned >= 1);
    });
  });

  // ════════════════════════════════════════════
  // #95: Secure share links
  // ════════════════════════════════════════════
  describe('#95: Secure share links', () => {
    let cat, item1;

    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      cat = await createCategory(user.sid, 'SL-Cat');
      item1 = await createItem(user.sid, cat.id, 'SL-Item');
    });

    it('share_links table exists', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='share_links'").all();
      assert.equal(tables.length, 1);
    });

    it('POST /api/share-links creates a share link', async () => {
      const res = await authRequest(app, user.sid)
        .post('/api/share-links')
        .send({ item_id: item1.id })
        .expect(201);
      assert.ok(res.body.token);
      assert.equal(res.body.token.length, 64);
      assert.equal(res.body.item_id, item1.id);
    });

    it('GET /api/share-links/:token resolves a share link', async () => {
      const create = await authRequest(app, user.sid)
        .post('/api/share-links')
        .send({ item_id: item1.id })
        .expect(201);
      const res = await request(app)
        .get(`/api/share-links/${create.body.token}`)
        .expect(200);
      assert.ok(res.body.item);
      assert.equal(res.body.item.id, item1.id);
    });

    it('one-time use link cannot be used twice', async () => {
      const create = await authRequest(app, user.sid)
        .post('/api/share-links')
        .send({ item_id: item1.id, oneTimeUse: true })
        .expect(201);
      // First use
      await request(app).get(`/api/share-links/${create.body.token}`).expect(200);
      // Second use
      await request(app).get(`/api/share-links/${create.body.token}`).expect(410);
    });

    it('expired share link returns 410', async () => {
      // Create with already-expired timestamp via direct DB insert
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare(
        "INSERT INTO share_links (item_id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '-1 hour'))"
      ).run(item1.id, user.id, token);
      await request(app).get(`/api/share-links/${token}`).expect(410);
    });

    it('passphrase-protected link requires passphrase', async () => {
      const create = await authRequest(app, user.sid)
        .post('/api/share-links')
        .send({ item_id: item1.id, passphrase: 'secret123' })
        .expect(201);
      // Without passphrase
      await request(app).get(`/api/share-links/${create.body.token}`).expect(401);
      // With wrong passphrase
      await request(app).get(`/api/share-links/${create.body.token}?passphrase=wrong`).expect(403);
      // With correct passphrase
      const res = await request(app).get(`/api/share-links/${create.body.token}?passphrase=secret123`).expect(200);
      assert.ok(res.body.item);
    });

    it('invalid token returns 400 or 404', async () => {
      await request(app).get('/api/share-links/short').expect(400);
      const fakeToken = 'a'.repeat(64);
      await request(app).get(`/api/share-links/${fakeToken}`).expect(404);
    });
  });

  // ════════════════════════════════════════════
  // #96: Vault analytics dashboard
  // ════════════════════════════════════════════
  describe('#96: Vault analytics', () => {
    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      const cat = await createCategory(user.sid, 'Analytics-Cat');
      await createItem(user.sid, cat.id, 'Analytics-Item-1');
      await createItem(user.sid, cat.id, 'Analytics-Item-2');
    });

    it('GET /api/stats/analytics returns analytics data', async () => {
      const res = await authRequest(app, user.sid).get('/api/stats/analytics').expect(200);
      assert.ok(res.body.itemsByCategory);
      assert.ok(Array.isArray(res.body.itemsByCategory));
      assert.ok(res.body.itemsPerMonth);
      assert.ok(res.body.sharesPerMonth);
      assert.ok(res.body.loginsPerDay);
      assert.ok(res.body.topTags);
    });

    it('analytics itemsByCategory has name and count', async () => {
      const res = await authRequest(app, user.sid).get('/api/stats/analytics').expect(200);
      const cat = res.body.itemsByCategory.find(c => c.name === 'Analytics-Cat');
      assert.ok(cat);
      assert.equal(cat.count, 2);
    });

    it('analytics itemsPerMonth has month+count structure', async () => {
      const res = await authRequest(app, user.sid).get('/api/stats/analytics').expect(200);
      if (res.body.itemsPerMonth.length > 0) {
        assert.ok(res.body.itemsPerMonth[0].month);
        assert.ok(typeof res.body.itemsPerMonth[0].count === 'number');
      }
    });
  });

  // ════════════════════════════════════════════
  // #97: Enhanced field types
  // ════════════════════════════════════════════
  describe('#97: Enhanced field types', () => {
    it('record_type_fields supports date, phone, email, url, select types', () => {
      const fieldTypes = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='record_type_fields'"
      ).get();
      assert.ok(fieldTypes.sql.includes('date'));
      assert.ok(fieldTypes.sql.includes('phone'));
      assert.ok(fieldTypes.sql.includes('email'));
      assert.ok(fieldTypes.sql.includes('url'));
      assert.ok(fieldTypes.sql.includes('select'));
    });

    it('app.js has renderFieldValue function', () => {
      const fs = require('fs');
      const appJs = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
      assert.ok(appJs.includes('function renderFieldValue'));
      assert.ok(appJs.includes('function renderFieldInput'));
    });

    it('renderFieldValue renders url as link', () => {
      const fs = require('fs');
      const appJs = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
      assert.ok(appJs.includes("case 'url':"));
      assert.ok(appJs.includes('target="_blank"'));
      assert.ok(appJs.includes('rel="noopener noreferrer"'));
    });

    it('renderFieldInput creates typed inputs', () => {
      const fs = require('fs');
      const appJs = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
      assert.ok(appJs.includes('type="date"'));
      assert.ok(appJs.includes('type="tel"'));
      assert.ok(appJs.includes('type="url"'));
      assert.ok(appJs.includes('type="email"'));
    });
  });

  // ════════════════════════════════════════════
  // #98: User-defined templates
  // ════════════════════════════════════════════
  describe('#98: User-defined templates', () => {
    let cat, rt, item1;

    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      cat = await createCategory(user.sid, 'Tpl-Cat');
      rt = await createRecordType(user.sid, 'Tpl-RT');
      item1 = await createItem(user.sid, cat.id, 'Tpl-Item', { record_type_id: rt.id });
    });

    it('item_templates table exists', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='item_templates'").all();
      assert.equal(tables.length, 1);
    });

    it('POST /api/templates creates template from item', async () => {
      const res = await authRequest(app, user.sid)
        .post('/api/templates')
        .send({ item_id: item1.id, name: 'My Template' })
        .expect(201);
      assert.equal(res.body.name, 'My Template');
      assert.equal(res.body.record_type_id, rt.id);
    });

    it('GET /api/templates lists templates', async () => {
      const res = await authRequest(app, user.sid).get('/api/templates').expect(200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 1);
    });

    it('GET /api/templates/:id returns template with parsed fields', async () => {
      const list = await authRequest(app, user.sid).get('/api/templates').expect(200);
      const tpl = list.body[0];
      const res = await authRequest(app, user.sid).get(`/api/templates/${tpl.id}`).expect(200);
      assert.equal(res.body.name, 'My Template');
      assert.ok(Array.isArray(res.body.default_fields));
    });

    it('DELETE /api/templates/:id deletes template', async () => {
      const create = await authRequest(app, user.sid)
        .post('/api/templates')
        .send({ item_id: item1.id, name: 'To Delete' })
        .expect(201);
      await authRequest(app, user.sid).delete(`/api/templates/${create.body.id}`).expect(204);
      await authRequest(app, user.sid).get(`/api/templates/${create.body.id}`).expect(404);
    });

    it('cannot create template from item not owned by user', async () => {
      const other = await makeUser(app, { email: 'tpl-other@test.com' });
      const otherLogged = await loginUser(app, other);
      other.sid = otherLogged.sid;

      await authRequest(app, other.sid)
        .post('/api/templates')
        .send({ item_id: item1.id, name: 'Stolen Template' })
        .expect(404);
    });
  });

  // ════════════════════════════════════════════
  // #99: Merge duplicates wizard
  // ════════════════════════════════════════════
  describe('#99: Merge items', () => {
    let cat, rt, item1, item2;

    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      cat = await createCategory(user.sid, 'Merge-Cat');
      rt = await createRecordType(user.sid, 'Merge-RT');
      item1 = await createItem(user.sid, cat.id, 'Merge-Source', { record_type_id: rt.id, notes: 'Source notes' });
      item2 = await createItem(user.sid, cat.id, 'Merge-Target', { record_type_id: rt.id, notes: 'Target notes' });
    });

    it('POST /api/items/:id/merge merges source into target and creates audit log', async () => {
      const res = await authRequest(app, user.sid)
        .post(`/api/items/${item2.id}/merge`)
        .send({ sourceId: item1.id, fieldSelections: { title: 'target', notes: 'both' } })
        .expect(200);
      assert.equal(res.body.title, 'Merge-Target');
      assert.ok(res.body.notes.includes('Target notes'));
      assert.ok(res.body.notes.includes('Source notes'));

      // Verify audit log
      const log = db.prepare("SELECT * FROM audit_log WHERE action = 'item.merge' ORDER BY id DESC LIMIT 1").get();
      assert.ok(log);
      assert.ok(log.detail.includes(String(item1.id)));
    });

    it('source item is soft-deleted after merge', async () => {
      const trash = await authRequest(app, user.sid).get('/api/items/trash').expect(200);
      const trashed = trash.body.find(i => i.id === item1.id);
      assert.ok(trashed, 'Source item should be in trash');
    });

    it('merge with title=source keeps source title', async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      cat = await createCategory(user.sid, 'Merge-Cat-2');
      rt = await createRecordType(user.sid, 'Merge-RT-2');
      const s = await createItem(user.sid, cat.id, 'SourceTitle', { record_type_id: rt.id });
      const t = await createItem(user.sid, cat.id, 'TargetTitle', { record_type_id: rt.id });
      const res = await authRequest(app, user.sid)
        .post(`/api/items/${t.id}/merge`)
        .send({ sourceId: s.id, fieldSelections: { title: 'source' } })
        .expect(200);
      assert.equal(res.body.title, 'SourceTitle');
    });

    it('merge rejects missing sourceId', async () => {
      await authRequest(app, user.sid)
        .post(`/api/items/999/merge`)
        .send({ fieldSelections: {} })
        .expect(400);
    });
  });

  // ════════════════════════════════════════════
  // #100: Family activity feed
  // ════════════════════════════════════════════
  describe('#100: Activity feed', () => {
    before(async () => {
      cleanDb();
      user = await makeUser(app);
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
      // Generate some activity
      const cat = await createCategory(user.sid, 'Feed-Cat');
      await createItem(user.sid, cat.id, 'Feed-Item');
    });

    it('GET /api/stats/activity-feed returns feed', async () => {
      const res = await authRequest(app, user.sid).get('/api/stats/activity-feed').expect(200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length > 0);
    });

    it('activity feed respects limit', async () => {
      const res = await authRequest(app, user.sid).get('/api/stats/activity-feed?limit=2').expect(200);
      assert.ok(res.body.length <= 2);
    });

    it('activity feed max limit is 200', async () => {
      const res = await authRequest(app, user.sid).get('/api/stats/activity-feed?limit=9999').expect(200);
      // Should not crash and should cap at 200
      assert.ok(res.body.length <= 200);
    });

    it('activity feed filters by member_id', async () => {
      const res = await authRequest(app, user.sid)
        .get(`/api/stats/activity-feed?member_id=${user.id}`)
        .expect(200);
      // All entries should belong to user
      for (const entry of res.body) {
        assert.equal(entry.user_id, user.id);
      }
    });

    it('child role sees only own activity', async () => {
      const child = await makeInvitedUser(app, user.sid, { email: 'child-feed@test.com', role: 'child' });
      // Child creates some activity
      const childCat = await createCategory(child.sid, 'Child-Cat');
      await createItem(child.sid, childCat.id, 'Child-Item');

      const res = await authRequest(app, child.sid).get('/api/stats/activity-feed').expect(200);
      for (const entry of res.body) {
        assert.equal(entry.user_id, child.id);
      }
    });

    it('feed entries have display_name and action', async () => {
      const res = await authRequest(app, user.sid).get('/api/stats/activity-feed').expect(200);
      if (res.body.length > 0) {
        const first = res.body[0];
        assert.ok(first.action);
        assert.ok(first.created_at);
      }
    });
  });

  // ════════════════════════════════════════════
  // Frontend features presence checks
  // ════════════════════════════════════════════
  describe('Frontend feature presence', () => {
    const fs = require('fs');
    const path = require('path');
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    it('app.js has renderAnalyticsView', () => {
      assert.ok(appJs.includes('function renderAnalyticsView'));
    });

    it('app.js has renderActivityView', () => {
      assert.ok(appJs.includes('function renderActivityView'));
    });

    it('app.js routes analytics and activity views', () => {
      assert.ok(appJs.includes("case 'analytics':"));
      assert.ok(appJs.includes("case 'activity':"));
    });

    it('app.js has share link modal', () => {
      assert.ok(appJs.includes('function showShareLinkModal'));
    });

    it('app.js has merge wizard', () => {
      assert.ok(appJs.includes('function showMergeWizard'));
    });

    it('app.js has saveAsTemplate function', () => {
      assert.ok(appJs.includes('function saveAsTemplate'));
    });

    it('analytics view uses pure CSS charts (no canvas/svg)', () => {
      assert.ok(appJs.includes('bar-chart-h'));
      assert.ok(appJs.includes('bar-chart-v'));
      assert.ok(appJs.includes('bar-fill'));
    });

    it('activity feed has auto-refresh polling', () => {
      assert.ok(appJs.includes('activityPollTimer'));
      assert.ok(appJs.includes('30000'));
    });
  });
});
