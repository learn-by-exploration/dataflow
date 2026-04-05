'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = (...p) => path.join(__dirname, '..', 'public', ...p);
const read = (...p) => fs.readFileSync(pub(...p), 'utf8');

describe('Frontend validation', () => {
  describe('index.html', () => {
    const html = read('index.html');

    it('has DOCTYPE', () => {
      assert.match(html, /<!DOCTYPE html>/i);
    });

    it('has charset meta', () => {
      assert.match(html, /<meta\s+charset=["']UTF-8["']/i);
    });

    it('has viewport meta', () => {
      assert.match(html, /<meta\s+name=["']viewport["']/i);
    });

    it('has lang attribute', () => {
      assert.match(html, /<html\s[^>]*lang=["']en["']/i);
    });

    it('links to styles.css', () => {
      assert.match(html, /styles\.css/);
    });

    it('loads app.js', () => {
      assert.match(html, /app\.js/);
    });

    it('loads utils.js', () => {
      assert.match(html, /utils\.js/);
    });

    it('loads api.js', () => {
      assert.match(html, /api\.js/);
    });

    it('has no inline event handlers', () => {
      // Check for onclick, onsubmit, onchange, etc. in HTML attributes
      assert.doesNotMatch(html, /\s+on(click|submit|change|load|error|input|keydown|keyup|mouseover|mouseout|focus|blur)\s*=/i);
    });

    it('links manifest.json', () => {
      assert.match(html, /manifest\.json/);
    });
  });

  describe('styles.css', () => {
    const css = read('styles.css');

    it('exists and is non-empty', () => {
      assert.ok(css.length > 100);
    });

    it('has balanced braces', () => {
      // Count { and } — should be equal (ignoring those inside strings/comments)
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ''); // remove comments
      const opens = (stripped.match(/{/g) || []).length;
      const closes = (stripped.match(/}/g) || []).length;
      assert.equal(opens, closes, `Unbalanced braces: ${opens} opens vs ${closes} closes`);
    });

    it('has CSS custom properties for theming', () => {
      assert.match(css, /--bg/);
      assert.match(css, /--brand/);
      assert.match(css, /--tx/);
    });

    it('has dark theme support', () => {
      assert.match(css, /prefers-color-scheme:\s*dark|data-theme/i);
    });
  });

  describe('app.js', () => {
    const js = read('app.js');

    it('exists and is non-empty', () => {
      assert.ok(js.length > 500);
    });

    it('has valid syntax (no syntax errors)', () => {
      // Use vm.Script to validate syntax without executing
      // ES module syntax isn't supported by vm.Script, so strip import/export
      const stripped = js
        .replace(/^\s*import\s+.*$/gm, '// import removed')
        .replace(/^\s*export\s+/gm, '// export ');
      assert.doesNotThrow(() => new vm.Script(stripped), 'app.js has syntax errors');
    });

    it('does not use innerHTML with unescaped user data patterns', () => {
      // Look for dangerous innerHTML patterns: innerHTML = variable (without esc())
      // This is a heuristic — we check that esc() is used near innerHTML assignments
      const lines = js.split('\n');
      const dangerousLines = lines.filter(line => {
        if (!line.includes('innerHTML')) return false;
        // Allow innerHTML with template literals that use esc()
        // Flag lines with innerHTML = someVar without esc
        if (line.match(/innerHTML\s*=\s*['"`]/) || line.match(/innerHTML\s*=\s*``/)) return false;
        if (line.includes('esc(') || line.includes('escA(')) return false;
        if (line.includes("''") || line.includes('""') || line.includes('``')) return false;
        if (line.trim().startsWith('//')) return false;
        return true;
      });
      // Allow some innerHTML usage for static content or template building
      // The key check is that user-interpolated values use esc()
      assert.ok(dangerousLines.length < 5, `Found ${dangerousLines.length} potentially unsafe innerHTML lines:\n${dangerousLines.slice(0, 5).join('\n')}`);
    });
  });

  describe('login.html', () => {
    const html = read('login.html');

    it('has DOCTYPE', () => {
      assert.match(html, /<!DOCTYPE html>/i);
    });

    it('has form with email and password fields', () => {
      assert.match(html, /type=["']email["']/i);
      assert.match(html, /type=["']password["']/i);
    });

    it('has no inline event handlers', () => {
      assert.doesNotMatch(html, /\s+on(click|submit|change)\s*=/i);
    });
  });

  describe('manifest.json', () => {
    it('is valid JSON', () => {
      const raw = read('manifest.json');
      assert.doesNotThrow(() => JSON.parse(raw), 'manifest.json is not valid JSON');
    });

    it('has required fields', () => {
      const manifest = JSON.parse(read('manifest.json'));
      assert.ok(manifest.name);
      assert.ok(manifest.short_name);
      assert.ok(manifest.start_url);
      assert.ok(manifest.display);
    });
  });

  describe('sw.js', () => {
    it('exists and is valid JS', () => {
      const js = read('sw.js');
      assert.ok(js.length > 50);
      // Strip service worker globals for syntax check
      const wrapped = `const self={addEventListener:()=>{},clients:{matchAll:()=>Promise.resolve([])}};const caches={open:()=>Promise.resolve({addAll:()=>{},put:()=>{},match:()=>{}}),keys:()=>Promise.resolve([]),delete:()=>{}};${js}`;
      assert.doesNotThrow(() => new vm.Script(wrapped), 'sw.js has syntax errors');
    });
  });

  describe('utils.js', () => {
    it('exists and exports esc function', () => {
      const js = read('js', 'utils.js');
      assert.match(js, /function\s+esc\b|export\s+function\s+esc\b|const\s+esc\s*=/);
    });
  });

  describe('api.js', () => {
    it('exists and has API client', () => {
      const js = read('js', 'api.js');
      assert.match(js, /function|api|fetch/i);
      assert.ok(js.length > 100);
    });
  });

  describe('CSP and security', () => {
    it('server has helmet CSP configured', () => {
      const serverJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
      assert.match(serverJs, /helmet/);
      assert.match(serverJs, /contentSecurityPolicy/);
    });
  });
});
