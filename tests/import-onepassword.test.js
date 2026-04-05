'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../src/services/importers/onepassword');

describe('Import — 1Password', () => {
  const header = 'Title,Website,Username,Password,Notes,Type';

  it('parses a valid login row', () => {
    const csv = `${header}\nMy Login,https://example.com,user1,p@ss,some notes,Login`;
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
    const csv = `${header}\nA,https://a.com,u1,p1,,Login\nB,https://b.com,u2,p2,,Login`;
    const result = parse(csv);
    assert.equal(result.length, 2);
  });

  it('handles empty fields', () => {
    const csv = `${header}\nEmpty,,,,,Login`;
    const result = parse(csv);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Empty');
  });

  it('stores notes', () => {
    const csv = `${header}\nItem,https://x.com,u,p,my note,Login`;
    const result = parse(csv);
    assert.equal(result[0].notes, 'my note');
  });

  it('sets defaults for category tags favorite', () => {
    const csv = `${header}\nItem,https://x.com,u,p,,Login`;
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
    const csv = `${header}\n"My, Login",https://example.com,user1,p@ss,"note, with comma",Login`;
    const result = parse(csv);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'My, Login');
  });
});
