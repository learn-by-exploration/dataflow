// ─── DataFlow: Cross-Vault Search View ───
import { esc, escA, formatRelative, toast } from '../utils.js';
import { api } from '../api.js';

// ─── Module state ───
let _c = null;
let query = '';
let results = [];
let recordTypes = [];
let loading = false;
let searchTimer = null;

// ─── Record type icon lookup ───
const TYPE_ICONS = {
  'Login': 'key',
  'Identity': 'badge',
  'Credit Card': 'credit_card',
  'Bank Account': 'account_balance',
  'Address': 'home',
  'Emergency Contact': 'emergency',
  'Medical': 'medical_services',
  'Vehicle': 'directions_car',
  'WiFi': 'wifi',
  'Software License': 'laptop',
  'Secure Note': 'note',
  'Key-Value': 'lock',
  'Document': 'description',
  'Subscription': 'repeat',
};

function rtName(rtId) {
  const rt = recordTypes.find(r => r.id === rtId);
  return rt ? rt.name : 'Item';
}

function rtIcon(rtId) {
  const name = rtName(rtId);
  return TYPE_ICONS[name] || 'lock';
}

// ─── Load record types ───
async function loadRecordTypes() {
  const res = await api.get('/api/record-types');
  recordTypes = Array.isArray(res) ? res : (res.recordTypes || res || []);
}

// ─── Perform search ───
async function doSearch(q) {
  if (!q || q.trim().length < 2) {
    results = [];
    render();
    return;
  }
  loading = true;
  render();
  try {
    const res = await api.get('/api/items?q=' + encodeURIComponent(q.trim()) + '&limit=50');
    results = Array.isArray(res) ? res : (res.items || []);
  } catch { toast('Search failed', 'error'); results = []; }
  loading = false;
  render();
}

// ─── Group results by record type ───
function groupResults(items) {
  const groups = new Map();
  for (const item of items) {
    const name = rtName(item.record_type_id);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  return groups;
}

// ─── Full render ───
function render() {
  if (!_c) return;
  const grouped = groupResults(results);

  _c.innerHTML = `
    <div class="view-header">
      <h2>Search Vault</h2>
    </div>
    <div class="form-group" style="max-width:560px;margin-bottom:24px">
      <div style="position:relative">
        <span class="material-icons-round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--txd);font-size:20px;pointer-events:none">search</span>
        <input type="search" id="vault-search-input" class="form-input" style="padding-left:40px;font-size:15px"
          value="${escA(query)}" placeholder="Search across all vault items…" aria-label="Search vault" autocomplete="off">
      </div>
      <div style="font-size:12px;color:var(--txd);margin-top:4px">
        Type at least 2 characters to search. Results across passwords, documents, notes, IDs, and more.
      </div>
    </div>
    ${loading
      ? `<div class="empty-state"><p style="color:var(--txd)">Searching…</p></div>`
      : query.trim().length < 2
        ? `<div class="empty-state">
             <span class="material-icons-round">manage_search</span>
             <p>Enter your search query above.</p>
           </div>`
        : results.length === 0
          ? `<div class="empty-state">
               <span class="material-icons-round">search_off</span>
               <p>No results for <strong>${esc(query)}</strong>.</p>
             </div>`
          : `<div>
               <div style="font-size:13px;color:var(--txd);margin-bottom:12px">
                 ${esc(String(results.length))} result${results.length !== 1 ? 's' : ''} for <strong>${esc(query)}</strong>
               </div>
               ${Array.from(grouped.entries()).map(([groupName, groupItems]) => `
               <div class="search-grouped-section">
                 <h3>${esc(groupName)} <span style="font-size:12px;font-weight:400;color:var(--txd)">(${esc(String(groupItems.length))})</span></h3>
                 ${groupItems.map(item => {
                   const icon = rtIcon(item.record_type_id);
                   const sub = item.notes
                     ? item.notes.slice(0, 80) + (item.notes.length > 80 ? '…' : '')
                     : '';
                   return `<div class="search-result-item" data-item-id="${esc(String(item.id))}">
                     <div class="list-card-icon" style="flex-shrink:0">
                       <span class="material-icons-round">${esc(icon)}</span>
                     </div>
                     <div style="flex:1;min-width:0">
                       <div class="search-result-title">${esc(item.title)}</div>
                       ${sub ? `<div class="search-result-sub">${esc(sub)}</div>` : ''}
                     </div>
                     <span class="list-timestamp">${esc(formatRelative(item.updated_at || item.created_at))}</span>
                   </div>`;
                 }).join('')}
               </div>`).join('')}
             </div>`}`;

  wireEvents();
  // Focus search input after render
  const input = _c.querySelector('#vault-search-input');
  if (input && document.activeElement !== input) {
    try { input.focus(); } catch {}
  }
}

// ─── Wire events ───
function wireEvents() {
  _c.querySelector('#vault-search-input')?.addEventListener('input', e => {
    query = e.target.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(query), 300);
  });

  // Navigate to item detail on click
  _c.querySelectorAll('.search-result-item[data-item-id]').forEach(el => {
    el.addEventListener('click', () => {
      location.hash = '#item/' + el.dataset.itemId;
    });
  });
}

// ─── Mount (entry point) ───
export async function mount(el, initialQuery) {
  _c = el;
  results = [];
  loading = false;
  searchTimer = null;
  query = initialQuery || '';

  _c.innerHTML = '<div class="empty-state"><p style="color:var(--txd)">Initializing search…</p></div>';
  try { await loadRecordTypes(); } catch { /* non-fatal, icons will fall back */ }

  if (query) {
    await doSearch(query);
  } else {
    render();
  }
}
