'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pub = (...p) => path.join(__dirname, '..', 'public', ...p);
const read = (...p) => fs.readFileSync(pub(...p), 'utf8');

describe('Accessibility', () => {
  describe('Form inputs have labels', () => {
    it('index.html inputs have labels or aria-label', () => {
      const html = read('index.html');
      const inputs = html.match(/<input\b[^>]*>/gi) || [];
      for (const input of inputs) {
        if (input.includes('type="hidden"') || input.includes("type='hidden'")) continue;
        // Each input should have aria-label, aria-labelledby, a corresponding label, or be wrapped in <label>
        const hasAriaLabel = /aria-label(ledby)?=/.test(input);
        const idMatch = input.match(/id=["']([^"']+)["']/);
        let hasLabel = false;
        if (idMatch) {
          const labelPattern = new RegExp(`for=["']${idMatch[1]}["']`, 'i');
          hasLabel = labelPattern.test(html);
          // Also check if wrapped in <label>...</label>
          if (!hasLabel) {
            const wrappedPattern = new RegExp(`<label[^>]*>[^]*?${idMatch[1]}[^]*?</label>`, 'i');
            hasLabel = wrappedPattern.test(html);
          }
        }
        const hasPlaceholder = /placeholder=/.test(input);
        assert.ok(hasAriaLabel || hasLabel || hasPlaceholder,
          `Input missing label: ${input.slice(0, 80)}`);
      }
    });

    it('login.html inputs have labels or aria-label', () => {
      const html = read('login.html');
      const inputs = html.match(/<input\b[^>]*>/gi) || [];
      for (const input of inputs) {
        if (input.includes('type="hidden"') || input.includes("type='hidden'")) continue;
        const hasAriaLabel = /aria-label(ledby)?=/.test(input);
        const idMatch = input.match(/id=["']([^"']+)["']/);
        let hasLabel = false;
        if (idMatch) {
          const labelPattern = new RegExp(`for=["']${idMatch[1]}["']`, 'i');
          hasLabel = labelPattern.test(html);
        }
        assert.ok(hasAriaLabel || hasLabel,
          `Input missing label: ${input.slice(0, 80)}`);
      }
    });
  });

  describe('Buttons have accessible names', () => {
    it('index.html buttons have text or aria-label', () => {
      const html = read('index.html');
      const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
      for (const btn of buttons) {
        const hasAriaLabel = /aria-label=/.test(btn);
        const hasTitle = /title=/.test(btn);
        // Check inner text (strip HTML tags)
        const innerText = btn.replace(/<[^>]+>/g, '').trim();
        const hasText = innerText.length > 0;
        assert.ok(hasAriaLabel || hasTitle || hasText,
          `Button missing accessible name: ${btn.slice(0, 80)}`);
      }
    });
  });

  describe('Color contrast CSS variables', () => {
    it('has distinct text and background variables', () => {
      const css = read('styles.css');
      assert.match(css, /--bg\s*:/);
      assert.match(css, /--tx\s*:/);
      assert.match(css, /--brand\s*:/);
    });
  });

  describe('Focus-visible styles', () => {
    it('has focus-visible rules in CSS', () => {
      const css = read('styles.css');
      assert.match(css, /focus-visible/);
    });
  });

  describe('Skip-to-content link', () => {
    it('has skip-to-content link in index.html', () => {
      const html = read('index.html');
      assert.match(html, /skip.*content|skip-link/i);
    });
  });

  describe('ARIA landmark roles', () => {
    it('has navigation role or nav element', () => {
      const html = read('index.html');
      assert.match(html, /role=["']navigation["']|<nav\b/i);
    });

    it('has main content area', () => {
      const html = read('index.html');
      assert.match(html, /role=["']main["']|<main\b/i);
    });
  });

  describe('Modal accessibility', () => {
    it('modal has aria-modal and role=dialog', () => {
      const html = read('index.html');
      // Check that modal template exists with proper attributes
      assert.match(html, /role=["']dialog["']/i);
      assert.match(html, /aria-modal=["']true["']/i);
    });
  });

  describe('Toast accessibility', () => {
    it('toast container has role=alert or aria-live', () => {
      const html = read('index.html');
      assert.match(html, /role=["']alert["']|aria-live/i);
    });
  });

  describe('Images have alt text', () => {
    it('index.html images have alt attribute', () => {
      const html = read('index.html');
      const imgs = html.match(/<img\b[^>]*>/gi) || [];
      for (const img of imgs) {
        assert.match(img, /alt=/, `Image missing alt: ${img.slice(0, 80)}`);
      }
    });
  });

  describe('Touch targets', () => {
    it('CSS has min-height 44px for interactive elements', () => {
      const css = read('styles.css');
      assert.match(css, /min-height:\s*44px/);
    });
  });
});
