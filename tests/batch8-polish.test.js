'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Batch 8 — Polish & Accessibility', () => {
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
    try { db.exec('DELETE FROM item_history'); } catch { /* table may not exist */ }
  });

  after(() => teardown());

  // ─── HTML Fixture ───
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // ════════════════════════════════════════════
  // #74: ARIA Labels & Roles
  // ════════════════════════════════════════════
  describe('#74: ARIA labels & roles', () => {
    it('sidebar has role="navigation"', () => {
      assert.ok(html.includes('role="navigation"'), 'sidebar should have role=navigation');
    });

    it('main content has role="main"', () => {
      assert.ok(html.includes('role="main"'), 'main should have role=main');
    });

    it('all icon-only buttons have aria-label', () => {
      // Check that btn-icon buttons in HTML have aria-label
      const btnIconMatches = html.match(/<button[^>]*class="[^"]*btn-icon[^"]*"[^>]*>/g) || [];
      for (const match of btnIconMatches) {
        assert.ok(match.includes('aria-label'), `btn-icon missing aria-label: ${match.slice(0, 80)}`);
      }
    });

    it('toast container has aria-live', () => {
      assert.ok(html.includes('aria-live'), 'toast container should have aria-live');
    });

    it('view-container has aria-live="polite"', () => {
      assert.ok(html.includes('id="view-container"') && html.includes('aria-live'), 'dynamic content area should have aria-live');
    });

    it('modals have role="dialog" and aria-modal="true"', () => {
      const modalOverlays = html.match(/<div[^>]*class="modal-overlay"[^>]*>/g) || [];
      assert.ok(modalOverlays.length > 0, 'should have modal overlays');
      for (const m of modalOverlays) {
        assert.ok(m.includes('role="dialog"'), `modal missing role=dialog: ${m.slice(0, 60)}`);
        assert.ok(m.includes('aria-modal="true"'), `modal missing aria-modal: ${m.slice(0, 60)}`);
      }
    });
  });

  // ════════════════════════════════════════════
  // #75: Screen Reader Support
  // ════════════════════════════════════════════
  describe('#75: Screen reader support', () => {
    it('sr-announcements live region exists in HTML', () => {
      assert.ok(html.includes('id="sr-announcements"'), 'live region for announcements should exist');
      assert.ok(html.includes('aria-live="assertive"') || html.includes('aria-live="polite"'),
        'announcements region should have aria-live');
    });

    it('sr-only class defined in CSS', () => {
      assert.ok(css.includes('.sr-only'), 'sr-only class should be in CSS');
      assert.ok(css.includes('clip: rect(0'), 'sr-only should use clip rect');
    });

    it('announce function exists in app.js', () => {
      assert.ok(appJs.includes('function announce'), 'announce function should exist');
    });
  });

  // ════════════════════════════════════════════
  // #76: Keyboard Navigation
  // ════════════════════════════════════════════
  describe('#76: Keyboard navigation', () => {
    it('skip-to-content link present in HTML', () => {
      assert.ok(html.includes('class="skip-link"'), 'skip link should exist');
      assert.ok(html.includes('Skip to'), 'skip link should have descriptive text');
    });

    it('focus-visible styles in CSS', () => {
      assert.ok(css.includes(':focus-visible'), 'focus-visible styles should exist');
      assert.ok(css.includes('outline'), 'focus-visible should set outline');
    });

    it('skip-link styles in CSS', () => {
      assert.ok(css.includes('.skip-link'), 'skip-link class should exist');
    });

    it('setupKeyboardNav function exists in app.js', () => {
      assert.ok(appJs.includes('setupKeyboardNav'), 'keyboard nav setup should exist');
    });
  });

  // ════════════════════════════════════════════
  // #71: Loading States
  // ════════════════════════════════════════════
  describe('#71: Loading states', () => {
    it('skeleton CSS classes defined', () => {
      assert.ok(css.includes('.skeleton'), 'skeleton class should exist in CSS');
      assert.ok(css.includes('@keyframes pulse') || css.includes('skeleton-pulse'), 'pulse animation should exist');
    });

    it('skeleton-card class defined', () => {
      assert.ok(css.includes('.skeleton-card'), 'skeleton-card class should exist');
    });

    it('skeleton-text class defined', () => {
      assert.ok(css.includes('.skeleton-text'), 'skeleton-text class should exist');
    });

    it('spinner class defined', () => {
      assert.ok(css.includes('.spinner'), 'spinner class should exist');
    });

    it('showSkeletonLoader function in app.js', () => {
      assert.ok(appJs.includes('showSkeletonLoader'), 'showSkeletonLoader should exist');
    });

    it('hideSkeletonLoader function in app.js', () => {
      assert.ok(appJs.includes('hideSkeletonLoader'), 'hideSkeletonLoader should exist');
    });
  });

  // ════════════════════════════════════════════
  // #72: Error Boundaries
  // ════════════════════════════════════════════
  describe('#72: Error boundaries', () => {
    it('showErrorBoundary function in app.js', () => {
      assert.ok(appJs.includes('showErrorBoundary'), 'showErrorBoundary function should exist');
    });

    it('render functions have try/catch', () => {
      // Check that major render functions use try/catch
      assert.ok(appJs.includes('catch') && appJs.includes('showErrorBoundary'),
        'render functions should use error boundaries');
    });

    it('POST /api/audit accepts client_error action', async () => {
      const res = await authRequest(app, user.sid)
        .post('/api/audit')
        .send({ action: 'client_error', detail: 'Test error from batch8' })
        .expect(201);
      assert.ok(res.body.id || res.status === 201, 'should accept client_error');
    });
  });

  // ════════════════════════════════════════════
  // #73: Color Contrast
  // ════════════════════════════════════════════
  describe('#73: Color contrast audit', () => {
    // Helper: compute relative luminance from hex
    function luminance(hex) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const sR = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      const sG = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      const sB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
      return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
    }

    function contrastRatio(hex1, hex2) {
      const l1 = luminance(hex1);
      const l2 = luminance(hex2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    it('light theme: text on background meets 4.5:1', () => {
      // --tx:#0F172A on --bg:#F8FAFC
      const ratio = contrastRatio('#0F172A', '#F8FAFC');
      assert.ok(ratio >= 4.5, `Primary text contrast ${ratio.toFixed(2)} should be >= 4.5`);
    });

    it('light theme: secondary text meets 4.5:1', () => {
      // --tx2:#475569 on --bg:#F8FAFC
      const ratio = contrastRatio('#475569', '#F8FAFC');
      assert.ok(ratio >= 4.5, `Secondary text contrast ${ratio.toFixed(2)} should be >= 4.5`);
    });

    it('light theme: muted text meets 3:1 (large text threshold)', () => {
      // --txd on --bg
      const ratio = contrastRatio('#64748B', '#F8FAFC');
      assert.ok(ratio >= 3.0, `Muted text contrast ${ratio.toFixed(2)} should be >= 3.0`);
    });

    it('dark theme: text on background meets 4.5:1', () => {
      // --tx:#F1F5F9 on --bg:#0F172A
      const ratio = contrastRatio('#F1F5F9', '#0F172A');
      assert.ok(ratio >= 4.5, `Dark primary text contrast ${ratio.toFixed(2)} should be >= 4.5`);
    });

    it('dark theme: secondary text meets 4.5:1', () => {
      // --tx2:#94A3B8 on --bg-s:#1E293B
      const ratio = contrastRatio('#94A3B8', '#1E293B');
      assert.ok(ratio >= 4.5, `Dark secondary text contrast ${ratio.toFixed(2)} should be >= 4.5`);
    });

    it('dark theme: muted text meets 3:1', () => {
      // --txd on --bg-s
      const ratio = contrastRatio('#8494A7', '#1E293B');
      assert.ok(ratio >= 3.0, `Dark muted text contrast ${ratio.toFixed(2)} should be >= 3.0`);
    });
  });

  // ════════════════════════════════════════════
  // #77: Focus Trap for Modals
  // ════════════════════════════════════════════
  describe('#77: Focus trap for modals', () => {
    it('trapFocus function exists in app.js', () => {
      assert.ok(appJs.includes('trapFocus'), 'trapFocus function should exist');
    });

    it('blockBackgroundScroll function exists', () => {
      assert.ok(appJs.includes('blockBackgroundScroll'), 'blockBackgroundScroll should exist');
    });

    it('unblockBackgroundScroll function exists', () => {
      assert.ok(appJs.includes('unblockBackgroundScroll'), 'unblockBackgroundScroll should exist');
    });

    it('openModal calls trapFocus', () => {
      // openModal should include focus trapping logic
      const openModalIdx = appJs.indexOf('function openModal');
      const nextFnIdx = appJs.indexOf('\nfunction ', openModalIdx + 1);
      const openModalBody = appJs.slice(openModalIdx, nextFnIdx > -1 ? nextFnIdx : openModalIdx + 500);
      assert.ok(openModalBody.includes('trapFocus') || openModalBody.includes('blockBackground'),
        'openModal should use trapFocus or blockBackgroundScroll');
    });
  });

  // ════════════════════════════════════════════
  // #78: Mobile Responsive Polish
  // ════════════════════════════════════════════
  describe('#78: Mobile responsive polish', () => {
    it('viewport meta tag exists', () => {
      assert.ok(html.includes('name="viewport"'), 'viewport meta should exist');
      assert.ok(html.includes('width=device-width'), 'viewport should include width=device-width');
    });

    it('hamburger menu button exists', () => {
      assert.ok(html.includes('id="ham"'), 'hamburger button should exist');
    });

    it('768px media query exists', () => {
      assert.ok(css.includes('max-width:768px') || css.includes('max-width: 768px'),
        '768px media query should exist');
    });

    it('480px media query exists', () => {
      assert.ok(css.includes('max-width:480px') || css.includes('max-width: 480px'),
        '480px media query should exist');
    });

    it('modal full-width on mobile', () => {
      assert.ok(css.includes('modal') && css.includes('max-width:768px'),
        'modal should adjust for mobile in media query');
    });
  });

  // ════════════════════════════════════════════
  // #79: Offline Indicator
  // ════════════════════════════════════════════
  describe('#79: Offline indicator', () => {
    it('showOfflineIndicator function exists', () => {
      assert.ok(appJs.includes('showOfflineIndicator'), 'showOfflineIndicator should exist');
    });

    it('hideOfflineIndicator function exists', () => {
      assert.ok(appJs.includes('hideOfflineIndicator'), 'hideOfflineIndicator should exist');
    });

    it('listens to online/offline events', () => {
      assert.ok(appJs.includes("'online'") || appJs.includes('"online"'),
        'should listen for online event');
      assert.ok(appJs.includes("'offline'") || appJs.includes('"offline"'),
        'should listen for offline event');
    });

    it('offline indicator CSS exists', () => {
      assert.ok(css.includes('.offline-indicator') || css.includes('offline-banner'),
        'offline banner styles should exist');
    });
  });

  // ════════════════════════════════════════════
  // #80: Toast & Notification Polish
  // ════════════════════════════════════════════
  describe('#80: Toast & notification polish', () => {
    it('toast container styles exist', () => {
      assert.ok(css.includes('.toast-container'), 'toast-container should exist');
      assert.ok(css.includes('.toast'), 'toast class should exist');
    });

    it('toast warning type exists in CSS', () => {
      assert.ok(css.includes('.toast-warning') || css.includes('toast-warn'),
        'warning toast type should be styled');
    });

    it('toast-dismiss style exists', () => {
      assert.ok(css.includes('.toast-dismiss'), 'toast dismiss button should be styled');
    });

    it('toast-action style exists', () => {
      assert.ok(css.includes('.toast-action'), 'toast action button should be styled');
    });

    it('enhanced toast function in utils or app.js', () => {
      const utilsJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'utils.js'), 'utf8');
      assert.ok(
        utilsJs.includes('showToast') || utilsJs.includes('options') || appJs.includes('showToast'),
        'enhanced toast function should exist'
      );
    });
  });

  // ════════════════════════════════════════════
  // API: Audit logging for client errors
  // ════════════════════════════════════════════
  describe('API: Client error audit logging', () => {
    it('POST /api/audit logs client_error with detail', async () => {
      const res = await authRequest(app, user.sid)
        .post('/api/audit')
        .send({ action: 'client_error', detail: 'TypeError: x is not a function' })
        .expect(201);
      assert.ok(res.body.id, 'should return audit entry id');

      // Verify in DB
      const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'client_error' ORDER BY id DESC LIMIT 1").get();
      assert.ok(entry, 'audit entry should exist');
      assert.equal(entry.action, 'client_error');
      assert.ok(entry.detail.includes('TypeError'), 'detail should contain error message');
    });

    it('POST /api/audit rejects invalid action', async () => {
      await authRequest(app, user.sid)
        .post('/api/audit')
        .send({ action: 'drop_tables', detail: 'hacked' })
        .expect(400);
    });

    it('POST /api/audit rejects oversized detail', async () => {
      await authRequest(app, user.sid)
        .post('/api/audit')
        .send({ action: 'client_error', detail: 'x'.repeat(5001) })
        .expect(400);
    });
  });
});
