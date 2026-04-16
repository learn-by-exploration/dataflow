// ─── DataFlow: Passwords View ───
import { esc, escA, formatRelative, copyToClipboard, toast } from '../utils.js';
import { api } from '../api.js';

// ─── Module state ───
let _c = null;
let items = [];
let rtId = null;
let fdefs = [];
let cats = [];
let allTags = [];
let filter = '';
let modal = false;
let editing = null;
let saving = false;
let revealedIds = new Set(); // item IDs with password visible

// ─── Field helpers ───
function fId(name) {
  const d = fdefs.find(f => f.name === name);
  return d ? d.id : null;
}

function fVal(item, name) {
  const id = fId(name);
  if (id == null) return '';
  const f = (item.fields || []).find(x => x.field_def_id === id);
  return f ? (f.value || '') : '';
}

function fScore(item, name) {
  const id = fId(name);
  if (id == null) return null;
  const f = (item.fields || []).find(x => x.field_def_id === id);
  return (f && f.strength_score != null) ? f.strength_score : null;
}

function tagPills(itemTags) {
  return (itemTags || []).map(t =>
    `<span class="tag-pill" style="background:${escA(t.color ? t.color + '20' : '')};color:${escA(t.color || '')}">${esc(t.name)}</span>`
  ).join('');
}

// ─── Password strength ───
function clientScore(pw) {
  if (!pw || pw.length < 4) return 0;
  let s = 0;
  if (pw.length >= 8) s += 20;
  if (pw.length >= 12) s += 15;
  if (pw.length >= 16) s += 15;
  if (/[a-z]/.test(pw)) s += 10;
  if (/[A-Z]/.test(pw)) s += 10;
  if (/[0-9]/.test(pw)) s += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) s += 20;
  return Math.min(100, s);
}

function strengthColor(score) {
  if (score == null) return 'var(--bg-h)';
  if (score < 30) return 'var(--err)';
  if (score < 60) return 'var(--warn)';
  if (score < 80) return '#84cc16';
  return 'var(--ok)';
}

function strengthLabel(score) {
  if (score == null) return '';
  if (score < 30) return 'Weak';
  if (score < 60) return 'Fair';
  if (score < 80) return 'Good';
  return 'Strong';
}

function strengthBar(score) {
  const pct = score != null ? score : 0;
  const col = strengthColor(score);
  const lbl = strengthLabel(score);
  return `<div class="pw-strength" title="Strength: ${escA(lbl)}" style="margin-top:4px">
    <div class="pw-strength-bar" style="width:${esc(String(pct))}%;background:${escA(col)}"></div>
  </div>`;
}

// ─── Load data ───
async function loadData() {
  const [rtRes, catRes, tagRes] = await Promise.all([
    api.get('/api/record-types'),
    api.get('/api/categories'),
    api.get('/api/tags'),
  ]);
  const rts = Array.isArray(rtRes) ? rtRes : (rtRes.recordTypes || rtRes || []);
  const rt = rts.find(r => r.name === 'Login');
  cats = Array.isArray(catRes) ? catRes : (catRes.categories || []);
  allTags = Array.isArray(tagRes) ? tagRes : (tagRes.tags || []);
  if (!rt) { rtId = null; return; }
  rtId = rt.id;
  const rtDetail = await api.get('/api/record-types/' + rt.id);
  fdefs = (rtDetail && rtDetail.fields) ? rtDetail.fields : [];
  const res = await api.get('/api/items?record_type_id=' + rt.id + '&limit=100');
  items = Array.isArray(res) ? res : (res.items || []);
}

async function reloadItems() {
  if (!rtId) return;
  const res = await api.get('/api/items?record_type_id=' + rtId + '&limit=100');
  items = Array.isArray(res) ? res : (res.items || []);
}

// ─── Modal HTML ───
function modalHTML() {
  if (!modal) return '';
  const item = editing || {};
  const selCat = item.category_id || (cats[0] && cats[0].id) || '';
  const catOpts = cats.map(c =>
    `<option value="${esc(String(c.id))}" ${String(c.id) === String(selCat) ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  const tagOpts = allTags.map(t =>
    `<option value="${esc(String(t.id))}" ${(item.tags || []).some(tt => tt.id === t.id) ? 'selected' : ''}>${esc(t.name)}</option>`
  ).join('');
  const pwVal = fVal(item, 'Password');
  const pwScore = item.id ? fScore(item, 'Password') : null;
  return `
    <div class="modal-overlay active" id="pw-modal" role="dialog" aria-modal="true" aria-label="${esc(item.id ? 'Edit Password' : 'New Password')}">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${esc(item.id ? 'Edit Password' : 'New Password')}</h2>
          <button class="modal-close" id="pw-modal-close" aria-label="Close modal">
            <span class="material-icons-round">close</span>
          </button>
        </div>
        <div class="form-group">
          <label for="pw-service">Service Name <span style="color:var(--err)">*</span></label>
          <input type="text" id="pw-service" class="form-input" value="${escA(item.title || '')}"
            placeholder="e.g. Google, GitHub, Netflix" autocomplete="off" required>
        </div>
        <div class="form-group">
          <label for="pw-username">Username / Email</label>
          <input type="text" id="pw-username" class="form-input" value="${escA(fVal(item, 'Username'))}"
            placeholder="username or email" autocomplete="username">
        </div>
        <div class="form-group">
          <label for="pw-password">Password</label>
          <div class="pw-wrap">
            <input type="password" id="pw-password" class="form-input" value="${escA(pwVal)}"
              placeholder="Enter password" autocomplete="new-password" style="padding-right:44px">
            <button type="button" class="pw-toggle" id="pw-toggle-modal" aria-label="Toggle password visibility" tabindex="-1">
              <span class="material-icons-round" style="font-size:18px">visibility</span>
            </button>
          </div>
          <div id="pw-modal-strength">${pwScore != null ? strengthBar(pwScore) : ''}</div>
        </div>
        <div class="form-group">
          <label for="pw-url">URL</label>
          <input type="url" id="pw-url" class="form-input" value="${escA(fVal(item, 'URL'))}"
            placeholder="https://example.com" autocomplete="url">
        </div>
        <div class="form-group">
          <label for="pw-notes">Notes</label>
          <textarea id="pw-notes" class="form-input" rows="3" placeholder="Optional notes">${esc(item.notes || '')}</textarea>
        </div>
        <div class="form-group">
          <label for="pw-cat">Category <span style="color:var(--err)">*</span></label>
          ${cats.length
            ? `<select id="pw-cat" class="form-input">${catOpts}</select>`
            : `<div id="pw-cat" class="form-input" style="color:var(--txd);background:var(--bg-c);cursor:default">No categories — create one in the Vault first</div>`}
        </div>
        ${allTags.length ? `
        <div class="form-group">
          <label for="pw-tags">Tags
            <span style="font-size:11px;font-weight:400;color:var(--txd)"> (Ctrl/Cmd+click to multi-select)</span>
          </label>
          <select id="pw-tags" class="form-input" multiple style="min-height:80px">${tagOpts}</select>
        </div>` : ''}
        <div class="modal-actions">
          <button class="btn btn-secondary" id="pw-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="pw-modal-save" ${saving ? 'disabled' : ''}>
            ${saving ? '<span class="spinner"></span> Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>`;
}

// ─── Full render ───
function render() {
  if (!_c) return;
  const filtered = filter
    ? items.filter(i => {
        const q = filter.toLowerCase();
        return (i.title || '').toLowerCase().includes(q) ||
          fVal(i, 'Username').toLowerCase().includes(q) ||
          fVal(i, 'URL').toLowerCase().includes(q);
      })
    : items;

  _c.innerHTML = `
    <div class="view-header">
      <h2>Passwords</h2>
      <div class="view-actions">
        <input type="text" class="form-input search-inline" id="pw-filter"
          placeholder="Search passwords…" value="${escA(filter)}" aria-label="Filter passwords">
        <button class="btn btn-primary" id="pw-add">
          <span class="material-icons-round" style="font-size:18px">add</span> Add
        </button>
      </div>
    </div>
    ${!rtId
      ? `<div class="empty-state"><span class="material-icons-round">error_outline</span>
           <p>Login record type not configured in vault.</p></div>`
      : filtered.length
        ? `<div class="item-list">${filtered.map(item => {
            const username = fVal(item, 'Username');
            const url = fVal(item, 'URL');
            const pwVal = fVal(item, 'Password');
            const score = fScore(item, 'Password');
            const revealed = revealedIds.has(item.id);
            const idStr = esc(String(item.id));
            return `<div class="list-card">
              <div class="list-card-icon"><span class="material-icons-round">key</span></div>
              <div class="list-card-body">
                <div class="list-card-title">${esc(item.title)}</div>
                <div class="list-card-sub">
                  ${username ? `<span>${esc(username)}</span>` : ''}
                  ${url ? `<span style="color:var(--brand)">${esc(url.replace(/^https?:\/\//, '').split('/')[0])}</span>` : ''}
                  ${tagPills(item.tags)}
                </div>
                ${score != null ? `<div style="max-width:120px">${strengthBar(score)}</div>` : ''}
                ${revealed ? `<div class="pw-revealed" data-item="${idStr}" style="font-family:monospace;font-size:12px;color:var(--tx);margin-top:4px;word-break:break-all">${esc(pwVal)}</div>` : ''}
              </div>
              <div class="list-card-actions">
                <span class="list-timestamp">${esc(formatRelative(item.updated_at || item.created_at))}</span>
                <button class="btn-icon pw-reveal" title="${esc(revealed ? 'Hide password' : 'Show password')}" data-id="${idStr}">
                  <span class="material-icons-round" style="font-size:18px">${revealed ? 'visibility_off' : 'visibility'}</span>
                </button>
                <button class="btn-icon pw-copy" title="Copy password" data-id="${idStr}">
                  <span class="material-icons-round" style="font-size:18px">content_copy</span>
                </button>
                <button class="btn-icon pw-edit" title="Edit password" data-id="${idStr}">
                  <span class="material-icons-round" style="font-size:18px">edit</span>
                </button>
                <button class="btn-icon pw-del" title="Delete password" data-id="${idStr}">
                  <span class="material-icons-round" style="font-size:18px">delete_outline</span>
                </button>
              </div>
            </div>`;
          }).join('')}</div>`
        : `<div class="empty-state">
             <span class="material-icons-round">key</span>
             <p>${esc(filter ? 'No matching passwords.' : 'No passwords yet. Add your first password.')}</p>
           </div>`}
    ${modalHTML()}`;

  wireEvents();
}

// ─── Wire events ───
function wireEvents() {
  _c.querySelector('#pw-add')?.addEventListener('click', () => {
    editing = null; modal = true; render();
  });
  _c.querySelector('#pw-filter')?.addEventListener('input', e => {
    filter = e.target.value;
    if (!modal) render();
  });

  // Reveal/hide password toggle in list
  _c.querySelectorAll('.pw-reveal').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      if (revealedIds.has(id)) {
        revealedIds.delete(id);
      } else {
        revealedIds.add(id);
        // Auto-hide after 30 seconds
        setTimeout(() => {
          revealedIds.delete(id);
          if (!modal) render();
        }, 30000);
      }
      if (!modal) render();
    });
  });

  // Copy password to clipboard
  _c.querySelectorAll('.pw-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === Number(btn.dataset.id));
      if (!item) return;
      const pw = fVal(item, 'Password');
      if (!pw) { toast('No password stored', 'info'); return; }
      const ok = await copyToClipboard(pw);
      if (ok) toast('Password copied (auto-clears in 30s)', 'success');
    });
  });

  _c.querySelectorAll('.pw-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      editing = items.find(i => i.id === Number(btn.dataset.id)) || null;
      modal = true; render();
    });
  });

  _c.querySelectorAll('.pw-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === Number(btn.dataset.id));
      if (!item || !window.confirm(`Delete password for "${item.title}"? This cannot be undone.`)) return;
      try {
        await api.del('/api/items/' + item.id);
        items = items.filter(i => i.id !== item.id);
        revealedIds.delete(item.id);
        toast('Password deleted', 'success');
        render();
      } catch { toast('Failed to delete password', 'error'); }
    });
  });

  const closeModal = () => { modal = false; editing = null; render(); };
  _c.querySelector('#pw-modal-close')?.addEventListener('click', closeModal);
  _c.querySelector('#pw-modal-cancel')?.addEventListener('click', closeModal);
  _c.querySelector('#pw-modal')?.addEventListener('click', e => {
    if (e.target.id === 'pw-modal') closeModal();
  });
  _c.querySelector('#pw-modal-save')?.addEventListener('click', saveItem);

  // Modal password visibility toggle
  const pwToggleModal = _c.querySelector('#pw-toggle-modal');
  pwToggleModal?.addEventListener('click', () => {
    const input = _c.querySelector('#pw-password');
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    const icon = pwToggleModal.querySelector('.material-icons-round');
    if (icon) icon.textContent = isHidden ? 'visibility_off' : 'visibility';
  });

  // Live password strength in modal
  _c.querySelector('#pw-password')?.addEventListener('input', e => {
    const score = clientScore(e.target.value);
    const bar = _c.querySelector('#pw-modal-strength');
    if (bar) bar.innerHTML = e.target.value ? strengthBar(score) : '';
  });
}

// ─── Save item ───
async function saveItem() {
  const title = (_c.querySelector('#pw-service')?.value || '').trim();
  const username = (_c.querySelector('#pw-username')?.value || '').trim();
  const password = _c.querySelector('#pw-password')?.value || '';
  const url = (_c.querySelector('#pw-url')?.value || '').trim();
  const notes = (_c.querySelector('#pw-notes')?.value || '').trim();
  const catEl = _c.querySelector('#pw-cat');
  const tagsEl = _c.querySelector('#pw-tags');

  if (!title) { toast('Service name is required', 'error'); _c.querySelector('#pw-service')?.focus(); return; }
  const catId = catEl instanceof HTMLSelectElement ? Number(catEl.value) : 0;
  if (!catId) { toast('Please select a category', 'error'); return; }

  const tagIds = tagsEl ? Array.from(tagsEl.selectedOptions).map(o => Number(o.value)) : [];
  const fields = [];
  const uId = fId('Username');
  const pId = fId('Password');
  const urlId = fId('URL');
  if (uId != null) fields.push({ field_def_id: uId, value: username });
  if (pId != null) fields.push({ field_def_id: pId, value: password });
  if (urlId != null) fields.push({ field_def_id: urlId, value: url });

  saving = true; render();
  try {
    if (editing?.id) {
      await api.put('/api/items/' + editing.id, {
        title, notes: notes || null, category_id: catId, fields, tags: tagIds,
      });
    } else {
      await api.post('/api/items', {
        title, notes: notes || null, category_id: catId, record_type_id: rtId, fields, tags: tagIds,
      });
    }
    toast(editing?.id ? 'Password updated' : 'Password added', 'success');
    modal = false; editing = null;
    await reloadItems();
  } catch { toast('Failed to save password', 'error'); }
  finally { saving = false; render(); }
}

// ─── Mount (entry point) ───
export async function mount(el) {
  _c = el;
  items = []; rtId = null; fdefs = []; cats = []; allTags = [];
  filter = ''; modal = false; editing = null; saving = false;
  revealedIds = new Set();
  _c.innerHTML = '<div class="empty-state"><p style="color:var(--txd)">Loading passwords…</p></div>';
  try { await loadData(); } catch { toast('Failed to load passwords', 'error'); }
  render();
}
