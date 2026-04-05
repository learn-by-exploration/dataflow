'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  generatePassword,
  generatePassphrase,
  calculateEntropy,
  strengthScore,
} = require('../src/services/password-generator');

describe('Password Generator Service', () => {
  // ─── generatePassword ───

  it('generates a password of default length 16', () => {
    const pw = generatePassword();
    assert.equal(pw.length, 16);
  });

  it('generates a password of custom length', () => {
    const pw = generatePassword({ length: 32 });
    assert.equal(pw.length, 32);
  });

  it('includes only lowercase when other char types disabled', () => {
    const pw = generatePassword({ length: 50, uppercase: false, numbers: false, symbols: false });
    assert.match(pw, /^[a-z]+$/);
  });

  it('includes only uppercase when other char types disabled', () => {
    const pw = generatePassword({ length: 50, lowercase: false, numbers: false, symbols: false });
    assert.match(pw, /^[A-Z]+$/);
  });

  it('includes only numbers when other char types disabled', () => {
    const pw = generatePassword({ length: 50, uppercase: false, lowercase: false, symbols: false });
    assert.match(pw, /^[0-9]+$/);
  });

  it('includes only symbols when other char types disabled', () => {
    const pw = generatePassword({ length: 50, uppercase: false, lowercase: false, numbers: false });
    assert.match(pw, /^[^a-zA-Z0-9]+$/);
  });

  it('includes all character types by default', () => {
    // Generate a long password to ensure all types appear
    const pw = generatePassword({ length: 100 });
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[^a-zA-Z0-9]/);
  });

  it('throws when all character types are disabled', () => {
    assert.throws(() => {
      generatePassword({ uppercase: false, lowercase: false, numbers: false, symbols: false });
    }, /at least one character type/i);
  });

  it('throws when length is less than 1', () => {
    assert.throws(() => {
      generatePassword({ length: 0 });
    }, /length must be at least 1/i);
  });

  it('generates unique passwords each call', () => {
    const passwords = new Set();
    for (let i = 0; i < 20; i++) {
      passwords.add(generatePassword({ length: 32 }));
    }
    // All 20 should be unique (collision probability is negligible)
    assert.equal(passwords.size, 20);
  });

  it('does not use Math.random', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'services', 'password-generator.js'),
      'utf8'
    );
    assert.ok(!src.includes('Math.random'), 'Must use crypto, not Math.random');
  });

  // ─── generatePassphrase ───

  it('generates a passphrase with default 4 words', () => {
    const pp = generatePassphrase();
    const words = pp.split('-');
    assert.equal(words.length, 4);
  });

  it('generates a passphrase with custom word count', () => {
    const pp = generatePassphrase({ words: 6 });
    const words = pp.split('-');
    assert.equal(words.length, 6);
  });

  it('uses custom separator', () => {
    const pp = generatePassphrase({ separator: '.' });
    assert.ok(pp.includes('.'));
    assert.ok(!pp.includes('-'));
  });

  it('capitalizes words by default', () => {
    const pp = generatePassphrase();
    const words = pp.split('-');
    for (const word of words) {
      assert.match(word, /^[A-Z]/);
    }
  });

  it('does not capitalize words when capitalize=false', () => {
    const pp = generatePassphrase({ capitalize: false });
    const words = pp.split('-');
    for (const word of words) {
      assert.match(word, /^[a-z]/);
    }
  });

  // ─── calculateEntropy ───

  it('calculates entropy for lowercase-only password', () => {
    const entropy = calculateEntropy('abcdefgh'); // 8 chars, 26 possible
    const expected = 8 * Math.log2(26);
    assert.ok(Math.abs(entropy - expected) < 0.01);
  });

  it('calculates entropy for mixed-case alphanumeric password', () => {
    const entropy = calculateEntropy('Abc123xy'); // 8 chars, 62 possible
    const expected = 8 * Math.log2(62);
    assert.ok(Math.abs(entropy - expected) < 0.01);
  });

  it('calculates entropy for password with symbols', () => {
    const entropy = calculateEntropy('Abc1!@#x'); // 8 chars, has all types
    // charset: 26 + 26 + 10 + symbols
    assert.ok(entropy > 8 * Math.log2(62)); // must be > alphanumeric-only entropy
  });

  // ─── strengthScore ───

  it('returns 0 for very weak password', () => {
    assert.equal(strengthScore('abc'), 0);
  });

  it('returns 1 for weak password', () => {
    assert.equal(strengthScore('abcdefgh'), 1);
  });

  it('returns 2 for fair password', () => {
    assert.equal(strengthScore('Abcdefgh12'), 2);
  });

  it('returns 3 for strong password', () => {
    assert.equal(strengthScore('Abcdefgh12!@#$'), 3);
  });

  it('returns 4 for very strong password', () => {
    assert.equal(strengthScore('Abcdefgh12!@#$%^&*XyzW'), 4);
  });
});
