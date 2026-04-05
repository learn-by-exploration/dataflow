'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../src/services/importers/lastpass');

describe('Import — LastPass', () => {
  const header = 'url,username,password,totp,extra,name,grouping,fav';

  it('parses a valid login row', () => {
    const csv = `${header}\nhttps://example.com,user1,s3cret,,notes,My Login,Social,0`;
    const result = parse(csv);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'My Login');
    assert.equal(result[0].record_type, 'login');
    const fieldNames = result[0].fields.map(f => f.name);
    assert.ok(fieldNames.includes('url'));
    assert.ok(fieldNames.includes('username'));
    assert.ok(fieldNames.includes('password'));
  });

  it('maps grouping to category', () => {
    const csv = `${header}\nhttps://x.com,u,p,,,Item,Finance,0`;
    const result = parse(csv);
    assert.equal(result[0].category, 'Finance');
  });

  it('maps fav=1 to favorite=true', () => {
    const csv = `${header}\nhttps://x.com,u,p,,,Fav Item,,1`;
    const result = parse(csv);
    assert.equal(result[0].favorite, true);
  });

  it('maps fav=0 to favorite=false', () => {
    const csv = `${header}\nhttps://x.com,u,p,,,Item,,0`;
    const result = parse(csv);
    assert.equal(result[0].favorite, false);
  });

  it('stores extra as notes', () => {
    const csv = `${header}\nhttps://x.com,u,p,,my extra notes,Item,,0`;
    const result = parse(csv);
    assert.equal(result[0].notes, 'my extra notes');
  });

  it('includes totp field when present', () => {
    const csv = `${header}\nhttps://x.com,u,p,JBSWY3DPEHPK3PXP,,Item,,0`;
    const result = parse(csv);
    const totp = result[0].fields.find(f => f.name === 'totp');
    assert.ok(totp);
    assert.equal(totp.value, 'JBSWY3DPEHPK3PXP');
  });

  it('returns empty array for header only', () => {
    const result = parse(header);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array for empty string', () => {
    const result = parse('');
    assert.deepStrictEqual(result, []);
  });
});
