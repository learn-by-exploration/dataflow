'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../src/services/importers/chrome');

describe('Import — Chrome', () => {
  const header = 'name,url,username,password,note';

  it('parses a valid login row', () => {
    const csv = `${header}\nMy Login,https://example.com,user1,s3cret,`;
    const result = parse(csv);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'My Login');
    assert.equal(result[0].record_type, 'login');
    const fieldNames = result[0].fields.map(f => f.name);
    assert.ok(fieldNames.includes('url'));
    assert.ok(fieldNames.includes('username'));
    assert.ok(fieldNames.includes('password'));
  });

  it('parses multiple rows', () => {
    const csv = `${header}\nA,https://a.com,u1,p1,\nB,https://b.com,u2,p2,`;
    const result = parse(csv);
    assert.equal(result.length, 2);
  });

  it('stores note field', () => {
    const csv = `${header}\nItem,https://x.com,u,p,my note`;
    const result = parse(csv);
    assert.equal(result[0].notes, 'my note');
  });

  it('handles empty note', () => {
    const csv = `${header}\nItem,https://x.com,u,p,`;
    const result = parse(csv);
    assert.equal(result[0].notes, '');
  });

  it('sets defaults for category tags favorite', () => {
    const csv = `${header}\nItem,https://x.com,u,p,`;
    const result = parse(csv);
    assert.equal(result[0].category, null);
    assert.deepStrictEqual(result[0].tags, []);
    assert.equal(result[0].favorite, false);
  });

  it('returns empty array for header-only CSV', () => {
    const result = parse(header);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array for empty string', () => {
    const result = parse('');
    assert.deepStrictEqual(result, []);
  });

  it('handles rows with commas in quoted fields', () => {
    const csv = `${header}\n"My, Login",https://example.com,user1,p@ss,"note, with comma"`;
    const result = parse(csv);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'My, Login');
    assert.equal(result[0].notes, 'note, with comma');
  });
});
