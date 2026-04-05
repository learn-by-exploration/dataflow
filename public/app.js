// ─── DataFlow Main Application ───
// SPA router, views, and UI logic.

import { esc, escA, $, formatDate, formatRelative, copyToClipboard, toast, debounce } from './js/utils.js';
import { api, getCsrfToken } from './js/api.js';

// ─── STATE ───
let categories = [], items = [], tags = [], recordTypes = [];
let members = [], auditLog = [];
let currentView = 'dashboard';
let currentUser = null;
let vaultLocked = false;
let autoLockTimer = null;
let autoLockMs = 5 * 60 * 1000; // 5 minutes default
let searchQuery = '';
let editingItem = null;
let currentCategoryId = null;
let auditPage = 1;
const AUDIT_PAGE_SIZE = 25;

// ─── INIT ───
document.addEventListener('DOMContentLoaded', init);

async function init() {
  initTheme();
  initSidebar();
  initModals();
  initKeyboardShortcuts();
  initSearch();
  initLockScreen();
  initAutoLock();
  initPasswordGenerator();

  try {
    await loadCurrentUser();
    if (!currentUser) return;
    await loadData();
    route();
    window.addEventListener('hashchange', route);
  } catch (e) {
    window.location.href = '/login.html';
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ─── AUTH ───
async function loadCurrentUser() {
  const data = await api.get('/api/auth/me');
  if (data && data.user) {
    currentUser = data.user;
    const nameEl = $('sb-user-name');
    if (nameEl) nameEl.textContent = esc(data.user.display_name || data.user.email);
    const avatarEl = $('sb-avatar');
    if (avatarEl) avatarEl.textContent = (data.user.display_name || data.user.email || 'U')[0].toUpperCase();

    // Show admin sections
    const adminSection = $('sb-admin-section');
    if (adminSection && (data.user.role === 'admin' || data.user.role === 'adult')) {
      adminSection.style.display = '';
    }
  } else {
    window.location.href = '/login.html';
  }
}

function initLogout() {
  const btn = $('sb-logout-btn');
  if (btn) btn.addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch {}
    window.location.href = '/login.html';
  });
}

// ─── DATA LOADING ───
async function loadData() {
  const [catRes, typesRes, tagsRes] = await Promise.all([
    api.get('/api/categories'),
    api.get('/api/record-types'),
    api.get('/api/tags'),
  ]);
  categories = catRes.categories || catRes || [];
  recordTypes = typesRes.recordTypes || typesRes || [];
  tags = tagsRes.tags || tagsRes || [];
  renderCategoryList();
  initLogout();
}

async function loadItems(query) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (currentCategoryId) params.set('category_id', currentCategoryId);
  const qs = params.toString();
  const res = await api.get('/api/items' + (qs ? '?' + qs : ''));
  items = res.items || res || [];
  return items;
}

async function loadMembers() {
  const res = await api.get('/api/members');
  members = res.members || res || [];
  return members;
}

async function loadAuditLog(page) {
  const offset = ((page || 1) - 1) * AUDIT_PAGE_SIZE;
  const res = await api.get('/api/audit?limit=' + AUDIT_PAGE_SIZE + '&offset=' + offset);
  auditLog = res.entries || res || [];
  return auditLog;
}

// ─── ROUTER ───
function route() {
  const hash = location.hash.slice(1) || 'dashboard';
  const parts = hash.split('/');
  const view = parts[0];
  const param = parts[1];

  // Update active nav
  document.querySelectorAll('.ni[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  currentView = view;

  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'vault': currentCategoryId = null; renderVault(); break;
    case 'category': currentCategoryId = param; renderCategory(param); break;
    case 'item': param ? renderItemDetail(param) : renderVault(); break;
    case 'members': renderMembers(); break;
    case 'audit': renderAudit(); break;
    case 'settings': renderSettings(param); break;
    default: renderDashboard();
  }

  // Close mobile sidebar
  $('sidebar')?.classList.remove('open');
  $('sb-ov')?.classList.remove('open');
}

// ─── SIDEBAR ───
function initSidebar() {
  document.querySelectorAll('.ni[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      location.hash = '#' + el.dataset.view;
    });
  });

  // Hamburger
  const ham = $('ham');
  const sbOv = $('sb-ov');
  if (ham) ham.addEventListener('click', () => {
    $('sidebar')?.classList.toggle('open');
    sbOv?.classList.toggle('open');
  });
  if (sbOv) sbOv.addEventListener('click', () => {
    $('sidebar')?.classList.remove('open');
    sbOv?.classList.remove('open');
  });
}

function renderCategoryList() {
  const list = $('cat-list');
  if (!list) return;
  list.innerHTML = categories.map(c => `<div class="cat-item" data-cat-id="${esc(String(c.id))}" title="${escA(c.name)}">
    <div class="cat-icon" style="background:${escA(c.color || '#64748B')}"></div>
    <span class="cat-name">${esc(c.name)}</span>
    <span class="cat-count">${esc(String(c.item_count || 0))}</span>
  </div>`).join('');

  list.querySelectorAll('.cat-item').forEach(el => {
    el.addEventListener('click', () => {
      location.hash = '#category/' + el.dataset.catId;
    });
  });
}

// ─── THEME ───
function initTheme() {
  const saved = typeof Store !== 'undefined' ? Store.getTheme() : null;
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  const btn = $('btn-theme');
  if (btn) btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (typeof Store !== 'undefined') Store.setTheme(next);
    const icon = btn.querySelector('.material-icons-round');
    if (icon) icon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
  });
}

// ─── SEARCH ───
function initSearch() {
  const input = $('search-input');
  if (!input) return;
  const doSearch = debounce(async () => {
    searchQuery = input.value.trim();
    if (currentView === 'vault' || currentView === 'category') {
      await loadItems(searchQuery);
      renderItemGrid();
    }
  }, 300);
  input.addEventListener('input', doSearch);
}

// ─── MODALS ───
function initModals() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    const closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal(overlay.id));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Item editor
  $('modal-item-cancel')?.addEventListener('click', () => closeModal('modal-item-editor'));
  $('modal-item-save')?.addEventListener('click', saveItem);

  // Confirm dialog
  $('confirm-cancel')?.addEventListener('click', () => closeModal('modal-confirm'));

  // Onboarding
  $('onboarding-next')?.addEventListener('click', () => closeModal('modal-onboarding'));

  // Help
  $('help-close')?.addEventListener('click', () => {
    $('help-overlay')?.classList.remove('active');
  });
  $('help-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'help-overlay') $('help-overlay')?.classList.remove('active');
  });
}

function openModal(id) {
  const el = $(id);
  if (el) { el.classList.add('active'); document.body.style.overflow = 'hidden'; }
}

function closeModal(id) {
  const el = $(id);
  if (el) { el.classList.remove('active'); document.body.style.overflow = ''; }
}

// ─── KEYBOARD SHORTCUTS ───
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in inputs
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    switch (e.key) {
      case 'n': case 'N':
        e.preventDefault(); openNewItemEditor(); break;
      case '/':
        e.preventDefault(); $('search-input')?.focus(); break;
      case '?':
        e.preventDefault(); $('help-overlay')?.classList.toggle('active'); break;
      case 'Escape':
        document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
        $('help-overlay')?.classList.remove('active');
        break;
      case 'l': case 'L':
        e.preventDefault(); lockVault(); break;
    }
  });
}

// ─── AUTO-LOCK ───
function initAutoLock() {
  const resetTimer = () => {
    clearTimeout(autoLockTimer);
    if (!vaultLocked && currentUser) {
      autoLockTimer = setTimeout(lockVault, autoLockMs);
    }
  };
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetTimer, { passive: true });
  });
  resetTimer();
}

function initLockScreen() {
  const lockBtn = $('btn-lock');
  if (lockBtn) lockBtn.addEventListener('click', lockVault);

  const unlockBtn = $('lock-unlock');
  if (unlockBtn) unlockBtn.addEventListener('click', unlockVault);

  const pwInput = $('lock-password');
  if (pwInput) pwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockVault();
  });
}

function lockVault() {
  vaultLocked = true;
  $('lock-screen')?.classList.add('active');
  $('lock-password')?.focus();
}

async function unlockVault() {
  const pw = $('lock-password')?.value;
  if (!pw) return;
  try {
    const res = await api.post('/api/auth/unlock', { master_password: pw });
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    vaultLocked = false;
    $('lock-screen')?.classList.remove('active');
    if ($('lock-password')) $('lock-password').value = '';
    clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(lockVault, autoLockMs);
  } catch {
    toast('Unlock failed', 'error');
  }
}

// ─── PASSWORD GENERATOR ───
function initPasswordGenerator() {
  const regen = $('pwgen-regen');
  const copy = $('pwgen-copy');
  const slider = $('pwgen-length');

  if (regen) regen.addEventListener('click', generatePassword);
  if (copy) copy.addEventListener('click', () => {
    const output = $('pwgen-output');
    if (output) copyToClipboard(output.textContent);
  });
  if (slider) slider.addEventListener('input', () => {
    const val = $('pwgen-length-val');
    if (val) val.textContent = slider.value;
    generatePassword();
  });
}

function generatePassword() {
  const len = parseInt($('pwgen-length')?.value || '16', 10);
  const upper = $('pwgen-upper')?.checked !== false;
  const lower = $('pwgen-lower')?.checked !== false;
  const numbers = $('pwgen-numbers')?.checked !== false;
  const symbols = $('pwgen-symbols')?.checked !== false;

  let chars = '';
  if (upper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (lower) chars += 'abcdefghijklmnopqrstuvwxyz';
  if (numbers) chars += '0123456789';
  if (symbols) chars += '!@#$%^&*()-_=+[]{}|;:,.<>?';
  if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz';

  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let pw = '';
  for (let i = 0; i < len; i++) {
    pw += chars[arr[i] % chars.length];
  }

  const output = $('pwgen-output');
  if (output) output.textContent = pw;

  // Strength bar
  const strength = $('pwgen-strength');
  if (strength) {
    const score = Math.min(100, (len / 32) * 50 + (chars.length / 90) * 50);
    const color = score < 30 ? 'var(--err)' : score < 60 ? 'var(--warn)' : 'var(--ok)';
    strength.style.width = score + '%';
    strength.style.background = color;
  }
}

// ─── VIEWS ───

// Dashboard
async function renderDashboard() {
  await loadItems();
  const container = $('view-container');
  if (!container) return;

  const totalItems = items.length;
  const totalCategories = categories.length;
  const sharedItems = items.filter(i => i.shared).length;
  const recentItems = items.slice(0, 5);

  container.innerHTML = `
    <h2 style="margin-bottom:20px">Dashboard</h2>
    <div class="card-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">Total Items</span><span class="material-icons-round" style="color:var(--brand)">inventory_2</span></div>
        <div class="card-value">${esc(String(totalItems))}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Categories</span><span class="material-icons-round" style="color:var(--ok)">folder</span></div>
        <div class="card-value">${esc(String(totalCategories))}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Shared Items</span><span class="material-icons-round" style="color:var(--info)">share</span></div>
        <div class="card-value">${esc(String(sharedItems))}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Record Types</span><span class="material-icons-round" style="color:var(--warn)">category</span></div>
        <div class="card-value">${esc(String(recordTypes.length))}</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:24px">
      <button class="btn btn-primary" id="dash-new-item"><span class="material-icons-round" style="font-size:18px">add</span> New Item</button>
      <button class="btn btn-secondary" id="dash-lock"><span class="material-icons-round" style="font-size:18px">lock</span> Lock Vault</button>
    </div>
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Recent Activity</h3>
      ${recentItems.length ? recentItems.map(item => `
        <div class="activity-item" data-item-id="${esc(String(item.id))}">
          <div class="activity-icon"><span class="material-icons-round" style="font-size:16px">${getRecordTypeIcon(item.record_type_id)}</span></div>
          <div class="activity-text">${esc(item.title)}</div>
          <div class="activity-time">${formatRelative(item.updated_at || item.created_at)}</div>
        </div>
      `).join('') : '<div class="empty-state"><span class="material-icons-round">inbox</span><p>No items yet. Create your first vault item!</p></div>'}
    </div>
  `;

  $('dash-new-item')?.addEventListener('click', openNewItemEditor);
  $('dash-lock')?.addEventListener('click', lockVault);

  container.querySelectorAll('.activity-item[data-item-id]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => location.hash = '#item/' + el.dataset.itemId);
  });
}

// Vault view
async function renderVault() {
  await loadItems(searchQuery);
  const container = $('view-container');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h2>Vault</h2>
      <button class="btn btn-primary" id="vault-new-item"><span class="material-icons-round" style="font-size:18px">add</span> New Item</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-sm btn-secondary filter-btn active" data-filter="all">All</button>
      <button class="btn btn-sm btn-secondary filter-btn" data-filter="favorite">Favorites</button>
      ${recordTypes.map(rt => `<button class="btn btn-sm btn-secondary filter-btn" data-filter="type-${esc(String(rt.id))}">${esc(rt.name)}</button>`).join('')}
    </div>
    <div id="item-grid-container" class="item-grid"></div>
  `;

  $('vault-new-item')?.addEventListener('click', openNewItemEditor);
  initFilterButtons();
  renderItemGrid();
}

function renderItemGrid() {
  const container = $('item-grid-container');
  if (!container) return;

  const filtered = items;
  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state"><span class="material-icons-round">lock</span><p>No items found. Add your first item to the vault.</p></div>';
    return;
  }

  container.innerHTML = filtered.map(item => {
    const rt = recordTypes.find(r => r.id === item.record_type_id);
    const icon = getRecordTypeIcon(item.record_type_id);
    const color = rt?.color || '#64748B';
    return `<div class="item-card" data-item-id="${esc(String(item.id))}">
      <div class="item-card-header">
        <div class="item-card-icon" style="background:${escA(color)}20;color:${escA(color)}"><span class="material-icons-round">${icon}</span></div>
        <div style="flex:1;min-width:0">
          <div class="item-card-title">${esc(item.title)}</div>
          <div class="item-card-sub">${esc(rt?.name || 'Item')} · ${formatRelative(item.updated_at || item.created_at)}</div>
        </div>
        ${item.is_favorite ? '<span class="item-card-fav material-icons-round">star</span>' : ''}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(el => {
    el.addEventListener('click', () => location.hash = '#item/' + el.dataset.itemId);
  });
}

function initFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      if (filter === 'all') {
        await loadItems(searchQuery);
      } else if (filter === 'favorite') {
        await loadItems(searchQuery);
        items = items.filter(i => i.is_favorite);
      } else if (filter.startsWith('type-')) {
        const typeId = parseInt(filter.split('-')[1], 10);
        await loadItems(searchQuery);
        items = items.filter(i => i.record_type_id === typeId);
      }
      renderItemGrid();
    });
  });
}

// Category view
async function renderCategory(catId) {
  currentCategoryId = catId;
  await loadItems(searchQuery);
  const container = $('view-container');
  if (!container) return;
  const cat = categories.find(c => String(c.id) === String(catId));
  const catName = cat ? cat.name : 'Category';

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      ${cat ? `<div class="cat-icon" style="background:${escA(cat.color || '#64748B')};width:12px;height:12px"></div>` : ''}
      <h2>${esc(catName)}</h2>
      <button class="btn btn-primary btn-sm" id="cat-new-item" style="margin-left:auto"><span class="material-icons-round" style="font-size:16px">add</span> Add Item</button>
    </div>
    <div id="item-grid-container" class="item-grid"></div>
  `;

  $('cat-new-item')?.addEventListener('click', () => openNewItemEditor(catId));
  renderItemGrid();
}

// Item Detail
async function renderItemDetail(itemId) {
  const container = $('view-container');
  if (!container) return;

  let item;
  try {
    const res = await api.get('/api/items/' + encodeURIComponent(itemId));
    item = res.item || res;
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Item not found.</p></div>';
    return;
  }

  if (!item || !item.id) {
    container.innerHTML = '<div class="empty-state"><p>Item not found.</p></div>';
    return;
  }

  const rt = recordTypes.find(r => r.id === item.record_type_id);
  const fields = item.fields || [];

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="btn-icon" id="item-back" title="Back" aria-label="Go back"><span class="material-icons-round">arrow_back</span></button>
      <h2 style="flex:1">${esc(item.title)}</h2>
      <button class="btn btn-secondary btn-sm" id="item-edit"><span class="material-icons-round" style="font-size:16px">edit</span> Edit</button>
      <button class="btn btn-danger btn-sm" id="item-delete"><span class="material-icons-round" style="font-size:16px">delete</span></button>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="field-row">
        <span class="field-label">Type</span>
        <span class="field-value">${esc(rt?.name || 'Unknown')}</span>
      </div>
      <div class="field-row">
        <span class="field-label">Category</span>
        <span class="field-value">${esc(categories.find(c => c.id === item.category_id)?.name || '—')}</span>
      </div>
      ${fields.map(f => `
        <div class="field-row">
          <span class="field-label">${esc(f.field_name)}</span>
          <span class="field-value ${f.field_type === 'password' ? 'field-masked' : ''}" id="field-val-${esc(String(f.id || f.field_name))}">${f.field_type === 'password' ? '••••••••' : esc(f.decrypted_value || f.field_value || '')}</span>
          ${f.field_type === 'password' ? `<button class="btn-icon pw-eye" data-field="${escA(String(f.id || f.field_name))}" title="Toggle visibility" aria-label="Toggle field visibility"><span class="material-icons-round" style="font-size:18px">visibility</span></button>` : ''}
          <button class="field-copy" data-value="${escA(f.decrypted_value || f.field_value || '')}" title="Copy" aria-label="Copy field value"><span class="material-icons-round" style="font-size:16px">content_copy</span></button>
        </div>
      `).join('')}
      ${item.notes ? `<div class="field-row"><span class="field-label">Notes</span><span class="field-value">${esc(item.notes)}</span></div>` : ''}
      <div class="field-row">
        <span class="field-label">Created</span>
        <span class="field-value">${formatDate(item.created_at)}</span>
      </div>
      <div class="field-row">
        <span class="field-label">Updated</span>
        <span class="field-value">${formatRelative(item.updated_at)}</span>
      </div>
    </div>
    ${item.tags && item.tags.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px">${item.tags.map(t => `<span class="role-badge" style="background:var(--brand-light);color:var(--brand)">${esc(t.name || t)}</span>`).join('')}</div>` : ''}
  `;

  $('item-back')?.addEventListener('click', () => history.back());
  $('item-edit')?.addEventListener('click', () => openItemEditor(item));
  $('item-delete')?.addEventListener('click', () => confirmDeleteItem(item));

  // Password visibility toggles
  container.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldId = btn.dataset.field;
      const valEl = $('field-val-' + fieldId);
      const icon = btn.querySelector('.material-icons-round');
      if (!valEl) return;
      const field = fields.find(f => String(f.id || f.field_name) === fieldId);
      if (valEl.classList.contains('field-masked')) {
        valEl.classList.remove('field-masked');
        valEl.textContent = field?.decrypted_value || field?.field_value || '';
        if (icon) icon.textContent = 'visibility_off';
      } else {
        valEl.classList.add('field-masked');
        valEl.textContent = '••••••••';
        if (icon) icon.textContent = 'visibility';
      }
    });
  });

  // Copy buttons
  container.querySelectorAll('.field-copy').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.value));
  });
}

// ─── ITEM EDITOR ───
function openNewItemEditor(categoryId) {
  editingItem = null;
  const title = $('modal-item-title');
  if (title) title.textContent = 'New Item';
  renderItemEditorForm(null, categoryId);
  openModal('modal-item-editor');
}

function openItemEditor(item) {
  editingItem = item;
  const title = $('modal-item-title');
  if (title) title.textContent = 'Edit Item';
  renderItemEditorForm(item);
  openModal('modal-item-editor');
}

function renderItemEditorForm(item, defaultCategoryId) {
  const body = $('modal-item-body');
  if (!body) return;

  const selectedTypeId = item?.record_type_id || (recordTypes[0]?.id || '');
  const selectedType = recordTypes.find(rt => rt.id === selectedTypeId);
  const typeFields = selectedType?.fields || [];

  body.innerHTML = `
    <div class="form-group">
      <label for="edit-title">Title</label>
      <input type="text" id="edit-title" class="form-input" placeholder="Item title" value="${escA(item?.title || '')}">
    </div>
    <div class="form-group">
      <label for="edit-category">Category</label>
      <select id="edit-category" class="form-input">
        <option value="">Select category</option>
        ${categories.map(c => `<option value="${esc(String(c.id))}" ${String(c.id) === String(item?.category_id || defaultCategoryId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label for="edit-type">Record Type</label>
      <select id="edit-type" class="form-input">
        ${recordTypes.map(rt => `<option value="${esc(String(rt.id))}" ${rt.id === selectedTypeId ? 'selected' : ''}>${esc(rt.name)}</option>`).join('')}
      </select>
    </div>
    <div id="edit-fields-container">
      ${typeFields.map((f, i) => renderFieldInput(f, i, item?.fields)).join('')}
    </div>
    <div class="form-group">
      <label for="edit-notes">Notes</label>
      <textarea id="edit-notes" class="form-input" placeholder="Optional notes">${esc(item?.notes || '')}</textarea>
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:8px">
      <label style="margin:0"><input type="checkbox" id="edit-favorite" ${item?.is_favorite ? 'checked' : ''}> Favorite</label>
    </div>
  `;

  // Re-render fields when record type changes
  $('edit-type')?.addEventListener('change', () => {
    const newTypeId = parseInt($('edit-type').value, 10);
    const newType = recordTypes.find(rt => rt.id === newTypeId);
    const fieldsContainer = $('edit-fields-container');
    if (fieldsContainer && newType) {
      fieldsContainer.innerHTML = (newType.fields || []).map((f, i) => renderFieldInput(f, i, [])).join('');
    }
  });
}

function renderFieldInput(fieldDef, index, existingFields) {
  const existing = existingFields?.find(ef => ef.field_name === fieldDef.name);
  const value = existing?.decrypted_value || existing?.field_value || '';
  const type = fieldDef.field_type || fieldDef.type || 'text';
  const name = fieldDef.name || fieldDef.field_name || '';
  const id = 'field-' + index;

  let inputHtml;
  switch (type) {
    case 'password':
      inputHtml = `<div class="pw-wrap"><input type="password" id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" value="${escA(value)}" placeholder="${escA(name)}"><button type="button" class="pw-toggle field-pw-toggle" aria-label="Toggle visibility"><span class="material-icons-round" style="font-size:18px">visibility_off</span></button></div>`;
      break;
    case 'textarea':
      inputHtml = `<textarea id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" placeholder="${escA(name)}">${esc(value)}</textarea>`;
      break;
    case 'date':
      inputHtml = `<input type="date" id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" value="${escA(value)}">`;
      break;
    case 'toggle':
      inputHtml = `<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="${id}" class="field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" ${value === 'true' || value === '1' ? 'checked' : ''}> ${esc(name)}</label>`;
      break;
    case 'select':
      const opts = fieldDef.options || [];
      inputHtml = `<select id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}">${opts.map(o => `<option value="${escA(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      break;
    case 'email':
      inputHtml = `<input type="email" id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" value="${escA(value)}" placeholder="${escA(name)}">`;
      break;
    case 'url':
      inputHtml = `<input type="url" id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" value="${escA(value)}" placeholder="${escA(name)}">`;
      break;
    case 'phone':
      inputHtml = `<input type="tel" id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" value="${escA(value)}" placeholder="${escA(name)}">`;
      break;
    default:
      inputHtml = `<input type="text" id="${id}" class="form-input field-input" data-field-name="${escA(name)}" data-field-type="${escA(type)}" value="${escA(value)}" placeholder="${escA(name)}">`;
  }

  return `<div class="form-group"><label for="${id}">${esc(name)}</label>${inputHtml}</div>`;
}

async function saveItem() {
  const title = $('edit-title')?.value.trim();
  if (!title) { toast('Title is required', 'error'); return; }

  const category_id = parseInt($('edit-category')?.value, 10) || null;
  const record_type_id = parseInt($('edit-type')?.value, 10) || null;
  const notes = $('edit-notes')?.value.trim() || null;
  const is_favorite = $('edit-favorite')?.checked ? 1 : 0;

  // Collect fields
  const fieldInputs = document.querySelectorAll('.field-input');
  const fields = [];
  fieldInputs.forEach(input => {
    const name = input.dataset.fieldName;
    const type = input.dataset.fieldType;
    let value;
    if (type === 'toggle') value = input.checked ? 'true' : 'false';
    else value = input.value;
    if (name) fields.push({ field_name: name, field_type: type, field_value: value });
  });

  const payload = { title, category_id, record_type_id, notes, is_favorite, fields };

  try {
    if (editingItem) {
      await api.put('/api/items/' + editingItem.id, payload);
      toast('Item updated', 'success');
    } else {
      await api.post('/api/items', payload);
      toast('Item created', 'success');
    }
    closeModal('modal-item-editor');
    await loadData();
    route(); // Re-render current view
  } catch {
    toast('Failed to save item', 'error');
  }
}

function confirmDeleteItem(item) {
  const msgEl = $('confirm-message');
  const titleEl = $('confirm-title');
  if (msgEl) msgEl.textContent = 'Delete "' + item.title + '"? This cannot be undone.';
  if (titleEl) titleEl.textContent = 'Delete Item';

  const okBtn = $('confirm-ok');
  if (okBtn) {
    const newBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newBtn, okBtn);
    newBtn.id = 'confirm-ok';
    newBtn.addEventListener('click', async () => {
      try {
        await api.del('/api/items/' + item.id);
        toast('Item deleted', 'success');
        closeModal('modal-confirm');
        await loadData();
        location.hash = '#vault';
      } catch {
        toast('Failed to delete item', 'error');
      }
    });
  }
  openModal('modal-confirm');
}

// ─── MEMBERS VIEW ───
async function renderMembers() {
  await loadMembers();
  const container = $('view-container');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h2>Members</h2>
      ${currentUser?.role === 'admin' ? '<button class="btn btn-primary" id="invite-member"><span class="material-icons-round" style="font-size:18px">person_add</span> Invite</button>' : ''}
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th>${currentUser?.role === 'admin' ? '<th>Actions</th>' : ''}</tr></thead>
        <tbody>
          ${members.map(m => `<tr>
            <td>${esc(m.display_name)}</td>
            <td>${esc(m.email)}</td>
            <td><span class="role-badge ${escA(m.role)}">${esc(m.role)}</span></td>
            <td>${m.is_active !== false ? '<span style="color:var(--ok)">Active</span>' : '<span style="color:var(--txd)">Inactive</span>'}</td>
            <td>${formatDate(m.created_at)}</td>
            ${currentUser?.role === 'admin' ? `<td class="actions">
              <button class="btn-icon" title="Edit role" aria-label="Edit member role" data-member-id="${esc(String(m.id))}"><span class="material-icons-round" style="font-size:16px">edit</span></button>
            </td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── AUDIT VIEW ───
async function renderAudit() {
  await loadAuditLog(auditPage);
  const container = $('view-container');
  if (!container) return;

  container.innerHTML = `
    <h2 style="margin-bottom:20px">Audit Log</h2>
    <div class="card" style="padding:0;overflow:hidden">
      <table class="data-table">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Resource</th><th>Details</th></tr></thead>
        <tbody>
          ${auditLog.map(entry => `<tr>
            <td>${formatRelative(entry.created_at)}</td>
            <td>${esc(entry.user_email || entry.user_id || '—')}</td>
            <td>${esc(entry.action)}</td>
            <td>${esc(entry.resource_type || '—')}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escA(entry.details || '')}">${esc(entry.details || '—')}</td>
          </tr>`).join('')}
          ${!auditLog.length ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--txd)">No audit entries</td></tr>' : ''}
        </tbody>
      </table>
    </div>
    <div class="pagination" style="margin-top:16px">
      <button class="btn btn-sm btn-secondary" id="audit-prev" ${auditPage <= 1 ? 'disabled' : ''}>Previous</button>
      <span style="font-size:13px;color:var(--txd);padding:0 12px">Page ${esc(String(auditPage))}</span>
      <button class="btn btn-sm btn-secondary" id="audit-next" ${auditLog.length < AUDIT_PAGE_SIZE ? 'disabled' : ''}>Next</button>
    </div>
  `;

  $('audit-prev')?.addEventListener('click', () => { if (auditPage > 1) { auditPage--; renderAudit(); } });
  $('audit-next')?.addEventListener('click', () => { if (auditLog.length >= AUDIT_PAGE_SIZE) { auditPage++; renderAudit(); } });
}

// ─── SETTINGS VIEW ───
function renderSettings(tab) {
  const container = $('view-container');
  if (!container) return;
  const activeTab = tab || 'general';

  container.innerHTML = `
    <h2 style="margin-bottom:20px">Settings</h2>
    <div class="tabs">
      <div class="tab ${activeTab === 'general' ? 'active' : ''}" data-stab="general">General</div>
      <div class="tab ${activeTab === 'appearance' ? 'active' : ''}" data-stab="appearance">Appearance</div>
      <div class="tab ${activeTab === 'security' ? 'active' : ''}" data-stab="security">Security</div>
      <div class="tab ${activeTab === 'types' ? 'active' : ''}" data-stab="types">Record Types</div>
      <div class="tab ${activeTab === 'data' ? 'active' : ''}" data-stab="data">Data</div>
    </div>
    <div id="settings-content"></div>
  `;

  document.querySelectorAll('.tab[data-stab]').forEach(t => {
    t.addEventListener('click', () => location.hash = '#settings/' + t.dataset.stab);
  });

  const content = $('settings-content');
  if (!content) return;

  switch (activeTab) {
    case 'general':
      content.innerHTML = `
        <div class="card">
          <div class="form-group">
            <label for="settings-name">Display Name</label>
            <input type="text" id="settings-name" class="form-input" value="${escA(currentUser?.display_name || '')}">
          </div>
          <button class="btn btn-primary" id="save-general">Save</button>
        </div>
      `;
      $('save-general')?.addEventListener('click', async () => {
        const name = $('settings-name')?.value.trim();
        if (!name) return;
        try {
          await api.put('/api/settings', { display_name: name });
          toast('Settings saved', 'success');
          await loadCurrentUser();
        } catch { toast('Failed to save', 'error'); }
      });
      break;

    case 'appearance':
      content.innerHTML = `
        <div class="card">
          <div class="form-group">
            <label>Theme</label>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-secondary theme-opt" data-theme="light">Light</button>
              <button class="btn btn-secondary theme-opt" data-theme="dark">Dark</button>
            </div>
          </div>
        </div>
      `;
      document.querySelectorAll('.theme-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          document.documentElement.setAttribute('data-theme', btn.dataset.theme);
          if (typeof Store !== 'undefined') Store.setTheme(btn.dataset.theme);
          toast('Theme updated', 'success');
        });
      });
      break;

    case 'security':
      content.innerHTML = `
        <div class="card">
          <h3 style="margin-bottom:16px">Change Password</h3>
          <div class="form-group">
            <label for="sec-current-pw">Current Password</label>
            <input type="password" id="sec-current-pw" class="form-input" autocomplete="current-password">
          </div>
          <div class="form-group">
            <label for="sec-new-pw">New Password</label>
            <input type="password" id="sec-new-pw" class="form-input" autocomplete="new-password">
          </div>
          <button class="btn btn-primary" id="save-password">Change Password</button>
        </div>
        <div class="card" style="margin-top:16px">
          <h3 style="margin-bottom:16px">Auto-Lock</h3>
          <div class="form-group">
            <label for="sec-autolock">Lock after inactivity (minutes)</label>
            <input type="number" id="sec-autolock" class="form-input" value="${Math.round(autoLockMs / 60000)}" min="1" max="60">
          </div>
          <button class="btn btn-secondary" id="save-autolock">Update</button>
        </div>
        <div class="card" style="margin-top:16px">
          <h3 style="margin-bottom:16px">Password Generator</h3>
          <button class="btn btn-secondary" id="open-pwgen"><span class="material-icons-round" style="font-size:18px">vpn_key</span> Open Generator</button>
        </div>
      `;
      $('save-password')?.addEventListener('click', async () => {
        const current = $('sec-current-pw')?.value;
        const newPw = $('sec-new-pw')?.value;
        if (!current || !newPw) { toast('Fill in both fields', 'error'); return; }
        try {
          const res = await api.put('/api/auth/password', { current_password: current, new_password: newPw });
          if (res.error) { toast(res.error, 'error'); return; }
          toast('Password changed', 'success');
          $('sec-current-pw').value = '';
          $('sec-new-pw').value = '';
        } catch { toast('Failed to change password', 'error'); }
      });
      $('save-autolock')?.addEventListener('click', () => {
        const mins = parseInt($('sec-autolock')?.value, 10);
        if (mins > 0) {
          autoLockMs = mins * 60000;
          if (typeof Store !== 'undefined') Store.set('autoLockMs', autoLockMs);
          toast('Auto-lock updated to ' + mins + ' minutes', 'success');
        }
      });
      $('open-pwgen')?.addEventListener('click', () => {
        generatePassword();
        openModal('modal-pwgen');
      });
      break;

    case 'types':
      content.innerHTML = `
        <div class="card">
          <h3 style="margin-bottom:16px">Record Types</h3>
          ${recordTypes.map(rt => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--brd)">
              <span class="material-icons-round" style="font-size:20px;color:${escA(rt.color || 'var(--txd)')}">${getRecordTypeIcon(rt.id)}</span>
              <span style="flex:1;font-size:13px;font-weight:500">${esc(rt.name)}</span>
              <span style="font-size:11px;color:var(--txd)">${rt.is_builtin ? 'Built-in' : 'Custom'}</span>
            </div>
          `).join('')}
        </div>
      `;
      break;

    case 'data':
      content.innerHTML = `
        <div class="card">
          <h3 style="margin-bottom:16px">Data Management</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary" id="export-data"><span class="material-icons-round" style="font-size:18px">download</span> Export Backup</button>
          </div>
        </div>
      `;
      $('export-data')?.addEventListener('click', async () => {
        try {
          const data = await api.get('/api/items?limit=10000');
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'dataflow-backup-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
          URL.revokeObjectURL(url);
          toast('Backup downloaded', 'success');
        } catch { toast('Export failed', 'error'); }
      });
      break;
  }
}

// ─── HELPERS ───
function getRecordTypeIcon(typeId) {
  const rt = recordTypes.find(r => r.id === typeId);
  if (!rt) return 'article';
  const name = (rt.name || '').toLowerCase();
  if (name.includes('password') || name.includes('login')) return 'vpn_key';
  if (name.includes('card') || name.includes('credit') || name.includes('payment')) return 'credit_card';
  if (name.includes('note')) return 'sticky_note_2';
  if (name.includes('identity') || name.includes('id')) return 'badge';
  if (name.includes('medical') || name.includes('health')) return 'local_hospital';
  if (name.includes('address')) return 'home';
  if (name.includes('wifi') || name.includes('network')) return 'wifi';
  if (name.includes('license') || name.includes('software')) return 'computer';
  if (name.includes('bank') || name.includes('financial')) return 'account_balance';
  if (name.includes('document') || name.includes('file')) return 'description';
  return 'article';
}
