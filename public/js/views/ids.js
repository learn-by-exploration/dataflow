// ─── DataFlow: IDs / Identity Documents View ───
import { esc, escA, formatDate, formatRelative, toast } from '../utils.js';
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

function tagPills(itemTags) {
  return (itemTags || []).map(t =>
    `<span class="tag-pill" style="background:${escA(t.color ? t.color + '20' : '')};color:${escA(t.color || '')}">${esc(t.name)}</span>`
  ).join('');
}

// ─── Expiry helpers ───
function expiryStatus(dateStr) {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  const now = new Date();
  const diffDays = Math.floor((expiry - now) / 86400000);
  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'warning';
  return 'ok';
}

function expiryBadge(dateStr) {
  const status = expiryStatus(dateStr);
  if (!status || status === 'ok') {
    return dateStr ? `<span style="font-size:12px;color:var(--txd)">Expires ${esc(formatDate(dateStr))}</span>` : '';
  }
  if (status === 'expired') {
    return `<span class="expiry-expired" style="font-size:12px">
      <span class="material-icons-round" style="font-size:14px;vertical-align:-3px">warning</span>
      Expired ${esc(formatDate(dateStr))}
    </span>`;
  }
  // warning (expiring within 30 days)
  return `<span class="expiry-warn" style="font-size:12px">
    <span class="material-icons-round" style="font-size:14px;vertical-align:-3px">schedule</span>
    Expires ${esc(formatDate(dateStr))} (soon)
  </span>`;
}

// ─── Load data ───
async function loadData() {
  const [rtRes, catRes, tagRes] = await Promise.all([
    api.get('/api/record-types'),
    api.get('/api/categories'),
    api.get('/api/tags'),
  ]);
  const rts = Array.isArray(rtRes) ? rtRes : (rtRes.recordTypes || rtRes || []);
  const rt = rts.find(r => r.name === 'Identity');
  cats = Array.isArray(catRes) ? catRes : (catRes.categories || []);
  allTags = Array.isArray(tagRes) ? tagRes : (tagRes.tags || []);
  if (!rt) { rtId = null; return; }
  rtId = rt.id;
  const rtDetail = await api.get('/api/record-types/' + rt.id);
  fdefs = (rtDetail && rtDetail.fields) ? rtDetail.fields : [];
  const res = await api.get('/api/items?record_type_id=' + rt.id + '&limit=200');
  items = Array.isArray(res) ? res : (res.items || []);
}

async function reloadItems() {
  if (!rtId) return;
  const res = await api.get('/api/items?record_type_id=' + rtId + '&limit=200');
  items = Array.isArray(res) ? res : (res.items || []);
}

// ─── Modal field options ───
const ID_TYPES = ['Passport', 'Driver License', 'National ID', 'Social Security', 'Tax ID', 'Other'];

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
  const curIdType = fVal(item, 'ID Type') || '';
  const idTypeOpts = ID_TYPES.map(t =>
    `<option value="${esc(t)}" ${t === curIdType ? 'selected' : ''}>${esc(t)}</option>`
  ).join('');
  return `
    <div class="modal-overlay active" id="ids-modal" role="dialog" aria-modal="true" aria-label="${esc(item.id ? 'Edit ID' : 'New ID')}">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${esc(item.id ? 'Edit Identity Document' : 'New Identity Document')}</h2>
          <button class="modal-close" id="ids-modal-close" aria-label="Close modal">
            <span class="material-icons-round">close</span>
          </button>
        </div>
        <div class="form-group">
          <label for="ids-title">Document Name <span style="color:var(--err)">*</span></label>
          <input type="text" id="ids-title" class="form-input" value="${escA(item.title || '')}"
            placeholder="e.g. My Passport, Driver's License" required autocomplete="off">
        </div>
        <div class="form-group">
          <label for="ids-idtype">ID Type</label>
          <select id="ids-idtype" class="form-input">
            <option value="">— Select type —</option>
            ${idTypeOpts}
          </select>
        </div>
        <div class="form-group">
          <label for="ids-fullname">Full Name <span style="color:var(--err)">*</span></label>
          <input type="text" id="ids-fullname" class="form-input" value="${escA(fVal(item, 'Full Name'))}"
            placeholder="Full legal name" autocomplete="name">
        </div>
        <div class="form-group">
          <label for="ids-idnum">ID Number <span style="color:var(--err)">*</span></label>
          <input type="text" id="ids-idnum" class="form-input" value="${escA(fVal(item, 'ID Number'))}"
            placeholder="ID/Document number" autocomplete="off">
        </div>
        <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label for="ids-issue">Issue Date</label>
            <input type="date" id="ids-issue" class="form-input" value="${escA(fVal(item, 'Issue Date'))}">
          </div>
          <div>
            <label for="ids-expiry">Expiry Date</label>
            <input type="date" id="ids-expiry" class="form-input" value="${escA(fVal(item, 'Expiry Date'))}">
          </div>
        </div>
        <div class="form-group">
          <label for="ids-authority">Issuing Authority</label>
          <input type="text" id="ids-authority" class="form-input" value="${escA(fVal(item, 'Issuing Authority'))}"
            placeholder="Government department or agency">
        </div>
        <div class="form-group">
          <label for="ids-notes">Notes</label>
          <textarea id="ids-notes" class="form-input" rows="3"
            placeholder="Additional notes">${esc(item.notes || '')}</textarea>
        </div>
        <div class="form-group">
          <label for="ids-cat">Category <span style="color:var(--err)">*</span></label>
          ${cats.length
            ? `<select id="ids-cat" class="form-input">${catOpts}</select>`
            : `<div id="ids-cat" class="form-input" style="color:var(--txd);background:var(--bg-c);cursor:default">No categories — create one in the Vault first</div>`}
        </div>
        ${allTags.length ? `
        <div class="form-group">
          <label for="ids-tags">Tags
            <span style="font-size:11px;font-weight:400;color:var(--txd)"> (Ctrl/Cmd+click to multi-select)</span>
          </label>
          <select id="ids-tags" class="form-input" multiple style="min-height:80px">${tagOpts}</select>
        </div>` : ''}
        <div class="modal-actions">
          <button class="btn btn-secondary" id="ids-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="ids-modal-save" ${saving ? 'disabled' : ''}>
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
          fVal(i, 'Full Name').toLowerCase().includes(q) ||
          fVal(i, 'ID Type').toLowerCase().includes(q);
      })
    : items;

  _c.innerHTML = `
    <div class="view-header">
      <h2>Identity Documents</h2>
      <div class="view-actions">
        <input type="text" class="form-input search-inline" id="ids-filter"
          placeholder="Search IDs…" value="${escA(filter)}" aria-label="Filter identity documents">
        <button class="btn btn-primary" id="ids-add">
          <span class="material-icons-round" style="font-size:18px">add</span> Add
        </button>
      </div>
    </div>
    ${!rtId
      ? `<div class="empty-state"><span class="material-icons-round">error_outline</span>
           <p>Identity record type not configured in vault.</p></div>`
      : filtered.length
        ? `<div class="item-list">${filtered.map(item => {
            const idType = fVal(item, 'ID Type');
            const fullName = fVal(item, 'Full Name');
            const idNum = fVal(item, 'ID Number');
            const expiryStr = fVal(item, 'Expiry Date');
            const status = expiryStatus(expiryStr);
            const cardBorder = status === 'expired'
              ? 'border-left:3px solid var(--err)'
              : status === 'warning'
                ? 'border-left:3px solid var(--warn)'
                : '';
            const idStr = esc(String(item.id));
            return `<div class="list-card" style="${escA(cardBorder)}">
              <div class="list-card-icon" style="${escA(status === 'expired' ? 'background:var(--err)20;color:var(--err)' : status === 'warning' ? 'background:var(--warn)20;color:var(--warn)' : '')}">
                <span class="material-icons-round">badge</span>
              </div>
              <div class="list-card-body">
                <div class="list-card-title">${esc(item.title)}</div>
                <div class="list-card-sub">
                  ${idType ? `<span class="tag-pill">${esc(idType)}</span>` : ''}
                  ${fullName ? `<span>${esc(fullName)}</span>` : ''}
                  ${idNum ? `<span style="font-family:monospace;font-size:11px;color:var(--txd)">·· ${esc(idNum.slice(-4))}</span>` : ''}
                  ${expiryBadge(expiryStr)}
                  ${tagPills(item.tags)}
                </div>
              </div>
              <div class="list-card-actions">
                <span class="list-timestamp">${esc(formatRelative(item.updated_at || item.created_at))}</span>
                <button class="btn-icon ids-edit" title="Edit ID" data-id="${idStr}">
                  <span class="material-icons-round" style="font-size:18px">edit</span>
                </button>
                <button class="btn-icon ids-del" title="Delete ID" data-id="${idStr}">
                  <span class="material-icons-round" style="font-size:18px">delete_outline</span>
                </button>
              </div>
            </div>`;
          }).join('')}</div>`
        : `<div class="empty-state">
             <span class="material-icons-round">badge</span>
             <p>${esc(filter ? 'No matching IDs.' : 'No IDs yet. Add your first identity document.')}</p>
           </div>`}
    ${modalHTML()}`;

  wireEvents();
}

// ─── Wire events ───
function wireEvents() {
  _c.querySelector('#ids-add')?.addEventListener('click', () => {
    editing = null; modal = true; render();
  });
  _c.querySelector('#ids-filter')?.addEventListener('input', e => {
    filter = e.target.value;
    if (!modal) render();
  });
  _c.querySelectorAll('.ids-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      editing = items.find(i => i.id === Number(btn.dataset.id)) || null;
      modal = true; render();
    });
  });
  _c.querySelectorAll('.ids-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === Number(btn.dataset.id));
      if (!item || !window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
      try {
        await api.del('/api/items/' + item.id);
        items = items.filter(i => i.id !== item.id);
        toast('ID document deleted', 'success');
        render();
      } catch { toast('Failed to delete ID', 'error'); }
    });
  });

  const closeModal = () => { modal = false; editing = null; render(); };
  _c.querySelector('#ids-modal-close')?.addEventListener('click', closeModal);
  _c.querySelector('#ids-modal-cancel')?.addEventListener('click', closeModal);
  _c.querySelector('#ids-modal')?.addEventListener('click', e => {
    if (e.target.id === 'ids-modal') closeModal();
  });
  _c.querySelector('#ids-modal-save')?.addEventListener('click', saveItem);
}

// ─── Save item ───
async function saveItem() {
  const title = (_c.querySelector('#ids-title')?.value || '').trim();
  const idType = _c.querySelector('#ids-idtype')?.value || '';
  const fullName = (_c.querySelector('#ids-fullname')?.value || '').trim();
  const idNum = (_c.querySelector('#ids-idnum')?.value || '').trim();
  const issueDate = _c.querySelector('#ids-issue')?.value || '';
  const expiryDate = _c.querySelector('#ids-expiry')?.value || '';
  const authority = (_c.querySelector('#ids-authority')?.value || '').trim();
  const notes = (_c.querySelector('#ids-notes')?.value || '').trim();
  const catEl = _c.querySelector('#ids-cat');
  const tagsEl = _c.querySelector('#ids-tags');

  if (!title) { toast('Document name is required', 'error'); _c.querySelector('#ids-title')?.focus(); return; }
  if (!fullName) { toast('Full name is required', 'error'); _c.querySelector('#ids-fullname')?.focus(); return; }
  if (!idNum) { toast('ID number is required', 'error'); _c.querySelector('#ids-idnum')?.focus(); return; }
  const catId = catEl instanceof HTMLSelectElement ? Number(catEl.value) : 0;
  if (!catId) { toast('Please select a category', 'error'); return; }

  const tagIds = tagsEl ? Array.from(tagsEl.selectedOptions).map(o => Number(o.value)) : [];
  const fields = [];
  const mapping = [
    ['Full Name', fullName],
    ['ID Number', idNum],
    ['ID Type', idType],
    ['Issue Date', issueDate],
    ['Expiry Date', expiryDate],
    ['Issuing Authority', authority],
  ];
  for (const [name, val] of mapping) {
    const defId = fId(name);
    if (defId != null) fields.push({ field_def_id: defId, value: val });
  }

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
    toast(editing?.id ? 'ID updated' : 'ID added', 'success');
    modal = false; editing = null;
    await reloadItems();
  } catch { toast('Failed to save ID', 'error'); }
  finally { saving = false; render(); }
}

// ─── Mount (entry point) ───
export async function mount(el) {
  _c = el;
  items = []; rtId = null; fdefs = []; cats = []; allTags = [];
  filter = ''; modal = false; editing = null; saving = false;
  _c.innerHTML = '<div class="empty-state"><p style="color:var(--txd)">Loading identity documents…</p></div>';
  try { await loadData(); } catch { toast('Failed to load identity documents', 'error'); }
  render();
}
