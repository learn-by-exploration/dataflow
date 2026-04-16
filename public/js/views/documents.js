// ─── DataFlow: Documents View ───
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

// ─── Load data ───
async function loadData() {
  const [rtRes, catRes, tagRes] = await Promise.all([
    api.get('/api/record-types'),
    api.get('/api/categories'),
    api.get('/api/tags'),
  ]);
  const rts = Array.isArray(rtRes) ? rtRes : (rtRes.recordTypes || rtRes || []);
  const rt = rts.find(r => r.name === 'Document');
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
  return `
    <div class="modal-overlay active" id="doc-modal" role="dialog" aria-modal="true" aria-label="${esc(item.id ? 'Edit Document' : 'New Document')}">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${esc(item.id ? 'Edit Document' : 'New Document')}</h2>
          <button class="modal-close" id="doc-modal-close" aria-label="Close modal">
            <span class="material-icons-round">close</span>
          </button>
        </div>
        <div class="form-group">
          <label for="doc-title">Title <span style="color:var(--err)">*</span></label>
          <input type="text" id="doc-title" class="form-input" value="${escA(item.title || '')}"
            placeholder="Document title" required autocomplete="off">
        </div>
        <div class="form-group">
          <label for="doc-doctype">Document Type</label>
          <input type="text" id="doc-doctype" class="form-input" value="${escA(fVal(item, 'Document Type'))}"
            placeholder="e.g. Passport, Certificate, Contract">
        </div>
        <div class="form-group">
          <label for="doc-content">Description / Notes</label>
          <textarea id="doc-content" class="form-input" rows="4"
            placeholder="Description or notes for this document">${esc(item.notes || fVal(item, 'Description') || '')}</textarea>
        </div>
        <div class="form-group">
          <label for="doc-expiry">Expiry Date</label>
          <input type="date" id="doc-expiry" class="form-input" value="${escA(fVal(item, 'Expiry Date'))}">
        </div>
        <div class="form-group">
          <label for="doc-cat">Category <span style="color:var(--err)">*</span></label>
          ${cats.length
            ? `<select id="doc-cat" class="form-input">${catOpts}</select>`
            : `<div id="doc-cat" class="form-input" style="color:var(--txd);background:var(--bg-c);cursor:default">No categories — create one in the Vault first</div>`}
        </div>
        ${allTags.length ? `
        <div class="form-group">
          <label for="doc-tags">Tags
            <span style="font-size:11px;font-weight:400;color:var(--txd)"> (Ctrl/Cmd+click to multi-select)</span>
          </label>
          <select id="doc-tags" class="form-input" multiple style="min-height:80px">${tagOpts}</select>
        </div>` : ''}
        <div class="modal-actions">
          <button class="btn btn-secondary" id="doc-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="doc-modal-save" ${saving ? 'disabled' : ''}>
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
          fVal(i, 'Document Type').toLowerCase().includes(q);
      })
    : items;

  _c.innerHTML = `
    <div class="view-header">
      <h2>Documents</h2>
      <div class="view-actions">
        <input type="text" class="form-input search-inline" id="doc-filter"
          placeholder="Search documents…" value="${escA(filter)}" aria-label="Filter documents">
        <button class="btn btn-primary" id="doc-add">
          <span class="material-icons-round" style="font-size:18px">add</span> Add
        </button>
      </div>
    </div>
    ${!rtId
      ? `<div class="empty-state"><span class="material-icons-round">error_outline</span>
           <p>Document record type not configured in vault.</p></div>`
      : filtered.length
        ? `<div class="item-list">${filtered.map(item => {
            const docType = fVal(item, 'Document Type');
            const expiry = fVal(item, 'Expiry Date');
            const expiryHtml = expiry ? ` · <span>Expires ${esc(formatDate(expiry))}</span>` : '';
            return `<div class="list-card">
              <div class="list-card-icon"><span class="material-icons-round">description</span></div>
              <div class="list-card-body">
                <div class="list-card-title">${esc(item.title)}</div>
                <div class="list-card-sub">
                  ${docType ? `<span class="tag-pill">${esc(docType)}</span>` : ''}
                  ${expiryHtml}
                  ${tagPills(item.tags)}
                </div>
              </div>
              <div class="list-card-actions">
                <span class="list-timestamp">${esc(formatRelative(item.updated_at || item.created_at))}</span>
                <button class="btn-icon doc-edit" title="Edit document" data-id="${esc(String(item.id))}">
                  <span class="material-icons-round" style="font-size:18px">edit</span>
                </button>
                <button class="btn-icon doc-del" title="Delete document" data-id="${esc(String(item.id))}">
                  <span class="material-icons-round" style="font-size:18px">delete_outline</span>
                </button>
              </div>
            </div>`;
          }).join('')}</div>`
        : `<div class="empty-state">
             <span class="material-icons-round">description</span>
             <p>${esc(filter ? 'No matching documents.' : 'No documents yet. Add your first document.')}</p>
           </div>`}
    ${modalHTML()}`;

  wireEvents();
}

// ─── Wire events ───
function wireEvents() {
  _c.querySelector('#doc-add')?.addEventListener('click', () => {
    editing = null; modal = true; render();
  });
  _c.querySelector('#doc-filter')?.addEventListener('input', e => {
    filter = e.target.value;
    if (!modal) render();
  });
  _c.querySelectorAll('.doc-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      editing = items.find(i => i.id === Number(btn.dataset.id)) || null;
      modal = true; render();
    });
  });
  _c.querySelectorAll('.doc-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === Number(btn.dataset.id));
      if (!item || !window.confirm(`Delete "${item.title}"? This action cannot be undone.`)) return;
      try {
        await api.del('/api/items/' + item.id);
        items = items.filter(i => i.id !== item.id);
        toast('Document deleted', 'success');
        render();
      } catch { toast('Failed to delete document', 'error'); }
    });
  });

  const closeModal = () => { modal = false; editing = null; render(); };
  _c.querySelector('#doc-modal-close')?.addEventListener('click', closeModal);
  _c.querySelector('#doc-modal-cancel')?.addEventListener('click', closeModal);
  _c.querySelector('#doc-modal')?.addEventListener('click', e => {
    if (e.target.id === 'doc-modal') closeModal();
  });
  _c.querySelector('#doc-modal-save')?.addEventListener('click', saveItem);
}

// ─── Save item ───
async function saveItem() {
  const title = (_c.querySelector('#doc-title')?.value || '').trim();
  const docType = (_c.querySelector('#doc-doctype')?.value || '').trim();
  const content = (_c.querySelector('#doc-content')?.value || '').trim();
  const expiry = _c.querySelector('#doc-expiry')?.value || '';
  const catEl = _c.querySelector('#doc-cat');
  const tagsEl = _c.querySelector('#doc-tags');

  if (!title) { toast('Title is required', 'error'); _c.querySelector('#doc-title')?.focus(); return; }
  const catId = catEl instanceof HTMLSelectElement ? Number(catEl.value) : 0;
  if (!catId) { toast('Please select a category', 'error'); return; }

  const tagIds = tagsEl ? Array.from(tagsEl.selectedOptions).map(o => Number(o.value)) : [];
  const fields = [];
  const typeDefId = fId('Document Type');
  const descDefId = fId('Description');
  const expiryDefId = fId('Expiry Date');
  if (typeDefId != null) fields.push({ field_def_id: typeDefId, value: docType });
  if (descDefId != null) fields.push({ field_def_id: descDefId, value: content });
  if (expiryDefId != null) fields.push({ field_def_id: expiryDefId, value: expiry });

  saving = true; render();
  try {
    if (editing?.id) {
      await api.put('/api/items/' + editing.id, {
        title, notes: content || null, category_id: catId, fields, tags: tagIds,
      });
    } else {
      await api.post('/api/items', {
        title, notes: content || null, category_id: catId, record_type_id: rtId, fields, tags: tagIds,
      });
    }
    toast(editing?.id ? 'Document updated' : 'Document added', 'success');
    modal = false; editing = null;
    await reloadItems();
  } catch { toast('Failed to save document', 'error'); }
  finally { saving = false; render(); }
}

// ─── Mount (entry point) ───
export async function mount(el) {
  _c = el;
  items = []; rtId = null; fdefs = []; cats = []; allTags = [];
  filter = ''; modal = false; editing = null; saving = false;
  _c.innerHTML = '<div class="empty-state"><p style="color:var(--txd)">Loading documents…</p></div>';
  try { await loadData(); } catch { toast('Failed to load documents', 'error'); }
  render();
}
