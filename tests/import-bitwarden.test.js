'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../src/services/importers/bitwarden');

describe('Import — Bitwarden', () => {
  const makeExport = (items = [], folders = []) =>
    JSON.stringify({ encrypted: false, folders, items });

  it('parses a login item (type 1)', () => {
    const data = makeExport([{
      type: 1,
      name: 'My Login',
      notes: 'some notes',
      favorite: true,
      folderId: null,
      login: { uris: [{ uri: 'https://example.com' }], username: 'user1', password: 's3cret', totp: 'JBSWY3DPEHPK3PXP' },
    }]);
    const result = parse(data);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'My Login');
    assert.equal(result[0].record_type, 'login');
    assert.equal(result[0].notes, 'some notes');
    assert.equal(result[0].favorite, true);
    const fieldNames = result[0].fields.map(f => f.name);
    assert.ok(fieldNames.includes('url'));
    assert.ok(fieldNames.includes('username'));
    assert.ok(fieldNames.includes('password'));
    assert.ok(fieldNames.includes('totp'));
  });

  it('parses a secure note (type 2)', () => {
    const data = makeExport([{
      type: 2,
      name: 'My Note',
      notes: 'secret note content',
      favorite: false,
      folderId: null,
      secureNote: { type: 0 },
    }]);
    const result = parse(data);
    assert.equal(result.length, 1);
    assert.equal(result[0].record_type, 'secure_note');
    assert.equal(result[0].notes, 'secret note content');
  });

  it('parses a card (type 3)', () => {
    const data = makeExport([{
      type: 3,
      name: 'My Card',
      notes: null,
      favorite: false,
      folderId: null,
      card: { cardholderName: 'John Doe', number: '4111111111111111', expMonth: '12', expYear: '2025', code: '123', brand: 'Visa' },
    }]);
    const result = parse(data);
    assert.equal(result.length, 1);
    assert.equal(result[0].record_type, 'card');
    const fieldNames = result[0].fields.map(f => f.name);
    assert.ok(fieldNames.includes('cardholder_name'));
    assert.ok(fieldNames.includes('number'));
    assert.ok(fieldNames.includes('expiry'));
    assert.ok(fieldNames.includes('cvv'));
  });

  it('parses an identity (type 4)', () => {
    const data = makeExport([{
      type: 4,
      name: 'My Identity',
      notes: null,
      favorite: false,
      folderId: null,
      identity: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '555-1234' },
    }]);
    const result = parse(data);
    assert.equal(result.length, 1);
    assert.equal(result[0].record_type, 'identity');
    const fieldNames = result[0].fields.map(f => f.name);
    assert.ok(fieldNames.includes('first_name'));
    assert.ok(fieldNames.includes('last_name'));
    assert.ok(fieldNames.includes('email'));
    assert.ok(fieldNames.includes('phone'));
  });

  it('maps folders to categories', () => {
    const data = makeExport(
      [{ type: 1, name: 'Item1', notes: null, favorite: false, folderId: 'f1', login: { username: 'u', password: 'p', uris: [], totp: null } }],
      [{ id: 'f1', name: 'Social' }]
    );
    const result = parse(data);
    assert.equal(result[0].category, 'Social');
  });

  it('handles missing login fields gracefully', () => {
    const data = makeExport([{
      type: 1,
      name: 'Sparse Login',
      notes: null,
      favorite: false,
      folderId: null,
      login: { uris: [], username: null, password: null, totp: null },
    }]);
    const result = parse(data);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Sparse Login');
  });

  it('handles multiple items', () => {
    const data = makeExport([
      { type: 1, name: 'L1', notes: null, favorite: false, folderId: null, login: { username: 'u1', password: 'p1', uris: [], totp: null } },
      { type: 2, name: 'N1', notes: 'note', favorite: false, folderId: null, secureNote: { type: 0 } },
      { type: 3, name: 'C1', notes: null, favorite: false, folderId: null, card: { cardholderName: 'J', number: '4111', expMonth: '1', expYear: '2026', code: '321', brand: 'Visa' } },
    ]);
    const result = parse(data);
    assert.equal(result.length, 3);
  });

  it('returns empty array for export with no items', () => {
    const data = makeExport([]);
    const result = parse(data);
    assert.deepStrictEqual(result, []);
  });

  it('handles items with no folder gracefully', () => {
    const data = makeExport([{
      type: 1, name: 'No Folder', notes: null, favorite: false, folderId: null,
      login: { username: 'u', password: 'p', uris: [], totp: null },
    }]);
    const result = parse(data);
    assert.equal(result[0].category, null);
  });

  it('handles unknown item types', () => {
    const data = makeExport([{
      type: 99, name: 'Unknown', notes: null, favorite: false, folderId: null,
    }]);
    const result = parse(data);
    assert.equal(result.length, 1);
    assert.equal(result[0].record_type, 'secure_note');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parse('not json'), /parse|invalid|unexpected/i);
  });

  it('throws on malformed export (missing items key)', () => {
    assert.throws(() => parse(JSON.stringify({ folders: [] })), /invalid|missing|items/i);
  });

  it('sets tags to empty array', () => {
    const data = makeExport([{
      type: 1, name: 'Tagged', notes: null, favorite: false, folderId: null,
      login: { username: 'u', password: 'p', uris: [], totp: null },
    }]);
    const result = parse(data);
    assert.deepStrictEqual(result[0].tags, []);
  });

  it('handles login with multiple URIs', () => {
    const data = makeExport([{
      type: 1, name: 'Multi URI', notes: null, favorite: false, folderId: null,
      login: { uris: [{ uri: 'https://a.com' }, { uri: 'https://b.com' }], username: 'u', password: 'p', totp: null },
    }]);
    const result = parse(data);
    const urlField = result[0].fields.find(f => f.name === 'url');
    assert.ok(urlField);
    assert.equal(urlField.value, 'https://a.com');
  });

  it('favorite defaults to false when missing', () => {
    const data = makeExport([{
      type: 1, name: 'No Fav', notes: null, folderId: null,
      login: { username: 'u', password: 'p', uris: [], totp: null },
    }]);
    const result = parse(data);
    assert.equal(result[0].favorite, false);
  });
});
