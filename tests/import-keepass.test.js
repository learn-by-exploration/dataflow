'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('../src/services/importers/keepass');

describe('Import — KeePass', () => {
  function makeXml(groups) {
    return `<?xml version="1.0" encoding="utf-8"?>
<KeePassFile>
  <Root>
    <Group>
      <Name>Root</Name>
      ${groups}
    </Group>
  </Root>
</KeePassFile>`;
  }

  function makeEntry(title, username, password, url, notes) {
    return `<Entry>
  <String><Key>Title</Key><Value>${title}</Value></String>
  <String><Key>UserName</Key><Value>${username}</Value></String>
  <String><Key>Password</Key><Value>${password}</Value></String>
  <String><Key>URL</Key><Value>${url}</Value></String>
  <String><Key>Notes</Key><Value>${notes}</Value></String>
</Entry>`;
  }

  it('parses a single entry', () => {
    const xml = makeXml(`<Group><Name>General</Name>${makeEntry('My Login', 'user1', 's3cret', 'https://example.com', 'some notes')}</Group>`);
    const result = parse(xml);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'My Login');
    assert.equal(result[0].record_type, 'login');
    assert.equal(result[0].category, 'General');
    assert.equal(result[0].notes, 'some notes');
    const fieldNames = result[0].fields.map(f => f.name);
    assert.ok(fieldNames.includes('url'));
    assert.ok(fieldNames.includes('username'));
    assert.ok(fieldNames.includes('password'));
  });

  it('parses multiple entries in a group', () => {
    const xml = makeXml(`<Group><Name>Web</Name>${makeEntry('A', 'u1', 'p1', 'https://a.com', '')}${makeEntry('B', 'u2', 'p2', 'https://b.com', '')}</Group>`);
    const result = parse(xml);
    assert.equal(result.length, 2);
    assert.equal(result[0].category, 'Web');
    assert.equal(result[1].category, 'Web');
  });

  it('maps group name to category', () => {
    const xml = makeXml(`<Group><Name>Finance</Name>${makeEntry('Bank', 'u', 'p', 'https://bank.com', '')}</Group>`);
    const result = parse(xml);
    assert.equal(result[0].category, 'Finance');
  });

  it('handles nested groups', () => {
    const xml = makeXml(`<Group><Name>Parent</Name><Group><Name>Child</Name>${makeEntry('Nested', 'u', 'p', 'https://x.com', '')}</Group></Group>`);
    const result = parse(xml);
    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'Child');
  });

  it('handles entries with missing fields', () => {
    const xml = makeXml(`<Group><Name>General</Name><Entry>
  <String><Key>Title</Key><Value>Sparse</Value></String>
</Entry></Group>`);
    const result = parse(xml);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Sparse');
  });

  it('returns empty array for empty database', () => {
    const xml = makeXml('');
    const result = parse(xml);
    assert.deepStrictEqual(result, []);
  });

  it('sets defaults for tags and favorite', () => {
    const xml = makeXml(`<Group><Name>General</Name>${makeEntry('Item', 'u', 'p', 'https://x.com', '')}</Group>`);
    const result = parse(xml);
    assert.deepStrictEqual(result[0].tags, []);
    assert.equal(result[0].favorite, false);
  });

  it('throws on invalid XML', () => {
    assert.throws(() => parse('not xml at all'), /parse|invalid|unexpected/i);
  });
});
