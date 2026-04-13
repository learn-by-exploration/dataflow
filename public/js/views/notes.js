// ─── DataFlow: Secure Notes View ───
import { esc, escA, formatRelative, toast } from '../utils.js';
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
let expandedIds = new Set(); // item IDs with content expanded

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

// Get the note text content (from Content field or item.notes)
function noteContent(item) {
  return fVal(item, 'Content') || item.notes || '';
}

// ─── Load data ───
async function loadData() {
  const [rtRes, catRes, tagRes] = await Promise.all([
    api.get('/api/record-types'),
    api.get('/api/categories'),
    api.get('/api/tags'),
  ]);
  const rts = Array.isArray(rtRes) ? rtRes : (rtRes.recordTypes || rtRes || []);
  const rt = rts.find(r => r.name === 'Secure Note');
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
    <div class="modal-overlay active" id="notes-modal" role="dialog" aria-modal="true" aria-label="${esc(item.id ? 'Edit Note' : 'New Note')}">
      <div class="modal" style="max-width:600px">
        <div class="modal-header">
          <h2 class="modal-title">${esc(item.id ? 'Edit Note' : 'New Secure Note')}</h2>
          <button class="modal-close" id="notes-modal-close" aria-label="Close modal">
            <span class="material-icons-round">close</span>
          </button>
        </div>
        <div class="form-group">
          <label for="notes-title">Title <span style="color:var(--err)">*</span></label>
          <input type="text" id="notes-title" class="form-input" value="${escA(item.title || '')}"
            placeholder="Note title" required autocomplete="off">
        </div>
        <div class="form-group">
          <label for="notes-content">Content <span style="color:var(--err)">*</span></label>
          <textarea id="notes-content" class="form-input" rows="10"
            placeholder="Write your secure note here…">${esc(noteContent(item))}</textarea>
        </div>
        <div class="form-group">
          <label for="notes-cat">Category <span style="color:var(--err)">*</span></label>
          ${cats.length
            ? `<select id="notes-cat" class="form-input">${catOpts}</select>`
            : `<div id="notes-cat" class="form-input" style="color:var(--txd);background:var(--bg-c);cursor:default">No categories — create one in the Vault first</div>`}
        </div>
        ${allTags.length ? `
        <div class="form-group">
          <label for="notes-tags">Tags
            <span style="font-size:11px;font-weight:400;color:var(--txd)"> (Ctrl/Cmd+click to multi-select)</span>
          </label>
          <select id="notes-tags" class="form-input" multiple style="min-height:80px">${tagOpts}</select>
        </div>` : ''}
        <div class="modal-actions">
          <button class="btn btn-secondary" id="notes-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="notes-modal-save" ${saving ? 'disabled' : ''}>
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
          noteContent(i).toLowerCase().includes(q);
      })
    : items;

  _c.innerHTML = `
    <div class="view-header">
      <h2>Secure Notes</h2>
      <div class="view-actions">
        <input type="text" class="form-input search-inline" id="notes-filter"
          placeholder="Search notes…" value="${escA(filter)}" aria-label="Filter notes">
        <button class="btn btn-primary" id="notes-add">
          <span class="material-icons-round" style="font-size:18px">add</span> Add
        </button>
      </div>
    </div>
    ${!rtId
      ? `<div class="empty-state"><span class="material-icons-round">error_outline</span>
           <p>Secure Note record type not configured in vault.</p></div>`
      : filtered.length
        ? `<div class="item-list">${filtered.map(item => {
            const content = noteContent(item);
            const preview = content.slice(0, 100) + (content.length > 100 ? '…' : '');
            const isExpanded = expandedIds.has(item.id);
            const idStr = esc(String(item.id));
            return `<div class="list-card${isExpanded ? ' expanded' : ''}" style="flex-direction:column;align-items:stretch">
              <div style="display:flex;align-items:center;gap:12px">
                <div class="list-card-icon"><span class="material-icons-round">note</span></div>
                <div class="list-card-body" style="min-width:0">
                  <div class="list-card-title">${esc(item.title)}</div>
                  <div class="list-card-sub">
                    ${isExpanded ? '' : `<span style="font-size:12px;color:var(--tx2);white-space:normal">${esc(preview)}</span>`}
                    ${tagPills(item.tags)}
                  </div>
                </div>
                <div class="list-card-actions" style="flex-shrink:0">
                  <span class="list-timestamp">${esc(formatRelative(item.updated_at || item.created_at))}</span>
                  <button class="btn-icon notes-expand" title="${esc(isExpanded ? 'Collapse' : 'Expand content')}" data-id="${idStr}">
                    <span class="material-icons-round" style="font-size:18px">${isExpanded ? 'expand_less' : 'expand_more'}</span>
                  </button>
                  <button class="btn-icon notes-edit" title="Edit note" data-id="${idStr}">
                    <span class="material-icons-round" style="font-size:18px">edit</span>
                  </button>
                  <button class="btn-icon notes-del" title="Delete note" data-id="${idStr}">
                    <span class="material-icons-round" style="font-size:18px">delete_outline</span>
                  </button>
                </div>
              </div>
              ${isExpanded ? `
              <div style="margin-top:12px;padding:12px;background:var(--bg-c);border-radius:var(--rs);font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;color:var(--tx)">
                ${esc(content)}
              </div>` : ''}
            </div>`;
          }).join('')}</div>`
        : `<div class="empty-state">
             <span class="material-icons-round">note</span>
             <p>${esc(filter ? 'No matching notes.' : 'No secure notes yet. Add your first note.')}</p>
           </div>`}
    ${modalHTML()}`;

  wireEvents();
}

// ─── Wire events ───
function wireEvents() {
  _c.querySelector('#notes-add')?.addEventListener('click', () => {
    editing = null; modal = true; render();
  });
  _c.querySelector('#notes-filter')?.addEventListener('input', e => {
    filter = e.target.value;
    if (!modal) render();
  });

  // Expand/collapse note
  _c.querySelectorAll('.notes-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      if (expandedIds.has(id)) {
        expandedIds.delete(id);
      } else {
        expandedIds.add(id);
      }
      if (!modal) render();
    });
  });

  _c.querySelectorAll('.notes-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      editing = items.find(i => i.id === Number(btn.dataset.id)) || null;
      modal = true; render();
    });
  });

  _c.querySelectorAll('.notes-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = items.find(i => i.id === Number(btn.dataset.id));
      if (!item || !window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
      try {
        await api.del('/api/items/' + item.id);
        items = items.filter(i => i.id !== item.id);
        expandedIds.delete(item.id);
        toast('Note deleted', 'success');
        render();
      } catch { toast('Failed to delete note', 'error'); }
    });
  });

  const closeModal = () => { modal = false; editing = null; render(); };
  _c.querySelector('#notes-modal-close')?.addEventListener('click', closeModal);
  _c.querySelector('#notes-modal-cancel')?.addEventListener('click', closeModal);
  _c.querySelector('#notes-modal')?.addEventListener('click', e => {
    if (e.target.id === 'notes-modal') closeModal();
  });
  _c.querySelector('#notes-modal-save')?.addEventListener('click', saveItem);
}

// ─── Save item ───
async function saveItem() {
  const title = (_c.querySelector('#notes-title')?.value || '').trim();
  const content = (_c.querySelector('#notes-content')?.value || '').trim();
  const catEl = _c.querySelector('#notes-cat');
  const tagsEl = _c.querySelector('#notes-tags');

  if (!title) { toast('Title is required', 'error'); _c.querySelector('#notes-title')?.focus(); return; }
  if (!content) { toast('Content is required', 'error'); _c.querySelector('#notes-content')?.focus(); return; }
  const catId = catEl instanceof HTMLSelectElement ? Number(catEl.value) : 0;
  if (!catId) { toast('Please select a category', 'error'); return; }

  const tagIds = tagsEl ? Array.from(tagsEl.selectedOptions).map(o => Number(o.value)) : [];
  const fields = [];
  const contentDefId = fId('Content');
  if (contentDefId != null) fields.push({ field_def_id: contentDefId, value: content });

  saving = true; render();
  try {
    if (editing?.id) {
      await api.put('/api/items/' + editing.id, {
        title, notes: content, category_id: catId, fields, tags: tagIds,
      });
    } else {
      await api.post('/api/items', {
        title, notes: content, category_id: catId, record_type_id: rtId, fields, tags: tagIds,
      });
    }
    toast(editing?.id ? 'Note updated' : 'Note added', 'success');
    modal = false; editing = null;
    await reloadItems();
  } catch { toast('Failed to save note', 'error'); }
  finally { saving = false; render(); }
}

// ─── Mount (entry point) ───
export async function mount(el) {
  _c = el;
  items = []; rtId = null; fdefs = []; cats = []; allTags = [];
  filter = ''; modal = false; editing = null; saving = false;
  expandedIds = new Set();
  _c.innerHTML = '<div class="empty-state"><p style="color:var(--txd)">Loading notes…</p></div>';
  try { await loadData(); } catch { toast('Failed to load notes', 'error'); }
  render();
}
