'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = (...p) => path.join(__dirname, '..', 'public', ...p);
const read = (...p) => fs.readFileSync(pub(...p), 'utf8');

// ─────────────────────────────────────────────
// Batch 4: Missing Critical UIs — Frontend Tests
// ─────────────────────────────────────────────

describe('Batch 4 — Missing Critical UIs', () => {
  const html = read('index.html');
  const appJs = read('app.js');
  const css = read('styles.css');

  // Strip ES module syntax for vm.Script validation
  const strippedJs = appJs
    .replace(/^\s*import\s+.*$/gm, '// import removed')
    .replace(/^\s*export\s+/gm, '// export ');

  // ─── #31: Share Item UI ───
  describe('#31 — Share Item UI', () => {
    it('index.html has share modal overlay', () => {
      assert.match(html, /id=["']modal-share["']/);
    });

    it('share modal has member picker select', () => {
      assert.match(html, /id=["']share-member-select["']/);
    });

    it('share modal has permission select', () => {
      assert.match(html, /id=["']share-permission-select["']/);
    });

    it('share modal has share submit button', () => {
      assert.match(html, /id=["']share-submit-btn["']/);
    });

    it('share modal has current shares list container', () => {
      assert.match(html, /id=["']share-current-list["']/);
    });

    it('app.js has openShareModal function', () => {
      assert.match(appJs, /function\s+openShareModal\b/);
    });

    it('app.js has loadShareData function', () => {
      assert.match(appJs, /function\s+loadShareData\b/);
    });

    it('item detail view renders share button', () => {
      // The renderItemDetail function should have a Share button
      assert.match(appJs, /item-share-btn|Share<\/button>/);
    });
  });

  // ─── #32: Share Category UI ───
  describe('#32 — Share Category UI', () => {
    it('app.js has openShareCategoryModal function or reuses openShareModal', () => {
      // Either a dedicated function or openShareModal accepts category type
      assert.match(appJs, /openShareModal|openShareCategoryModal|share.*category/i);
    });

    it('category header renders share icon button', () => {
      assert.match(appJs, /cat-share-btn|category.*share|Share.*category/i);
    });
  });

  // ─── #33: Manage Shares View ───
  describe('#33 — Manage Shares View', () => {
    it('index.html has Shared sidebar nav item', () => {
      assert.match(html, /data-view=["']shared["']/);
    });

    it('sidebar shared item has share icon', () => {
      assert.match(html, /share.*Shared|Shared.*share/is);
    });

    it('app.js has renderSharedView function', () => {
      assert.match(appJs, /function\s+renderSharedView\b/);
    });

    it('app.js router handles shared view', () => {
      assert.match(appJs, /case\s+['"]shared['"]/);
    });

    it('renderSharedView has two tabs: shared by me & shared with me', () => {
      assert.match(appJs, /Shared by me|shared-by-me/i);
      assert.match(appJs, /Shared with me|shared-with-me/i);
    });
  });

  // ─── #34: Emergency Access Request UI ───
  describe('#34 — Emergency Access Request UI', () => {
    it('app.js renders emergency request button in members view', () => {
      assert.match(appJs, /emergency.*request|request.*emergency|Request Emergency Access/i);
    });

    it('index.html has emergency request modal', () => {
      assert.match(html, /id=["']modal-emergency-request["']/);
    });

    it('app.js has emergency status badges rendering', () => {
      assert.match(appJs, /pending|approved|rejected|expired/);
    });
  });

  // ─── #35: Emergency Access Management ───
  describe('#35 — Emergency Access Management', () => {
    it('app.js renders emergency access section in security settings', () => {
      assert.match(appJs, /Emergency Access|emergency-access/i);
    });

    it('security settings has approve/reject buttons for pending requests', () => {
      assert.match(appJs, /emergency.*approve|approve.*emergency/i);
      assert.match(appJs, /emergency.*reject|reject.*emergency/i);
    });

    it('security settings has revoke button for active grants', () => {
      assert.match(appJs, /emergency.*revoke|revoke.*emergency|Cancel/i);
    });
  });

  // ─── #36: Emergency Access Config ───
  describe('#36 — Emergency Access Config', () => {
    it('security settings has emergency wait period input', () => {
      assert.match(appJs, /emergency.wait.days|emergency_wait_days/i);
    });

    it('wait period input saves to settings API', () => {
      assert.match(appJs, /api\/settings\/emergency_wait_days|settings.*emergency/i);
    });
  });

  // ─── #37: Attachment Upload in Item Editor ───
  describe('#37 — Attachment Upload in Item Editor', () => {
    it('app.js renders attachments section in item editor', () => {
      assert.match(appJs, /Attachments|attachments-section|edit-attachments/i);
    });

    it('item editor has file input for attachments', () => {
      assert.match(appJs, /type=["']file["'].*attachment|attachment.*file/i);
    });

    it('app.js has attachment upload function', () => {
      assert.match(appJs, /function\s+uploadAttachment\b|uploadAttachment/);
    });

    it('drag-and-drop zone markup exists', () => {
      assert.match(appJs, /drop-zone|dropzone|drag.*drop|dragover|dragleave/i);
    });
  });

  // ─── #38: Attachment Preview/Download ───
  describe('#38 — Attachment Preview/Download', () => {
    it('item detail view renders attachments list', () => {
      assert.match(appJs, /item-attachments|renderAttachments|attachments.*list/i);
    });

    it('attachments have download links', () => {
      assert.match(appJs, /api\/attachments\/|download.*attachment/i);
    });

    it('attachments have delete buttons', () => {
      assert.match(appJs, /delete.*attachment|attachment.*delete|removeAttachment/i);
    });

    it('app.js has getAttachmentIcon helper', () => {
      assert.match(appJs, /function\s+getAttachmentIcon\b|getAttachmentIcon/);
    });
  });

  // ─── #39: Category Editor UI ───
  describe('#39 — Category Editor UI', () => {
    it('app.js has renderCategoryEditor function', () => {
      assert.match(appJs, /function\s+renderCategoryEditor\b|renderCategoryEditor/);
    });

    it('category editor supports create with name input', () => {
      assert.match(appJs, /cat-name-input|new-cat-name|category.*name/i);
    });

    it('category editor has color picker', () => {
      assert.match(appJs, /type=["']color["'].*cat|cat.*color-picker|category.*color/i);
    });

    it('category editor has delete with confirmation', () => {
      assert.match(appJs, /delete.*category|category.*delete|confirmDeleteCategory/i);
    });
  });

  // ─── #40: Member Profile Edit UI ───
  describe('#40 — Member Profile Edit UI', () => {
    it('index.html has member edit modal', () => {
      assert.match(html, /id=["']modal-member-edit["']/);
    });

    it('member edit modal has display name field', () => {
      assert.match(html, /id=["']member-edit-name["']/);
    });

    it('member edit modal has role dropdown', () => {
      assert.match(html, /id=["']member-edit-role["']/);
    });

    it('app.js has openMemberEditModal function', () => {
      assert.match(appJs, /function\s+openMemberEditModal\b/);
    });

    it('member edit modal shows email and join date as view-only', () => {
      assert.match(appJs, /member.*email|email.*member/i);
      assert.match(appJs, /join.*date|created_at|member.*joined/i);
    });
  });

  // ─── Syntax & Security ───
  describe('Syntax and security validation', () => {
    it('app.js has valid syntax after batch 4 additions', () => {
      assert.doesNotThrow(() => new vm.Script(strippedJs), 'app.js has syntax errors');
    });

    it('styles.css has balanced braces after batch 4 additions', () => {
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const opens = (stripped.match(/{/g) || []).length;
      const closes = (stripped.match(/}/g) || []).length;
      assert.equal(opens, closes, `Unbalanced: ${opens} opens vs ${closes} closes`);
    });
  });
});
