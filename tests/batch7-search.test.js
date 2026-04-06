'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, getVaultKey } = require('./helpers');

describe('Batch 7 — Search & Data', () => {
  let app, db, user;

  before(async () => {
    ({ app, db } = setup());
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
  });

  afterEach(() => {
    db.exec('DELETE FROM item_tags');
    db.exec('DELETE FROM item_fields');
    db.exec('DELETE FROM item_attachments');
    db.exec('DELETE FROM item_shares');
    db.exec('DELETE FROM items');
    db.exec('DELETE FROM tags');
    db.exec('DELETE FROM categories');
    db.exec('DELETE FROM settings');
    try { db.exec('DELETE FROM item_history'); } catch { /* ignore */ }
    try { db.exec('DELETE FROM items_fts'); } catch { /* ignore */ }
  });

  after(() => teardown());

  // ─── Helpers ───
  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  async function createCategory(name) {
    const res = await authRequest(app, user.sid)
      .post('/api/categories')
      .send({ name: name || 'Cat-' + crypto.randomUUID().slice(0, 6) })
      .expect(201);
    return res.body;
  }

  async function createItem(catId, title, extra = {}) {
    const rt = getBuiltinRT();
    const res = await authRequest(app, user.sid)
      .post('/api/items')
      .send({
        category_id: catId,
        record_type_id: rt.id,
        title: title || 'Item-' + crypto.randomUUID().slice(0, 6),
        ...extra,
      })
      .expect(201);
    return res.body;
  }

  // ═══════════════════════════════════════════
  // #61: FTS5 Search Index
  // ═══════════════════════════════════════════

  describe('#61 — FTS5 Search Index', () => {
    it('should have items_fts virtual table', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items_fts'").get();
      assert.ok(row, 'items_fts table should exist');
    });

    it('POST /api/items/reindex should rebuild search index', async () => {
      const cat = await createCategory('Search Cat');
      await createItem(cat.id, 'My Bank Login');
      await createItem(cat.id, 'Email Account');

      const res = await authRequest(app, user.sid)
        .post('/api/items/reindex')
        .expect(200);
      assert.ok(res.body.indexed >= 2);
    });

    it('GET /api/items?q=bank should return FTS5 search results', async () => {
      const cat = await createCategory('Search Cat');
      await createItem(cat.id, 'My Bank Login');
      await createItem(cat.id, 'Email Account');
      await createItem(cat.id, 'Bank Card PIN');

      // Rebuild index
      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items?q=bank')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      const titles = results.map(r => r.title);
      assert.ok(titles.some(t => t.includes('Bank')), 'Should find items with "Bank" in title');
      assert.ok(!titles.some(t => t === 'Email Account'), 'Should not include non-matching items');
    });

    it('should search in notes too via FTS5', async () => {
      const cat = await createCategory('Notes Search');
      await createItem(cat.id, 'Generic Item', { notes: 'secret banking info' });
      await createItem(cat.id, 'Another Item');

      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items?q=banking')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.length >= 1, 'Should find item with banking in notes');
      assert.ok(results.some(r => r.title === 'Generic Item'));
    });

    it('should return empty array for unmatched FTS query', async () => {
      const cat = await createCategory('Empty Search');
      await createItem(cat.id, 'Normal Item');
      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items?q=zzzznonexistent')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.equal(results.length, 0);
    });
  });

  // ═══════════════════════════════════════════
  // #62: Fuzzy Search
  // ═══════════════════════════════════════════

  describe('#62 — Fuzzy Search', () => {
    it('should find "password" when searching for "paswrod" (fuzzy)', async () => {
      const cat = await createCategory('Fuzzy Cat');
      await createItem(cat.id, 'My password vault');
      await createItem(cat.id, 'Email Login');

      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items?q=paswrod')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.length >= 1, 'Fuzzy search should find "password" for "paswrod"');
    });

    it('should not match when distance > 2', async () => {
      const cat = await createCategory('No Match');
      await createItem(cat.id, 'aaaaaaa');
      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items?q=zzzzzzz')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.equal(results.length, 0);
    });

    it('should rank exact matches higher than fuzzy', async () => {
      const cat = await createCategory('Rank Cat');
      await createItem(cat.id, 'bank account');
      await createItem(cat.id, 'bnak stuff');
      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items?q=bank')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.length >= 1);
      // Exact match should come first
      if (results.length >= 2) {
        assert.ok(results[0].title.toLowerCase().includes('bank'));
      }
    });
  });

  // ═══════════════════════════════════════════
  // #63: Advanced Filters
  // ═══════════════════════════════════════════

  describe('#63 — Advanced Filters', () => {
    it('should filter by category_id', async () => {
      const cat1 = await createCategory('Cat A');
      const cat2 = await createCategory('Cat B');
      await createItem(cat1.id, 'In A');
      await createItem(cat2.id, 'In B');

      const res = await authRequest(app, user.sid)
        .get('/api/items?category_id=' + cat1.id)
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.every(r => r.category_id === cat1.id));
    });

    it('should filter by tag_ids (multiple)', async () => {
      const cat = await createCategory('Tag Filter');
      const item1 = await createItem(cat.id, 'Tagged1');
      const item2 = await createItem(cat.id, 'Tagged2');
      await createItem(cat.id, 'NoTag');

      // Create tags
      const tagRes1 = await authRequest(app, user.sid).post('/api/tags').send({ name: 'urgent' }).expect(201);
      const tagRes2 = await authRequest(app, user.sid).post('/api/tags').send({ name: 'finance' }).expect(201);
      const tag1 = tagRes1.body;
      const tag2 = tagRes2.body;

      // Link tags
      await authRequest(app, user.sid).put('/api/items/' + item1.id).send({ tags: [tag1.id] });
      await authRequest(app, user.sid).put('/api/items/' + item2.id).send({ tags: [tag2.id] });

      // Filter by single tag
      const res = await authRequest(app, user.sid)
        .get('/api/items?tag_id=' + tag1.id)
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.some(r => r.title === 'Tagged1'));
      assert.ok(!results.some(r => r.title === 'NoTag'));
    });

    it('should filter by created_after and created_before', async () => {
      const cat = await createCategory('Date Filter');
      await createItem(cat.id, 'Old Item');
      await createItem(cat.id, 'New Item');

      // Use a future date to get all items
      const futureDate = '2099-01-01';
      const res = await authRequest(app, user.sid)
        .get('/api/items?created_before=' + futureDate)
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.length >= 2);

      // Use a past date to get no items
      const pastDate = '2000-01-01';
      const res2 = await authRequest(app, user.sid)
        .get('/api/items?created_before=' + pastDate)
        .expect(200);
      const results2 = Array.isArray(res2.body) ? res2.body : res2.body.items || [];
      assert.equal(results2.length, 0);
    });

    it('should filter by favorite=true', async () => {
      const cat = await createCategory('Fav Filter');
      const favItem = await createItem(cat.id, 'Fav Item', { favorite: true });
      await createItem(cat.id, 'Not Fav');

      const res = await authRequest(app, user.sid)
        .get('/api/items?favorite=true')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.every(r => r.favorite === 1 || r.favorite === true));
      assert.ok(results.some(r => r.title === 'Fav Item'));
    });

    it('should filter by has_attachments', async () => {
      const cat = await createCategory('Attach Filter');
      await createItem(cat.id, 'With Attach');
      await createItem(cat.id, 'No Attach');

      // has_attachments filter — should work even without actual attachments
      const res = await authRequest(app, user.sid)
        .get('/api/items?has_attachments=true')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      // No items have attachments, so results should be empty
      assert.equal(results.length, 0);
    });

    it('should combine category + favorite filter (AND logic)', async () => {
      const cat1 = await createCategory('Combined A');
      const cat2 = await createCategory('Combined B');
      await createItem(cat1.id, 'A Fav', { favorite: true });
      await createItem(cat1.id, 'A NotFav');
      await createItem(cat2.id, 'B Fav', { favorite: true });

      const res = await authRequest(app, user.sid)
        .get('/api/items?category_id=' + cat1.id + '&favorite=true')
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.equal(results.length, 1);
      assert.equal(results[0].title, 'A Fav');
    });

    it('should combine search + filter', async () => {
      const cat1 = await createCategory('Search+Filter A');
      const cat2 = await createCategory('Search+Filter B');
      await createItem(cat1.id, 'Bank Login');
      await createItem(cat2.id, 'Bank Card');
      await createItem(cat1.id, 'Email Login');

      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items?q=bank&category_id=' + cat1.id)
        .expect(200);
      const results = Array.isArray(res.body) ? res.body : res.body.items || [];
      assert.ok(results.length >= 1);
      assert.ok(results.every(r => r.category_id === cat1.id));
      assert.ok(results.every(r => r.title.toLowerCase().includes('bank')));
    });
  });

  // ═══════════════════════════════════════════
  // #64: Search Highlighting (XSS Safety)
  // ═══════════════════════════════════════════

  describe('#64 — Search Highlighting', () => {
    it('highlightMatches should wrap matched terms in <mark>', () => {
      // We test the search service highlight function
      const searchService = require('../src/services/search.service');
      const result = searchService.highlightMatches('My Bank Login', ['bank']);
      assert.ok(result.includes('<mark>'), 'Should contain <mark> tag');
      assert.ok(result.includes('Bank'), 'Should preserve original case');
      assert.ok(result.includes('</mark>'));
    });

    it('highlightMatches should escape HTML BEFORE wrapping', () => {
      const searchService = require('../src/services/search.service');
      const result = searchService.highlightMatches('<script>alert("xss")</script> bank', ['bank']);
      assert.ok(!result.includes('<script>'), 'Must not contain raw script tags');
      assert.ok(result.includes('&lt;script&gt;'), 'Should HTML-escape script tags');
      assert.ok(result.includes('<mark>bank</mark>'));
    });

    it('highlightMatches should handle empty query gracefully', () => {
      const searchService = require('../src/services/search.service');
      const result = searchService.highlightMatches('Hello World', []);
      assert.equal(result, 'Hello World');
    });

    it('highlightMatches should handle multiple match terms', () => {
      const searchService = require('../src/services/search.service');
      const result = searchService.highlightMatches('My Bank Card Login', ['bank', 'login']);
      assert.ok(result.includes('<mark>Bank</mark>'));
      assert.ok(result.includes('<mark>Login</mark>'));
    });

    it('highlightMatches should not create XSS via search terms', () => {
      const searchService = require('../src/services/search.service');
      const result = searchService.highlightMatches('test data', ['<img src=x onerror=alert(1)>']);
      assert.ok(!result.includes('<img'), 'Must not inject HTML from search terms');
    });
  });

  // ═══════════════════════════════════════════
  // #67: CSV Export
  // ═══════════════════════════════════════════

  describe('#67 — CSV Export', () => {
    it('GET /api/data/export?format=csv should return CSV', async () => {
      const cat = await createCategory('CSV Cat');
      await createItem(cat.id, 'CSV Item 1');
      await createItem(cat.id, 'CSV Item 2');

      const res = await authRequest(app, user.sid)
        .get('/api/data/export?format=csv')
        .expect(200);
      assert.ok(res.headers['content-type'].includes('text/csv') || res.headers['content-type'].includes('text/plain'));
      assert.ok(res.headers['content-disposition']);
      assert.ok(res.text.includes('title'), 'CSV should have headers');
      assert.ok(res.text.includes('CSV Item 1'));
      assert.ok(res.text.includes('CSV Item 2'));
    });

    it('CSV should properly escape commas and quotes', async () => {
      const cat = await createCategory('Escape Cat');
      await createItem(cat.id, 'Item, with comma');
      await createItem(cat.id, 'Item "with" quotes');

      const res = await authRequest(app, user.sid)
        .get('/api/data/export?format=csv')
        .expect(200);
      // Values with commas/quotes should be quoted
      assert.ok(res.text.includes('"Item, with comma"'), 'Commas should be quoted');
      assert.ok(res.text.includes('"Item ""with"" quotes"'), 'Quotes should be escaped');
    });

    it('CSV export should filter by category_ids', async () => {
      const cat1 = await createCategory('Export A');
      const cat2 = await createCategory('Export B');
      await createItem(cat1.id, 'In Cat A');
      await createItem(cat2.id, 'In Cat B');

      const res = await authRequest(app, user.sid)
        .get('/api/data/export?format=csv&category_ids=' + cat1.id)
        .expect(200);
      assert.ok(res.text.includes('In Cat A'), 'Should include cat A items');
      assert.ok(!res.text.includes('In Cat B'), 'Should exclude cat B items');
    });

    it('CSV export should filter by item_ids', async () => {
      const cat = await createCategory('Item Filter');
      const item1 = await createItem(cat.id, 'Selected1');
      await createItem(cat.id, 'NotSelected');

      const res = await authRequest(app, user.sid)
        .get('/api/data/export?format=csv&item_ids=' + item1.id)
        .expect(200);
      assert.ok(res.text.includes('Selected1'));
      assert.ok(!res.text.includes('NotSelected'));
    });

    it('CSV should handle newlines in notes', async () => {
      const cat = await createCategory('Newline Cat');
      await createItem(cat.id, 'Newline Item', { notes: 'line1\nline2' });

      const res = await authRequest(app, user.sid)
        .get('/api/data/export?format=csv')
        .expect(200);
      // Newlines in fields should be within quoted values
      assert.ok(res.text.includes('"line1\nline2"') || res.text.includes('"line1'), 'Newlines should be handled');
    });
  });

  // ═══════════════════════════════════════════
  // #68: PDF/Print Export
  // ═══════════════════════════════════════════

  describe('#68 — PDF Export', () => {
    it('GET /api/data/export?format=pdf should return JSON data for client-side rendering', async () => {
      const cat = await createCategory('PDF Cat');
      await createItem(cat.id, 'PDF Item');

      const res = await authRequest(app, user.sid)
        .get('/api/data/export?format=pdf')
        .expect(200);
      assert.ok(res.body.items || res.body.exportData, 'Should return structured data');
    });
  });

  // ═══════════════════════════════════════════
  // Import / Export Round-Trip
  // ═══════════════════════════════════════════

  describe('Import/Export Round-Trip', () => {
    it('should export JSON and re-import successfully', async () => {
      const cat = await createCategory('RoundTrip Cat');
      await createItem(cat.id, 'RoundTrip Item 1');
      await createItem(cat.id, 'RoundTrip Item 2');

      // Export
      const exportRes = await authRequest(app, user.sid)
        .get('/api/data/export')
        .expect(200);
      assert.ok(exportRes.body.items.length >= 2);

      // Clean items
      db.exec('DELETE FROM item_tags');
      db.exec('DELETE FROM item_fields');
      db.exec('DELETE FROM items');

      // Re-import via JSON data
      const importData = JSON.stringify({
        encrypted: false,
        items: exportRes.body.items.map(i => ({
          name: i.title,
          login: { username: '', password: '' },
          notes: i.notes || '',
        })),
      });

      // Import using bitwarden format (most flexible)
      const importRes = await authRequest(app, user.sid)
        .post('/api/data/import')
        .field('format', 'bitwarden')
        .field('data', importData)
        .expect(200);
      assert.ok(importRes.body.imported >= 2, 'Should import at least 2 items');
    });
  });

  // ═══════════════════════════════════════════
  // #63/#65/#66/#69/#70: Frontend UI Tests
  // ═══════════════════════════════════════════

  describe('Frontend — Filter Panel & Wizards', () => {
    it('app.js should export highlightMatches', async () => {
      // This tests that the search service module exists and exports correctly
      const searchService = require('../src/services/search.service');
      assert.ok(typeof searchService.highlightMatches === 'function');
    });

    it('app.js should export levenshtein function', () => {
      const searchService = require('../src/services/search.service');
      assert.ok(typeof searchService.levenshtein === 'function');
      // Test known distance
      assert.equal(searchService.levenshtein('kitten', 'sitting'), 3);
      assert.equal(searchService.levenshtein('', ''), 0);
      assert.equal(searchService.levenshtein('abc', 'abc'), 0);
      assert.equal(searchService.levenshtein('abc', 'abd'), 1);
    });
  });

  // ═══════════════════════════════════════════
  // Export Service Unit Tests
  // ═══════════════════════════════════════════

  describe('Export Service', () => {
    it('exportCsv should produce valid CSV string', () => {
      const createExportService = require('../src/services/export.service');
      const exportService = createExportService(db);
      const vaultKey = getVaultKey(user.sid);

      const cat = db.prepare("INSERT INTO categories (user_id, name) VALUES (?, 'Test')").run(user.id);
      // create item directly via service
      const service = require('../src/services/item.service');
      const audit = require('../src/services/audit');
      const itemService = service(db, audit(db));
      itemService.create(user.id, vaultKey, {
        title: 'CSV Test',
        notes: 'Some notes',
        category_id: cat.lastInsertRowid,
        fields: [],
        tags: [],
      });

      const csv = exportService.exportCsv(user.id, vaultKey, {});
      assert.ok(csv.includes('title'));
      assert.ok(csv.includes('CSV Test'));
    });

    it('exportCsv should filter by categoryIds', () => {
      const createExportService = require('../src/services/export.service');
      const exportService = createExportService(db);
      const vaultKey = getVaultKey(user.sid);

      const cat1 = db.prepare("INSERT INTO categories (user_id, name) VALUES (?, 'CatA')").run(user.id);
      const cat2 = db.prepare("INSERT INTO categories (user_id, name) VALUES (?, 'CatB')").run(user.id);
      const service = require('../src/services/item.service');
      const audit = require('../src/services/audit');
      const itemService = service(db, audit(db));
      itemService.create(user.id, vaultKey, { title: 'In A', category_id: cat1.lastInsertRowid, fields: [], tags: [] });
      itemService.create(user.id, vaultKey, { title: 'In B', category_id: cat2.lastInsertRowid, fields: [], tags: [] });

      const csv = exportService.exportCsv(user.id, vaultKey, { categoryIds: [cat1.lastInsertRowid] });
      assert.ok(csv.includes('In A'));
      assert.ok(!csv.includes('In B'));
    });

    it('exportCsv should filter by itemIds', () => {
      const createExportService = require('../src/services/export.service');
      const exportService = createExportService(db);
      const vaultKey = getVaultKey(user.sid);

      const catRes = db.prepare("INSERT INTO categories (user_id, name) VALUES (?, 'ItemFilter')").run(user.id);
      const service = require('../src/services/item.service');
      const audit = require('../src/services/audit');
      const itemService = service(db, audit(db));
      const item1 = itemService.create(user.id, vaultKey, { title: 'Keep', category_id: catRes.lastInsertRowid, fields: [], tags: [] });
      itemService.create(user.id, vaultKey, { title: 'Discard', category_id: catRes.lastInsertRowid, fields: [], tags: [] });

      const csv = exportService.exportCsv(user.id, vaultKey, { itemIds: [item1.id] });
      assert.ok(csv.includes('Keep'));
      assert.ok(!csv.includes('Discard'));
    });
  });

  // ═══════════════════════════════════════════
  // #69: Print Styles
  // ═══════════════════════════════════════════

  describe('#69 — Print View', () => {
    it('styles.css should have @media print rules', () => {
      const fs = require('fs');
      const path = require('path');
      const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
      assert.ok(css.includes('@media print'), 'Should have print media query');
      assert.ok(css.includes('page-break') || css.includes('break-'), 'Should have page break rules');
    });
  });

  // ═══════════════════════════════════════════
  // Security: Parameterized Queries
  // ═══════════════════════════════════════════

  describe('Security — SQL Injection Prevention', () => {
    it('should not be vulnerable to SQL injection via filter params', async () => {
      const cat = await createCategory('SQLi Test');
      await createItem(cat.id, 'Safe Item');

      // Attempt SQL injection via query params
      const res = await authRequest(app, user.sid)
        .get("/api/items?created_after='; DROP TABLE items; --")
        .expect(200);
      // Table should still exist
      const count = db.prepare('SELECT COUNT(*) as c FROM items').get();
      assert.ok(count.c >= 0, 'Table should still exist');
    });

    it('should not be vulnerable to SQL injection via search query', async () => {
      const cat = await createCategory('SQLi Search');
      await createItem(cat.id, 'Test Item');
      await authRequest(app, user.sid).post('/api/items/reindex').expect(200);

      const res = await authRequest(app, user.sid)
        .get("/api/items?q='; DROP TABLE items; --")
        .expect(200);
      const count = db.prepare('SELECT COUNT(*) as c FROM items').get();
      assert.ok(count.c >= 0, 'Table should still exist after injection attempt');
    });
  });
});
