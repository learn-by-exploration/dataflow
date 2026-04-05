'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Release Hygiene', () => {
  it('package.json exists and has valid version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.version, 'package.json should have a version');
    assert.match(pkg.version, /^\d+\.\d+\.\d+/, 'Version should be semver');
    assert.ok(pkg.name, 'package.json should have a name');
  });

  it('CLAUDE.md exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'CLAUDE.md')), 'CLAUDE.md should exist');
  });

  it('CHANGELOG.md exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'CHANGELOG.md')), 'CHANGELOG.md should exist');
  });

  it('README.md exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'README.md')), 'README.md should exist');
  });

  it('SECURITY.md exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'SECURITY.md')), 'SECURITY.md should exist');
  });

  it('CONTRIBUTING.md exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'CONTRIBUTING.md')), 'CONTRIBUTING.md should exist');
  });

  it('LICENSE exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'LICENSE')), 'LICENSE should exist');
  });

  it('Dockerfile exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'Dockerfile')), 'Dockerfile should exist');
  });

  it('docker-compose.yml exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'docker-compose.yml')), 'docker-compose.yml should exist');
  });

  it('.gitignore exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, '.gitignore')), '.gitignore should exist');
  });

  it('no .env file in repo (only .env.example)', () => {
    assert.ok(!fs.existsSync(path.join(ROOT, '.env')), '.env should not be committed');
    assert.ok(fs.existsSync(path.join(ROOT, '.env.example')), '.env.example should exist');
  });
});
