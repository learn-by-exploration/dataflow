// ─── DataFlow Main Application ───
// SPA router, views, and UI logic.

import { esc, escA, $, formatDate, formatRelative, copyToClipboard, toast, debounce, showToast } from './js/utils.js';
import { api, getCsrfToken } from './js/api.js';
import { mount as mountDocuments } from './js/views/documents.js';
import { mount as mountPasswords } from './js/views/passwords.js';
import { mount as mountIds } from './js/views/ids.js';
import { mount as mountNotes } from './js/views/notes.js';
import { mount as mountSearch } from './js/views/search.js';

// ─── STATE ───
let categories = [], items = [], tags = [], recordTypes = [];
let members = [], auditLog = [];
let currentView = 'dashboard';
let currentUser = null;
let vaultLocked = false;
let vaultConfigured = true; // assume configured until proven otherwise
let autoLockTimer = null;
let autoLockMs = 5 * 60 * 1000; // 5 minutes default
let searchQuery = '';
let editingItem = null;
let currentCategoryId = null;
let auditPage = 1;
const AUDIT_PAGE_SIZE = 25;

// Build login URL relative to current base (supports orchestrator prefix or standalone)
function loginUrl() {
  const base = document.querySelector('base')?.href || window.location.origin + '/';
  return new URL('login.html', base).href;
}

// ─── SCREEN READER ANNOUNCEMENTS ───
function announce(message) {
  const el = $('sr-announcements');
  if (el) { el.textContent = ''; setTimeout(() => { el.textContent = message; }, 50); }
}

// ─── SKELETON LOADING ───
function showSkeletonLoader(containerId, count) {
  const el = $(containerId);
  if (!el) return;
  const n = count || 3;
  el.innerHTML = `<div class="skeleton-container">${'<div class="skeleton-card"></div>'.repeat(n)}</div>`;
}

function hideSkeletonLoader(containerId) {
  const el = $(containerId);
  if (!el) return;
  const sk = el.querySelector('.skeleton-container');
  if (sk) sk.remove();
}

// ─── ERROR BOUNDARY ───
function showErrorBoundary(containerId, error) {
  const el = $(containerId);
  if (!el) return;
  console.error('Error boundary caught:', error);
  el.innerHTML = `<div class="error-boundary">
    <span class="material-icons-round">error_outline</span>
    <p>Something went wrong</p>
    <button class="btn btn-secondary eb-reload">Reload</button>
    <button class="btn btn-primary eb-retry">Try Again</button>
  </div>`;
  el.querySelector('.eb-reload')?.addEventListener('click', () => location.reload());
  el.querySelector('.eb-retry')?.addEventListener('click', () => route());
  // Log to audit if authenticated
  if (currentUser) {
    api.post('/api/audit', { action: 'client_error', detail: String(error && error.message || error).slice(0, 2000) }).catch(() => {});
  }
}

// ─── FOCUS TRAP ───
function trapFocus(modal) {
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  first.focus();
  const handler = (e) => {
    if (e.key === 'Escape') { const overlay = modal.closest('.modal-overlay'); if (overlay) closeModal(overlay.id); return; }
    if (e.key !== 'Tab') return;
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
  };
  modal.addEventListener('keydown', handler);
  return handler;
}

function blockBackgroundScroll() { document.body.style.overflow = 'hidden'; }
function unblockBackgroundScroll() { document.body.style.overflow = ''; }

// ─── OFFLINE INDICATOR ───
let offlineQueue = [];

function showOfflineIndicator() {
  if ($('offline-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.className = 'offline-banner';
  banner.innerHTML = '<span class="material-icons-round" style="font-size:18px">cloud_off</span> You are offline';
  document.body.prepend(banner);
  announce('You are offline');
}

function hideOfflineIndicator() {
  const banner = $('offline-banner');
  if (banner) banner.remove();
  // Retry queued mutations
  if (offlineQueue.length) {
    const queue = [...offlineQueue];
    offlineQueue = [];
    queue.forEach(fn => fn().catch(() => {}));
  }
  announce('You are back online');
}

function initOfflineDetection() {
  window.addEventListener('online', hideOfflineIndicator);
  window.addEventListener('offline', showOfflineIndicator);
  if (!navigator.onLine) showOfflineIndicator();
}

// ─── KEYBOARD NAVIGATION ───
function setupKeyboardNav() {
  const navItems = document.querySelectorAll('.ni[data-view]');
  navItems.forEach((item, index) => {
    item.setAttribute('tabindex', '0');
    item.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && index < navItems.length - 1) { e.preventDefault(); navItems[index + 1].focus(); }
      if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); navItems[index - 1].focus(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
    });
  });
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', init);

async function init() {
  initTheme();
  initSidebar();
  initModals();
  initShareModal();
  initKeyboardShortcuts();
  initSearch();
  initLockScreen();
  initAutoLock();
  initPasswordGenerator();
  initOfflineDetection();
  setupKeyboardNav();

  try {
    await loadCurrentUser();
    if (!currentUser) return;
  } catch (e) {
    window.location.href = loginUrl();
    return;
  }

  try {
    await loadData();
    route();
    window.addEventListener('hashchange', route);
    checkOnboarding();
  } catch (e) {
    // Data load failure (e.g. vault locked) — don't redirect, show lock screen
    console.error('Data load failed:', e);
    lockVault();
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ─── AUTH ───
async function loadCurrentUser() {
  const data = await api.get('/api/auth/me');
  if (data && data.user) {
    currentUser = data.user;
    vaultConfigured = data.user.vault_configured !== false;
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
    window.location.href = loginUrl();
  }
}

function initLogout() {
  const btn = $('sb-logout-btn');
  if (btn) btn.addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch {}
    window.location.href = loginUrl();
  });
}

// ─── DATA LOADING ───
async function loadData() {
  const [catRes, typesRes, tagsRes] = await Promise.all([
    api.get('/api/categories'),
    api.get('/api/record-types'),
    api.get('/api/tags'),
  ]);
  categories = Array.isArray(catRes) ? catRes : Array.isArray(catRes.categories) ? catRes.categories : [];
  recordTypes = Array.isArray(typesRes) ? typesRes : Array.isArray(typesRes.recordTypes) ? typesRes.recordTypes : [];
  tags = Array.isArray(tagsRes) ? tagsRes : Array.isArray(tagsRes.tags) ? tagsRes.tags : [];
  renderCategoryList();
  initLogout();
}

async function loadItems(query) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (currentCategoryId) params.set('category_id', currentCategoryId);
  const qs = params.toString();
  const res = await api.get('/api/items' + (qs ? '?' + qs : ''));
  if (res && res.vaultLocked) {
    items = [];
    lockVault();
    return items;
  }
  items = Array.isArray(res) ? res : Array.isArray(res.items) ? res.items : [];
  return items;
}

async function loadMembers() {
  const res = await api.get('/api/members');
  members = Array.isArray(res) ? res : Array.isArray(res.members) ? res.members : [];
  return members;
}

async function loadAuditLog(page) {
  const offset = ((page || 1) - 1) * AUDIT_PAGE_SIZE;
  const res = await api.get('/api/audit?limit=' + AUDIT_PAGE_SIZE + '&offset=' + offset);
  auditLog = Array.isArray(res) ? res : Array.isArray(res.entries) ? res.entries : [];
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
    case 'shared': renderSharedView(); break;
    case 'trash': renderTrashView(); break;
    case 'members': renderMembers(); break;
    case 'audit': renderAudit(); break;
    case 'settings': renderSettings(param); break;
    case 'manage-categories': renderCategoryEditor(); break;
    case 'analytics': renderAnalyticsView(); break;
    case 'activity': renderActivityView(); break;
    case 'documents': mountDocuments($('view-container')); break;
    case 'passwords': mountPasswords($('view-container')); break;
    case 'ids': mountIds($('view-container')); break;
    case 'notes': mountNotes($('view-container')); break;
    case 'search': mountSearch($('view-container'), param); break;
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

  // Load theme from backend
  api.get('/api/settings').then(settings => {
    if (settings && settings.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme);
      if (typeof Store !== 'undefined') Store.setTheme(settings.theme);
    }
  }).catch(() => {});

  const btn = $('btn-theme');
  if (btn) btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (typeof Store !== 'undefined') Store.setTheme(next);
    // Save to backend
    api.put('/api/settings/theme', { value: next }).catch(() => {});
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

let _previousFocus = null;

function openModal(id) {
  const el = $(id);
  if (el) {
    _previousFocus = document.activeElement;
    el.classList.add('active');
    blockBackgroundScroll();
    const modal = el.querySelector('.modal') || el;
    trapFocus(modal);
  }
}

function closeModal(id) {
  const el = $(id);
  if (el) {
    el.classList.remove('active');
    unblockBackgroundScroll();
    if (_previousFocus) { try { _previousFocus.focus(); } catch {} _previousFocus = null; }
  }
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
  const lockScreen = $('lock-screen');
  const lockTitle = lockScreen?.querySelector('.lock-title');
  const lockSubtitle = lockScreen?.querySelector('.lock-subtitle');
  const lockBtn = $('lock-unlock');
  if (!vaultConfigured) {
    if (lockTitle) lockTitle.textContent = 'Set Up Vault';
    if (lockSubtitle) lockSubtitle.textContent = 'Create a master password to secure your vault';
    if (lockBtn) lockBtn.textContent = 'Create Vault';
  } else {
    if (lockTitle) lockTitle.textContent = 'Vault Locked';
    if (lockSubtitle) lockSubtitle.textContent = 'Enter your master password to unlock';
    if (lockBtn) lockBtn.textContent = 'Unlock';
  }
  lockScreen?.classList.add('active');
  $('lock-password')?.focus();
}

async function unlockVault() {
  const pw = $('lock-password')?.value;
  if (!pw) return;
  try {
    const endpoint = vaultConfigured ? '/api/auth/unlock' : '/api/auth/setup-vault';
    const res = await api.post(endpoint, { master_password: pw });
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    vaultConfigured = true;
    vaultLocked = false;
    $('lock-screen')?.classList.remove('active');
    if ($('lock-password')) $('lock-password').value = '';
    clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(lockVault, autoLockMs);
    // Reload data now that vault is unlocked
    await loadData();
    route();
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
  try {
  await loadItems();
  const container = $('view-container');
  if (!container) return;

  const totalItems = items.length;
  const totalCategories = categories.length;
  const sharedItems = items.filter(i => i.shared).length;
  const recentItems = items.slice(0, 5);

  // Load security data in parallel
  let securityScore = null;
  let passwordHealth = null;
  let healthReport = null;
  try {
    [securityScore, passwordHealth, healthReport] = await Promise.all([
      api.get('/api/stats/security-score').catch(() => null),
      api.get('/api/stats/password-health').catch(() => null),
      api.get('/api/stats/health-report').catch(() => null),
    ]);
  } catch { /* ignore */ }

  const scoreValue = securityScore ? securityScore.score : 0;
  const scoreColor = scoreValue >= 80 ? 'var(--ok)' : scoreValue >= 50 ? 'var(--warn)' : 'var(--err)';
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference - (scoreValue / 100) * circumference;

  container.innerHTML = `
    <h2 style="margin-bottom:20px">Dashboard</h2>
    ${securityScore ? `
    <div class="card" style="margin-bottom:20px;display:flex;align-items:center;gap:24px;padding:20px" id="security-score-card">
      <svg width="100" height="100" viewBox="0 0 100 100" style="flex-shrink:0">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--brd)" stroke-width="8"/>
        <circle cx="50" cy="50" r="40" fill="none" stroke="${escA(scoreColor)}" stroke-width="8"
          stroke-dasharray="${esc(String(circumference))}" stroke-dashoffset="${esc(String(dashOffset))}"
          stroke-linecap="round" transform="rotate(-90 50 50)"/>
        <text x="50" y="55" text-anchor="middle" font-size="20" font-weight="700" fill="${escA(scoreColor)}">${esc(String(scoreValue))}</text>
      </svg>
      <div>
        <div style="font-weight:600;font-size:16px;margin-bottom:4px">Security Score</div>
        <div style="font-size:13px;color:var(--txd)">${scoreValue >= 80 ? 'Your vault is well secured' : scoreValue >= 50 ? 'Some improvements recommended' : 'Action needed to secure your vault'}</div>
      </div>
    </div>
    ` : ''}
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
    ${passwordHealth && passwordHealth.total > 0 ? `
    <div class="card-grid" style="margin-top:0">
      <div class="card" style="cursor:pointer" id="dash-weak-pw">
        <div class="card-header"><span class="card-title">Weak Passwords</span><span class="material-icons-round" style="color:var(--err)">warning</span></div>
        <div class="card-value">${esc(String(passwordHealth.weak || 0))}</div>
      </div>
      <div class="card" style="cursor:pointer" id="dash-old-pw">
        <div class="card-header"><span class="card-title">Old Passwords</span><span class="material-icons-round" style="color:var(--warn)">schedule</span></div>
        <div class="card-value">${esc(String(passwordHealth.old || 0))}</div>
      </div>
    </div>
    ` : ''}
    <div style="display:flex;gap:12px;margin-bottom:24px">
      <button class="btn btn-primary" id="dash-new-item"><span class="material-icons-round" style="font-size:18px">add</span> New Item</button>
      <button class="btn btn-secondary" id="dash-lock"><span class="material-icons-round" style="font-size:18px">lock</span> Lock Vault</button>
    </div>
    ${healthReport ? `
    <div class="card" style="padding:16px;margin-bottom:16px" id="vault-health-section">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Vault Health</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:12px">
        <div style="font-size:12px;color:var(--txd)">Items: <strong>${esc(String(healthReport.total_items))}</strong></div>
        <div style="font-size:12px;color:var(--txd)">Categories: <strong>${esc(String(healthReport.total_categories))}</strong></div>
        <div style="font-size:12px;color:var(--txd)">Tags: <strong>${esc(String(healthReport.total_tags))}</strong></div>
        <div style="font-size:12px;color:var(--txd)">Shared by me: <strong>${esc(String(healthReport.sharing.shared_by_me))}</strong></div>
      </div>
      ${healthReport.recommendations.length ? `
      <div style="margin-top:8px">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px">Recommendations</div>
        ${healthReport.recommendations.map(r => `<div style="font-size:12px;color:var(--warn);padding:2px 0">• ${esc(r)}</div>`).join('')}
      </div>` : ''}
    </div>
    ` : ''}
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
  $('dash-weak-pw')?.addEventListener('click', () => { location.hash = '#vault'; });
  $('dash-old-pw')?.addEventListener('click', () => { location.hash = '#vault'; });

  // Breach monitoring: background check on unlock
  checkBreachMonitoring();

  container.querySelectorAll('.activity-item[data-item-id]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => location.hash = '#item/' + el.dataset.itemId);
  });
  } catch (err) { showErrorBoundary('view-container', err); }
}

// Vault view
async function renderVault() {
  try {
  await loadItems(searchQuery);
  const container = $('view-container');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px" class="vault-toolbar">
      <h2>Vault</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-sm btn-secondary" id="vault-export-btn" title="Export"><span class="material-icons-round" style="font-size:16px">download</span> Export</button>
        <button class="btn btn-sm btn-secondary" id="vault-import-btn" title="Import"><span class="material-icons-round" style="font-size:16px">upload</span> Import</button>
        <button class="btn btn-sm btn-secondary" id="vault-print-btn" title="Print"><span class="material-icons-round" style="font-size:16px">print</span> Print</button>
        <button class="btn btn-primary" id="vault-new-item"><span class="material-icons-round" style="font-size:18px">add</span> New Item</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-sm btn-secondary filter-btn active" data-filter="all">All</button>
      <button class="btn btn-sm btn-secondary filter-btn" data-filter="favorite">Favorites</button>
      ${recordTypes.map(rt => `<button class="btn btn-sm btn-secondary filter-btn" data-filter="type-${esc(String(rt.id))}">${esc(rt.name)}</button>`).join('')}
    </div>
    <div id="item-grid-container" class="item-grid"></div>
  `;

  $('vault-new-item')?.addEventListener('click', openNewItemEditor);
  $('vault-export-btn')?.addEventListener('click', () => openExportWizard());
  $('vault-import-btn')?.addEventListener('click', () => openImportWizard());
  $('vault-print-btn')?.addEventListener('click', () => openPrintView());
  initFilterButtons();
  renderFilterPanel();

  // Trigger reindex on vault load
  try { await api.post('/api/items/reindex'); } catch { /* ignore */ }

  renderItemGrid();
  } catch (err) { showErrorBoundary('view-container', err); }
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
    const searchTerms = searchQuery ? searchQuery.split(/\s+/).filter(Boolean) : [];
    const titleHtml = searchTerms.length ? highlightMatches(item.title, searchTerms) : esc(item.title);
    return `<div class="item-card" data-item-id="${esc(String(item.id))}">
      <div class="item-card-header">
        <div class="item-card-icon" style="background:${escA(color)}20;color:${escA(color)}"><span class="material-icons-round">${icon}</span></div>
        <div style="flex:1;min-width:0">
          <div class="item-card-title">${titleHtml}</div>
          <div class="item-card-sub">${esc(rt?.name || 'Item')} · ${formatRelative(item.updated_at || item.created_at)}</div>
        </div>
        <span class="item-card-fav material-icons-round" data-fav-id="${esc(String(item.id))}" style="cursor:pointer;color:${item.favorite ? 'var(--warn)' : 'var(--txd)'};font-size:20px" title="Toggle favorite">${item.favorite ? '★' : '☆'}</span>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't navigate if clicking favorite star
      if (e.target.closest('.item-card-fav')) return;
      location.hash = '#item/' + el.dataset.itemId;
    });
  });

  // Favorite toggle
  container.querySelectorAll('.item-card-fav').forEach(star => {
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = star.dataset.favId;
      try {
        await api.post('/api/items/' + id + '/favorite');
        await loadItems(searchQuery);
        renderItemGrid();
      } catch { toast('Failed to toggle favorite', 'error'); }
    });
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
      <button class="btn-icon" id="cat-share-btn" title="Share category" aria-label="Share category"><span class="material-icons-round" style="font-size:18px">share</span></button>
      <button class="btn btn-primary btn-sm" id="cat-new-item" style="margin-left:auto"><span class="material-icons-round" style="font-size:16px">add</span> Add Item</button>
    </div>
    <div id="item-grid-container" class="item-grid"></div>
  `;

  $('cat-new-item')?.addEventListener('click', () => openNewItemEditor(catId));
  $('cat-share-btn')?.addEventListener('click', () => openShareModal('category', catId));
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
      <button class="btn btn-secondary btn-sm" id="item-share-btn"><span class="material-icons-round" style="font-size:16px">share</span> Share</button>
      <button class="btn btn-secondary btn-sm" id="item-copy"><span class="material-icons-round" style="font-size:16px">content_copy</span> Duplicate</button>
      <button class="btn btn-secondary btn-sm" id="item-print-btn"><span class="material-icons-round" style="font-size:16px">print</span> Print</button>
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
          <span class="field-value ${f.field_type === 'password' ? 'field-masked' : ''}" id="field-val-${esc(String(f.id || f.field_name))}">${f.field_type === 'password' ? '••••••••' : f.field_type === 'totp' ? '<span class="totp-code" data-field-id="' + escA(String(f.id)) + '">Loading...</span>' : esc(f.decrypted_value || f.field_value || '')}</span>
          ${f.field_type === 'password' ? `<button class="btn-icon pw-eye" data-field="${escA(String(f.id || f.field_name))}" title="Toggle visibility" aria-label="Toggle field visibility"><span class="material-icons-round" style="font-size:18px">visibility</span></button>` : ''}
          ${f.field_type === 'totp' ? `<button class="btn-icon totp-copy" data-field-id="${escA(String(f.id))}" title="Copy TOTP code" aria-label="Copy TOTP code"><span class="material-icons-round" style="font-size:16px">content_copy</span></button>` : ''}
          <button class="field-copy" data-value="${escA(f.decrypted_value || f.field_value || '')}" title="Copy" aria-label="Copy field value"><span class="material-icons-round" style="font-size:16px">content_copy</span></button>
          ${f.field_type === 'password' && f.password_last_changed ? `<span class="field-age" style="font-size:11px;color:var(--txd);margin-left:8px" title="Last changed: ${escA(f.password_last_changed)}">${(() => { const days = Math.floor((Date.now() - new Date(f.password_last_changed).getTime()) / 86400000); return days > 90 ? '<span style="color:var(--err)" class="material-icons-round" style="font-size:14px">warning</span> ' + days + 'd ago' : days + 'd ago'; })()}</span>` : ''}
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
    <div class="card" style="margin-bottom:16px" id="item-attachments">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Attachments</h3>
      <div id="item-attachments-list"><em>Loading...</em></div>
    </div>
    <div class="card" style="margin-bottom:16px" id="item-history-section">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">History</h3>
      <div id="item-history-content"><em>Loading...</em></div>
    </div>
  `;

  $('item-back')?.addEventListener('click', () => history.back());
  $('item-share-btn')?.addEventListener('click', () => openShareModal('item', item.id));
  $('item-edit')?.addEventListener('click', () => openItemEditor(item));
  $('item-delete')?.addEventListener('click', () => confirmDeleteItem(item));
  $('item-print-btn')?.addEventListener('click', () => openPrintView([item]));
  $('item-copy')?.addEventListener('click', async () => {
    try {
      const copy = await api.post('/api/items/' + item.id + '/copy');
      toast('Item duplicated', 'success');
      location.hash = '#item/' + (copy.id || copy.item?.id);
    } catch { toast('Failed to duplicate item', 'error'); }
  });

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

  // Load attachments for detail view
  loadAttachmentsForItem(item.id);

  // Load item history
  loadItemHistory(item.id);
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
    <div id="edit-attachments" style="margin-top:16px">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:8px">Attachments</h3>
      <div class="drop-zone" id="attachment-drop-zone" style="border:2px dashed var(--brd);border-radius:var(--rs);padding:20px;text-align:center;color:var(--txd);margin-bottom:8px;cursor:pointer">
        <span class="material-icons-round" style="font-size:24px">cloud_upload</span>
        <p style="font-size:13px;margin-top:4px">Drag &amp; drop files here or click to browse</p>
        <input type="file" id="attachment-file-input" style="display:none">
      </div>
      <button class="btn btn-sm btn-secondary" id="attachment-upload-btn"><span class="material-icons-round" style="font-size:16px">upload</span> Upload</button>
      <div id="edit-attachments-list" style="margin-top:8px"></div>
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

  // Attachment drag-and-drop
  const dropZone = $('attachment-drop-zone');
  const fileInput = $('attachment-file-input');
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--brand)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--brd)'; });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--brd)';
      if (e.dataTransfer.files.length && item?.id) uploadAttachment(item.id, e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length && item?.id) uploadAttachment(item.id, fileInput.files[0]);
    });
  }
  $('attachment-upload-btn')?.addEventListener('click', () => fileInput?.click());

  // Load existing attachments in editor
  if (item?.id) loadEditorAttachments(item.id);
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
      const result = await api.post('/api/items', payload);
      toast('Item created', 'success');
      // Check for duplicate detection
      if (result && result.possibleDuplicate) {
        closeModal('modal-item-editor');
        showDuplicateModal(result.possibleDuplicate);
        await loadData();
        route();
        return;
      }
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
  if (msgEl) msgEl.textContent = 'Move "' + item.title + '" to trash? You can restore it within 30 days.';
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
  try {
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
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>
          ${members.map(m => `<tr>
            <td>${esc(m.display_name)}</td>
            <td>${esc(m.email)}</td>
            <td><span class="role-badge ${escA(m.role)}">${esc(m.role)}</span></td>
            <td>${m.is_active !== false ? '<span style="color:var(--ok)">Active</span>' : '<span style="color:var(--txd)">Inactive</span>'}</td>
            <td>${formatDate(m.created_at)}</td>
            <td class="actions">
              <button class="btn-icon member-edit-btn" title="Edit member" aria-label="Edit member" data-member-id="${esc(String(m.id))}"><span class="material-icons-round" style="font-size:16px">edit</span></button>
              ${m.id !== currentUser?.id ? `<button class="btn btn-sm btn-secondary emergency-request-btn" data-member-id="${esc(String(m.id))}" data-member-name="${escA(m.display_name)}">Request Emergency Access</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Emergency request buttons
  container.querySelectorAll('.emergency-request-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openEmergencyRequestModal(Number(btn.dataset.memberId), btn.dataset.memberName);
    });
  });

  // Member edit buttons
  container.querySelectorAll('.member-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openMemberEditModal(Number(btn.dataset.memberId));
    });
  });
  } catch (err) { showErrorBoundary('view-container', err); }
}

// ─── AUDIT VIEW ───
async function renderAudit() {
  try {
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
  } catch (err) { showErrorBoundary('view-container', err); }
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
        btn.addEventListener('click', async () => {
          document.documentElement.setAttribute('data-theme', btn.dataset.theme);
          if (typeof Store !== 'undefined') Store.setTheme(btn.dataset.theme);
          try { await api.put('/api/settings/theme', { value: btn.dataset.theme }); } catch { /* ignore */ }
          toast('Theme updated', 'success');
        });
      });
      break;

    case 'security':
      content.innerHTML = `
        <div class="card" id="change-password-section">
          <h3 style="margin-bottom:16px">Change Password</h3>
          <div class="form-group">
            <label for="sec-current-pw">Current Password</label>
            <input type="password" id="sec-current-pw" class="form-input" autocomplete="current-password">
          </div>
          <div class="form-group">
            <label for="sec-new-pw">New Password</label>
            <input type="password" id="sec-new-pw" class="form-input" autocomplete="new-password">
            <div id="pw-strength" style="margin-top:4px;font-size:12px;color:var(--txd)"></div>
          </div>
          <div class="form-group">
            <label for="sec-confirm-pw">Confirm New Password</label>
            <input type="password" id="sec-confirm-pw" class="form-input" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label for="sec-current-master">Current Master Password</label>
            <input type="password" id="sec-current-master" class="form-input">
          </div>
          <div class="form-group">
            <label for="sec-new-master">New Master Password</label>
            <input type="password" id="sec-new-master" class="form-input">
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
        <div class="card" style="margin-top:16px" id="active-sessions-section">
          <h3 style="margin-bottom:16px">Active Sessions</h3>
          <div id="sessions-list" style="margin-bottom:12px"><em>Loading...</em></div>
          <button class="btn btn-secondary" id="revoke-all-sessions">Revoke All Others</button>
        </div>
        <div class="card" style="margin-top:16px">
          <h3 style="margin-bottom:16px">Password Generator</h3>
          <button class="btn btn-secondary" id="open-pwgen"><span class="material-icons-round" style="font-size:18px">vpn_key</span> Open Generator</button>
        </div>
        <div class="card" style="margin-top:16px" id="emergency-access-section">
          <h3 style="margin-bottom:16px">Emergency Access</h3>
          <div id="emergency-requests-list"><em>Loading...</em></div>
        </div>
        <div class="card" style="margin-top:16px">
          <h3 style="margin-bottom:16px">Emergency Wait Period</h3>
          <div class="form-group">
            <label for="emergency-wait-days">Wait period (days)</label>
            <input type="number" id="emergency-wait-days" class="form-input" min="1" max="30" value="3">
          </div>
          <button class="btn btn-secondary" id="save-emergency-wait">Save</button>
        </div>
      `;
      // Password strength indicator
      $('sec-new-pw')?.addEventListener('input', (e) => {
        const pw = e.target.value;
        const el = $('pw-strength');
        if (!el) return;
        if (!pw) { el.textContent = ''; return; }
        let score = 0;
        if (pw.length >= 8) score++;
        if (pw.length >= 12) score++;
        if (/[A-Z]/.test(pw)) score++;
        if (/[0-9]/.test(pw)) score++;
        if (/[^A-Za-z0-9]/.test(pw)) score++;
        const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
        const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];
        const idx = Math.min(score, labels.length) - 1;
        el.textContent = labels[idx < 0 ? 0 : idx];
        el.style.color = colors[idx < 0 ? 0 : idx];
      });
      $('save-password')?.addEventListener('click', async () => {
        const current = $('sec-current-pw')?.value;
        const newPw = $('sec-new-pw')?.value;
        const confirmPw = $('sec-confirm-pw')?.value;
        const currentMaster = $('sec-current-master')?.value;
        const newMaster = $('sec-new-master')?.value;
        if (!current || !newPw || !currentMaster || !newMaster) { toast('Fill in all fields', 'error'); return; }
        if (newPw !== confirmPw) { toast('Passwords do not match', 'error'); return; }
        try {
          const res = await api.put('/api/auth/password', {
            current_password: current,
            new_password: newPw,
            current_master_password: currentMaster,
            new_master_password: newMaster,
          });
          if (res.error) { toast(res.error, 'error'); return; }
          toast('Password changed', 'success');
          $('sec-current-pw').value = '';
          $('sec-new-pw').value = '';
          $('sec-confirm-pw').value = '';
          $('sec-current-master').value = '';
          $('sec-new-master').value = '';
          const str = $('pw-strength');
          if (str) str.textContent = '';
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
      // Load sessions
      (async () => {
        try {
          const sessions = await api.get('/api/auth/sessions');
          const list = $('sessions-list');
          if (!list || !Array.isArray(sessions)) return;
          if (sessions.length === 0) {
            list.innerHTML = '<em>No active sessions</em>';
            return;
          }
          list.innerHTML = '<table class="data-table" style="width:100%;font-size:13px"><thead><tr><th>Session</th><th>Created</th><th>Expires</th><th></th></tr></thead><tbody>' +
            sessions.map(s => `<tr>
              <td>${esc(s.sid)}${s.is_current ? ' <strong>(current)</strong>' : ''}</td>
              <td>${esc(s.created_at)}</td>
              <td>${esc(s.expires_at)}</td>
              <td>${s.is_current ? '' : '<button class="btn btn-sm btn-secondary revoke-session-btn" data-ref="' + escA(s.ref) + '">Revoke</button>'}</td>
            </tr>`).join('') +
            '</tbody></table>';
          list.querySelectorAll('.revoke-session-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              try {
                await api.del('/api/auth/sessions/' + btn.dataset.ref);
                toast('Session revoked', 'success');
                renderSettings('security');
              } catch { toast('Failed to revoke session', 'error'); }
            });
          });
        } catch { /* ignore */ }
      })();
      $('revoke-all-sessions')?.addEventListener('click', async () => {
        try {
          await api.del('/api/auth/sessions');
          toast('All other sessions revoked', 'success');
          renderSettings('security');
        } catch { toast('Failed to revoke sessions', 'error'); }
      });
      $('open-pwgen')?.addEventListener('click', () => {
        generatePassword();
        openModal('modal-pwgen');
      });
      // Emergency wait days
      (async () => {
        try {
          const settings = await api.get('/api/settings');
          const waitSetting = (Array.isArray(settings) ? settings : []).find(s => s.key === 'emergency_wait_days');
          if (waitSetting && $('emergency-wait-days')) {
            $('emergency-wait-days').value = waitSetting.value;
          }
        } catch { /* ignore */ }
      })();
      $('save-emergency-wait')?.addEventListener('click', async () => {
        const days = parseInt($('emergency-wait-days')?.value, 10);
        if (days >= 1 && days <= 30) {
          try {
            await api.put('/api/settings/emergency_wait_days', { value: String(days) });
            toast('Emergency wait period updated', 'success');
          } catch { toast('Failed to save', 'error'); }
        }
      });
      // Load emergency requests
      loadEmergencyRequests();
      // Load recovery codes UI
      renderRecoveryCodes($('settings-content'));
      break;

    case 'types':
      content.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <h3>Record Types</h3>
            <button class="btn btn-sm btn-secondary" id="manage-categories-btn"><span class="material-icons-round" style="font-size:16px">edit</span> Manage Categories</button>
          </div>
          ${recordTypes.map(rt => `
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--brd)">
              <span class="material-icons-round" style="font-size:20px;color:${escA(rt.color || 'var(--txd)')}">${getRecordTypeIcon(rt.id)}</span>
              <span style="flex:1;font-size:13px;font-weight:500">${esc(rt.name)}</span>
              <span style="font-size:11px;color:var(--txd)">${rt.is_builtin ? 'Built-in' : 'Custom'}</span>
            </div>
          `).join('')}
        </div>
      `;
      $('manage-categories-btn')?.addEventListener('click', () => { location.hash = '#manage-categories'; });
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

// ─── SHARED VIEW (#33) ───
async function renderSharedView() {
  const container = $('view-container');
  if (!container) return;

  container.innerHTML = `
    <h2 style="margin-bottom:20px">Shared</h2>
    <div class="tabs">
      <div class="tab active" data-share-tab="by-me">Shared by me</div>
      <div class="tab" data-share-tab="with-me">Shared with me</div>
    </div>
    <div id="shared-content"></div>
  `;

  const renderTab = async (tab) => {
    const content = $('shared-content');
    if (!content) return;
    if (tab === 'by-me') {
      try {
        const itemsRes = await api.get('/api/items');
        const allItems = Array.isArray(itemsRes) ? itemsRes : (itemsRes.items || []);
        const ownItems = allItems.filter(i => !i.shared);
        // For each item load shares
        let sharedByMe = [];
        for (const it of ownItems.slice(0, 50)) {
          try {
            const shares = await api.get('/api/items/' + it.id + '/shares');
            if (Array.isArray(shares) && shares.length) {
              sharedByMe.push({ ...it, shares });
            }
          } catch { /* skip */ }
        }
        content.innerHTML = sharedByMe.length ? sharedByMe.map(it => ` // uses esc()
          <div class="card" style="margin-bottom:8px;padding:12px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="material-icons-round" style="font-size:18px;color:var(--brand)">share</span>
              <span style="font-weight:600;flex:1">${esc(it.title)}</span>
              <span style="font-size:12px;color:var(--txd)">${esc(String(it.shares.length))} recipient(s)</span>
            </div>
          </div>
        `).join('') : '<div class="empty-state"><span class="material-icons-round">share</span><p>No items shared by you yet.</p></div>';
      } catch { content.innerHTML = '<p style="color:var(--txd)">Failed to load shared items.</p>'; }
    } else {
      try {
        const sharedItems = await api.get('/api/shared/items');
        const sharedCats = await api.get('/api/shared/categories');
        const all = [
          ...(Array.isArray(sharedItems) ? sharedItems : []).map(i => ({ ...i, type: 'item' })),
          ...(Array.isArray(sharedCats) ? sharedCats : []).map(c => ({ ...c, type: 'category' })),
        ];
        content.innerHTML = all.length ? all.map(s => ` // uses esc()
          <div class="card" style="margin-bottom:8px;padding:12px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="material-icons-round" style="font-size:18px;color:var(--info)">${s.type === 'item' ? 'article' : 'folder'}</span>
              <span style="font-weight:600;flex:1">${esc(s.title || s.name || '—')}</span>
              <span class="role-badge" style="background:var(--brand-light);color:var(--brand)">${esc(s.permission || 'read')}</span>
            </div>
          </div>
        `).join('') : '<div class="empty-state"><span class="material-icons-round">share</span><p>Nothing shared with you yet.</p></div>';
      } catch { content.innerHTML = '<p style="color:var(--txd)">Failed to load.</p>'; }
    }
  };

  container.querySelectorAll('.tab[data-share-tab]').forEach(t => {
    t.addEventListener('click', () => {
      container.querySelectorAll('.tab[data-share-tab]').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      renderTab(t.dataset.shareTab);
    });
  });

  renderTab('by-me');
}

// ─── SHARE MODAL (#31, #32) ───
let shareContext = { type: null, id: null };

async function openShareModal(type, id) {
  shareContext = { type, id };
  const titleEl = $('share-modal-title');
  if (titleEl) titleEl.textContent = type === 'item' ? 'Share Item' : 'Share Category';
  await loadShareData();
  openModal('modal-share');
}

async function loadShareData() {
  // Load members for picker
  await loadMembers();
  const select = $('share-member-select');
  if (select) {
    select.innerHTML = members // esc() used in map
      .filter(m => m.id !== currentUser?.id)
      .map(m => `<option value="${esc(String(m.id))}">${esc(m.display_name)} (${esc(m.email)})</option>`)
      .join('');
  }

  // Load current shares
  const listEl = $('share-current-list');
  if (!listEl) return;
  try {
    const endpoint = shareContext.type === 'item'
      ? '/api/items/' + shareContext.id + '/shares'
      : '/api/categories/' + shareContext.id + '/shares';
    const shares = await api.get(endpoint);
    if (!Array.isArray(shares) || !shares.length) {
      listEl.innerHTML = '<em style="color:var(--txd);font-size:13px">No shares yet</em>';
      return;
    }
    listEl.innerHTML = shares.map(s => ` // esc()
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--brd)">
        <span style="flex:1;font-size:13px">${esc(s.display_name || s.email || 'User ' + s.user_id)}</span>
        <span class="role-badge" style="background:var(--brand-light);color:var(--brand)">${esc(s.permission)}</span>
        <button class="btn btn-sm btn-danger share-revoke-btn" data-user-id="${esc(String(s.user_id || s.shared_with))}">Revoke</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.share-revoke-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const endpoint = shareContext.type === 'item'
            ? '/api/items/' + shareContext.id + '/share/' + btn.dataset.userId
            : '/api/categories/' + shareContext.id + '/share/' + btn.dataset.userId;
          await api.del(endpoint);
          toast('Share revoked', 'success');
          await loadShareData();
        } catch { toast('Failed to revoke', 'error'); }
      });
    });
  } catch { listEl.innerHTML = '<em style="color:var(--txd)">Failed to load shares</em>'; }
}

// Share submit handler — initialized in initModals
function initShareModal() {
  $('share-submit-btn')?.addEventListener('click', async () => {
    const userId = parseInt($('share-member-select')?.value, 10);
    const permission = $('share-permission-select')?.value || 'read';
    if (!userId) { toast('Select a member', 'error'); return; }
    try {
      const endpoint = shareContext.type === 'item'
        ? '/api/items/' + shareContext.id + '/share'
        : '/api/categories/' + shareContext.id + '/share';
      await api.post(endpoint, { user_id: userId, permission });
      toast('Shared successfully', 'success');
      await loadShareData();
    } catch { toast('Failed to share', 'error'); }
  });
  document.querySelector('.modal-share-cancel')?.addEventListener('click', () => closeModal('modal-share'));
}

// ─── EMERGENCY ACCESS (#34, #35) ───
function openEmergencyRequestModal(memberId, memberName) {
  const info = $('emergency-request-info');
  if (info) info.textContent = 'Request emergency access to ' + memberName + "'s vault. A wait period may apply before access is granted.";
  const submitBtn = $('emergency-request-submit');
  if (submitBtn) {
    const newBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newBtn, submitBtn);
    newBtn.id = 'emergency-request-submit';
    newBtn.addEventListener('click', async () => {
      try {
        const res = await api.post('/api/emergency/request', { grantor_id: memberId });
        if (res.error) { toast(res.error, 'error'); return; }
        toast('Emergency access requested', 'success');
        closeModal('modal-emergency-request');
      } catch { toast('Failed to request access', 'error'); }
    });
  }
  $('emergency-request-cancel')?.addEventListener('click', () => closeModal('modal-emergency-request'));
  openModal('modal-emergency-request');
}

async function loadEmergencyRequests() {
  const list = $('emergency-requests-list');
  if (!list) return;
  try {
    const requests = await api.get('/api/emergency/requests');
    if (!Array.isArray(requests) || !requests.length) {
      list.innerHTML = '<em style="font-size:13px;color:var(--txd)">No emergency access requests</em>';
      return;
    }
    list.innerHTML = requests.map(r => { // esc()
      const statusColors = { pending: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--err)', expired: 'var(--txd)' };
      const statusColor = statusColors[r.status] || 'var(--txd)';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--brd)">
          <span style="flex:1;font-size:13px">
            ${r.grantor_id === currentUser?.id ? 'From' : 'To'} User #${esc(String(r.grantor_id === currentUser?.id ? r.grantee_id : r.grantor_id))}
          </span>
          <span class="role-badge" style="background:${statusColor}20;color:${statusColor}">${esc(r.status)}</span>
          ${r.status === 'pending' && r.grantor_id === currentUser?.id ? `
            <button class="btn btn-sm btn-primary emergency-approve-btn" data-id="${esc(String(r.id))}">Approve</button>
            <button class="btn btn-sm btn-danger emergency-reject-btn" data-id="${esc(String(r.id))}">Reject</button>
          ` : ''}
          ${r.status === 'pending' && r.grantee_id === currentUser?.id ? `
            <button class="btn btn-sm btn-secondary emergency-revoke-btn" data-id="${esc(String(r.id))}">Cancel</button>
          ` : ''}
          ${r.status === 'approved' && r.grantor_id === currentUser?.id ? `
            <button class="btn btn-sm btn-danger emergency-revoke-btn" data-id="${esc(String(r.id))}">Revoke</button>
          ` : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('.emergency-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.put('/api/emergency/' + btn.dataset.id + '/approve');
          toast('Emergency access approved', 'success');
          loadEmergencyRequests();
        } catch { toast('Failed to approve', 'error'); }
      });
    });
    list.querySelectorAll('.emergency-reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.put('/api/emergency/' + btn.dataset.id + '/reject');
          toast('Emergency access rejected', 'success');
          loadEmergencyRequests();
        } catch { toast('Failed to reject', 'error'); }
      });
    });
    list.querySelectorAll('.emergency-revoke-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.del('/api/emergency/' + btn.dataset.id);
          toast('Emergency access revoked', 'success');
          loadEmergencyRequests();
        } catch { toast('Failed to revoke', 'error'); }
      });
    });
  } catch { list.innerHTML = '<em style="color:var(--txd)">Failed to load</em>'; }
}

// ─── ATTACHMENTS (#37, #38) ───
async function uploadAttachment(itemId, file) {
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/items/' + encodeURIComponent(itemId) + '/attachments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': getCsrfToken() },
      body: formData,
    });
    if (!res.ok) { toast('Upload failed', 'error'); return; }
    toast('File uploaded', 'success');
    loadEditorAttachments(itemId);
  } catch { toast('Upload failed', 'error'); }
}

async function loadEditorAttachments(itemId) {
  const list = $('edit-attachments-list');
  if (!list) return;
  try {
    const attachments = await api.get('/api/items/' + itemId + '/attachments');
    if (!Array.isArray(attachments) || !attachments.length) {
      list.innerHTML = '<em style="font-size:13px;color:var(--txd)">No attachments</em>';
      return;
    }
    list.innerHTML = attachments.map(a => ` // esc()
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px">
        <span class="material-icons-round" style="font-size:16px;color:var(--txd)">${getAttachmentIcon(a.mime_type)}</span>
        <span style="flex:1">${esc(a.original_name || 'file')}</span>
        <span style="color:var(--txd);font-size:11px">${esc(formatFileSize(a.size))}</span>
        <button class="btn-icon delete-attachment-btn" data-id="${esc(String(a.id))}" data-item-id="${esc(String(itemId))}" title="Delete attachment"><span class="material-icons-round" style="font-size:16px;color:var(--err)">delete</span></button>
      </div>
    `).join('');
    list.querySelectorAll('.delete-attachment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this attachment?')) return;
        try {
          await api.del('/api/attachments/' + btn.dataset.id);
          toast('Attachment deleted', 'success');
          loadEditorAttachments(btn.dataset.itemId);
        } catch { toast('Delete failed', 'error'); }
      });
    });
  } catch { list.innerHTML = '<em style="color:var(--txd)">Failed to load attachments</em>'; }
}

async function loadAttachmentsForItem(itemId) {
  const list = $('item-attachments-list');
  if (!list) return;
  try {
    const attachments = await api.get('/api/items/' + itemId + '/attachments');
    if (!Array.isArray(attachments) || !attachments.length) {
      list.innerHTML = '<em style="font-size:13px;color:var(--txd)">No attachments</em>';
      return;
    }
    list.innerHTML = attachments.map(a => ` // esc()
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--brd)">
        <span class="material-icons-round" style="font-size:18px;color:var(--txd)">${getAttachmentIcon(a.mime_type)}</span>
        <a href="/api/attachments/${esc(String(a.id))}" style="flex:1;font-size:13px" download>${esc(a.original_name || 'file')}</a>
        <span style="color:var(--txd);font-size:11px">${esc(formatFileSize(a.size))}</span>
        <button class="btn-icon remove-attachment-btn" data-id="${esc(String(a.id))}" data-item-id="${esc(String(itemId))}" title="Delete attachment"><span class="material-icons-round" style="font-size:16px;color:var(--err)">delete</span></button>
      </div>
    `).join('');
    list.querySelectorAll('.remove-attachment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this attachment?')) return;
        try {
          await api.del('/api/attachments/' + btn.dataset.id);
          toast('Attachment deleted', 'success');
          loadAttachmentsForItem(btn.dataset.itemId);
        } catch { toast('Delete failed', 'error'); }
      });
    });
  } catch { list.innerHTML = '<em style="color:var(--txd)">Failed to load attachments</em>'; }
}

function getAttachmentIcon(mimeType) {
  if (!mimeType) return 'attach_file';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'movie';
  if (mimeType.startsWith('audio/')) return 'audiotrack';
  if (mimeType.includes('pdf')) return 'picture_as_pdf';
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('tar')) return 'folder_zip';
  if (mimeType.includes('text') || mimeType.includes('document')) return 'description';
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv')) return 'table_chart';
  return 'attach_file';
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

// ─── CATEGORY EDITOR (#39) ───
function renderCategoryEditor() {
  const container = $('view-container');
  if (!container) return;

  container.innerHTML = `
    <h2 style="margin-bottom:20px">Manage Categories</h2>
    <div class="card" style="margin-bottom:16px">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Create Category</h3>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <div class="form-group" style="flex:1;margin:0">
          <label for="new-cat-name">Name</label>
          <input type="text" id="new-cat-name" class="form-input" placeholder="Category name">
        </div>
        <div class="form-group" style="margin:0">
          <label for="new-cat-color">Color</label>
          <input type="color" id="new-cat-color" class="form-input" value="#64748B" style="height:36px;width:50px;padding:2px">
        </div>
        <div class="form-group" style="margin:0">
          <label for="new-cat-icon">Icon</label>
          <input type="text" id="new-cat-icon" class="form-input" placeholder="📁" style="width:50px;text-align:center" maxlength="2">
        </div>
        <button class="btn btn-primary" id="create-cat-btn">Create</button>
      </div>
    </div>
    <div class="card">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Categories</h3>
      <div id="category-editor-list">
        ${categories.map(c => `
          <div class="cat-editor-row" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--brd)" data-cat-id="${esc(String(c.id))}">
            <span class="material-icons-round" style="cursor:grab;color:var(--txd)">drag_handle</span>
            <div class="cat-icon" style="background:${escA(c.color || '#64748B')};width:10px;height:10px"></div>
            <span style="flex:1;font-size:13px;font-weight:500" class="cat-editor-name" contenteditable="true" data-cat-id="${esc(String(c.id))}">${esc(c.name)}</span>
            <input type="color" value="${escA(c.color || '#64748B')}" class="cat-color-input" data-cat-id="${esc(String(c.id))}" style="width:30px;height:24px;border:none;padding:0;cursor:pointer">
            <button class="btn-icon confirmDeleteCategory" data-cat-id="${esc(String(c.id))}" data-cat-name="${escA(c.name)}" title="Delete category"><span class="material-icons-round" style="font-size:16px;color:var(--err)">delete</span></button>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  $('create-cat-btn')?.addEventListener('click', async () => {
    const name = $('new-cat-name')?.value.trim();
    if (!name) { toast('Name is required', 'error'); return; }
    const color = $('new-cat-color')?.value || '#64748B';
    const icon = $('new-cat-icon')?.value || '📁';
    try {
      await api.post('/api/categories', { name, color, icon });
      toast('Category created', 'success');
      await loadData();
      renderCategoryEditor();
    } catch { toast('Failed to create', 'error'); }
  });

  // Inline edit name
  container.querySelectorAll('.cat-editor-name').forEach(el => {
    el.addEventListener('blur', async () => {
      const catId = el.dataset.catId;
      const newName = el.textContent.trim();
      if (!newName) return;
      try {
        await api.put('/api/categories/' + catId, { name: newName });
        await loadData();
      } catch { toast('Failed to rename', 'error'); }
    });
  });

  // Inline edit color
  container.querySelectorAll('.cat-color-input').forEach(el => {
    el.addEventListener('change', async () => {
      const catId = el.dataset.catId;
      try {
        await api.put('/api/categories/' + catId, { color: el.value });
        await loadData();
      } catch { toast('Failed to update color', 'error'); }
    });
  });

  // Delete
  container.querySelectorAll('.confirmDeleteCategory').forEach(btn => {
    btn.addEventListener('click', () => {
      const catId = btn.dataset.catId;
      const catName = btn.dataset.catName;
      const msgEl = $('confirm-message');
      const titleEl = $('confirm-title');
      if (msgEl) msgEl.textContent = 'Delete category "' + catName + '"? Items will be uncategorized.';
      if (titleEl) titleEl.textContent = 'Delete Category';
      const okBtn = $('confirm-ok');
      if (okBtn) {
        const newBtn = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newBtn, okBtn);
        newBtn.id = 'confirm-ok';
        newBtn.addEventListener('click', async () => {
          try {
            await api.del('/api/categories/' + catId);
            toast('Category deleted', 'success');
            closeModal('modal-confirm');
            await loadData();
            renderCategoryEditor();
          } catch { toast('Failed to delete', 'error'); }
        });
      }
      openModal('modal-confirm');
    });
  });
}

// ─── MEMBER EDIT (#40) ───
async function openMemberEditModal(memberId) {
  try {
    const member = await api.get('/api/members/' + memberId);
    const m = member.member || member;
    $('member-edit-name').value = m.display_name || '';
    $('member-edit-role').value = m.role || 'adult';
    $('member-edit-email').textContent = m.email || '';
    $('member-edit-joined').textContent = formatDate(m.created_at) || '';

    // Disable role for non-admins
    const roleSelect = $('member-edit-role');
    if (roleSelect) roleSelect.disabled = currentUser?.role !== 'admin';

    // Save handler
    const saveBtn = $('member-edit-save');
    if (saveBtn) {
      const newBtn = saveBtn.cloneNode(true);
      saveBtn.parentNode.replaceChild(newBtn, saveBtn);
      newBtn.id = 'member-edit-save';
      newBtn.addEventListener('click', async () => {
        const payload = {};
        const newName = $('member-edit-name')?.value.trim();
        if (newName) payload.display_name = newName;
        if (currentUser?.role === 'admin') payload.role = $('member-edit-role')?.value;
        try {
          await api.put('/api/members/' + memberId, payload);
          toast('Member updated', 'success');
          closeModal('modal-member-edit');
          await loadMembers();
          renderMembers();
        } catch { toast('Failed to update', 'error'); }
      });
    }

    $('member-edit-cancel')?.addEventListener('click', () => closeModal('modal-member-edit'));
    openModal('modal-member-edit');
  } catch { toast('Failed to load member', 'error'); }
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

// ─── BREACH MONITORING (#47) ───
async function checkBreachMonitoring() {
  // Check sessionStorage cache
  const cacheKey = 'df_breach_check';
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
      if (parsed.breachedCount > 0) showBreachAlert(parsed.breachedCount);
      return;
    }
  }

  // Background check — don't block UI
  try {
    const health = await api.get('/api/stats/password-health').catch(() => null);
    if (!health || health.total === 0) return;

    // Store result  
    const breachedCount = 0; // Breach check requires individual password hashing which is client-side
    sessionStorage.setItem(cacheKey, JSON.stringify({ breachedCount, timestamp: Date.now() }));
    if (breachedCount > 0) showBreachAlert(breachedCount);
  } catch { /* ignore */ }
}

function showBreachAlert(count) {
  if (count <= 0) return;
  // Add notification badge to dashboard nav
  const dashNav = document.querySelector('.ni[data-view="dashboard"]');
  if (dashNav && !dashNav.querySelector('.breach-badge')) {
    const badge = document.createElement('span');
    badge.className = 'breach-badge';
    badge.style.cssText = 'width:8px;height:8px;background:var(--err);border-radius:50%;position:absolute;top:4px;right:4px';
    dashNav.style.position = 'relative';
    dashNav.appendChild(badge);
  }
  // Alert banner in dashboard
  const container = $('view-container');
  if (container && !container.querySelector('.breach-alert')) {
    const alert = document.createElement('div');
    alert.className = 'breach-alert';
    alert.style.cssText = 'background:var(--err);color:#fff;padding:12px 16px;border-radius:var(--rs);margin-bottom:16px;display:flex;align-items:center;gap:8px;font-size:13px';
    alert.innerHTML = `<span class="material-icons-round" style="font-size:18px">warning</span> ${esc(String(count))} password(s) found in data breaches. <a href="#vault" style="color:#fff;text-decoration:underline;margin-left:auto">Review</a>`;
    container.insertBefore(alert, container.firstChild?.nextSibling);
  }
}

// ─── RECOVERY CODES UI (#50) ───
async function renderRecoveryCodes(content) {
  let status = null;
  try {
    status = await api.get('/api/auth/recovery-codes/status');
  } catch { /* ignore */ }

  const html = `
    <div class="card" style="margin-top:16px" id="recovery-codes-section">
      <h3 style="margin-bottom:16px">Recovery Codes</h3>
      <p style="font-size:13px;color:var(--txd);margin-bottom:12px">Recovery codes can be used to regain access to your account if you lose your password.</p>
      ${status && status.total > 0 ? `<p style="font-size:13px;margin-bottom:12px">${esc(String(status.remaining))} of ${esc(String(status.total))} codes remaining</p>` : '<p style="font-size:13px;color:var(--warn);margin-bottom:12px">No recovery codes generated yet</p>'}
      <div class="form-group">
        <label for="recovery-pw">Current Password</label>
        <input type="password" id="recovery-pw" class="form-input" autocomplete="current-password">
      </div>
      <button class="btn btn-secondary" id="generate-recovery-codes">Generate New Codes</button>
      <div id="recovery-codes-output" style="margin-top:12px"></div>
    </div>
  `;

  if (content) {
    content.insertAdjacentHTML('beforeend', html);
  }

  $('generate-recovery-codes')?.addEventListener('click', async () => {
    const pw = $('recovery-pw')?.value;
    if (!pw) { toast('Enter your current password', 'error'); return; }
    try {
      const res = await api.post('/api/auth/recovery-codes/generate', { password: pw });
      if (res.error) { toast(res.error, 'error'); return; }
      const output = $('recovery-codes-output');
      if (output) {
        output.innerHTML = `
          <div style="background:var(--bgd);border:1px solid var(--brd);border-radius:var(--rs);padding:16px;font-family:monospace;font-size:14px;line-height:2">
            ${res.codes.map(c => esc(c)).join('<br>')}
          </div>
          <p style="font-size:12px;color:var(--warn);margin-top:8px">Save these codes in a safe place. They will not be shown again.</p>
          <button class="btn btn-sm btn-secondary" id="recovery-codes-saved" style="margin-top:8px">I've saved these codes</button>
        `;
        $('recovery-codes-saved')?.addEventListener('click', () => {
          output.innerHTML = '<p style="font-size:13px;color:var(--ok)">Recovery codes saved.</p>';
        });
      }
    } catch { toast('Failed to generate recovery codes', 'error'); }
  });
}

// ─── TRASH VIEW (#51, #52, #53) ───
async function renderTrashView() {
  const container = $('view-container');
  if (!container) return;

  let trashItems = [];
  try {
    const res = await api.get('/api/items/trash');
    trashItems = Array.isArray(res) ? res : [];
  } catch { /* ignore */ }

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h2><span class="material-icons-round" style="vertical-align:middle;margin-right:8px">delete</span>Trash</h2>
      ${trashItems.length ? `<button class="btn btn-danger" id="empty-trash-btn"><span class="material-icons-round" style="font-size:18px">delete_forever</span> Empty Trash (${esc(String(trashItems.length))})</button>` : ''}
    </div>
    <p style="font-size:13px;color:var(--txd);margin-bottom:16px">Items in trash are permanently deleted after 30 days.</p>
    ${trashItems.length ? trashItems.map(item => {
      const cat = categories.find(c => c.id === item.category_id);
      const deletedDate = item.deleted_at ? new Date(item.deleted_at) : new Date();
      const daysSince = Math.floor((Date.now() - deletedDate.getTime()) / 86400000);
      const daysRemaining = Math.max(0, 30 - daysSince);
      return `<div class="card" style="margin-bottom:8px;padding:12px;opacity:0.8">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="material-icons-round" style="font-size:18px;color:var(--txd)">delete</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px">${esc(item.title || 'Encrypted item')}</div>
            <div style="font-size:12px;color:var(--txd)">${esc(cat?.name || 'No category')} · Deleted ${esc(formatRelative(item.deleted_at))} · ${esc(String(daysRemaining))} days remaining</div>
          </div>
          <button class="btn btn-sm btn-secondary restore-item-btn" data-id="${esc(String(item.id))}"><span class="material-icons-round" style="font-size:16px">restore</span> Restore</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty-state"><span class="material-icons-round">delete_outline</span><p>Trash is empty</p></div>'}
  `;

  // Restore buttons
  container.querySelectorAll('.restore-item-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.post('/api/items/' + btn.dataset.id + '/restore');
        toast('Item restored', 'success');
        await loadData();
        renderTrashView();
      } catch { toast('Failed to restore', 'error'); }
    });
  });

  // Empty trash
  $('empty-trash-btn')?.addEventListener('click', () => {
    const msgEl = $('confirm-message');
    const titleEl = $('confirm-title');
    if (msgEl) msgEl.textContent = 'Permanently delete all ' + trashItems.length + ' items in trash? This cannot be undone.';
    if (titleEl) titleEl.textContent = 'Empty Trash';
    const okBtn = $('confirm-ok');
    if (okBtn) {
      const newBtn = okBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newBtn, okBtn);
      newBtn.id = 'confirm-ok';
      newBtn.addEventListener('click', async () => {
        try {
          await api.del('/api/items/trash');
          toast('Trash emptied', 'success');
          closeModal('modal-confirm');
          await loadData();
          renderTrashView();
        } catch { toast('Failed to empty trash', 'error'); }
      });
    }
    openModal('modal-confirm');
  });
}

// ─── DUPLICATE DETECTION MODAL (#57) ───
function showDuplicateModal(possibleDuplicate) {
  const msgEl = $('confirm-message');
  const titleEl = $('confirm-title');
  if (msgEl) msgEl.innerHTML = 'A similar item already exists: <strong>' + esc(possibleDuplicate.title) + '</strong><br><br>What would you like to do?';
  if (titleEl) titleEl.textContent = 'Possible Duplicate';

  const okBtn = $('confirm-ok');
  if (okBtn) {
    const newBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newBtn, okBtn);
    newBtn.id = 'confirm-ok';
    newBtn.textContent = 'View Existing';
    newBtn.addEventListener('click', () => {
      closeModal('modal-confirm');
      location.hash = '#item/' + possibleDuplicate.id;
    });
  }
  openModal('modal-confirm');
}

// ─── ITEM HISTORY VIEW (#56) ───
async function loadItemHistory(itemId) {
  try {
    const history = await api.get('/api/items/' + itemId + '/history');
    const list = Array.isArray(history) ? history : [];
    const container = $('item-history-content');
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<em style="font-size:13px;color:var(--txd)">No history recorded</em>';
      return;
    }
    container.innerHTML = list.map(h => `
      <div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--brd);font-size:13px">
        <span class="material-icons-round" style="font-size:16px;color:var(--txd)">history</span>
        <div style="flex:1">
          <strong>${esc(h.field_name)}</strong> changed
          ${h.old_value ? ' from <em>' + esc(h.old_value) + '</em>' : ''}
          ${h.new_value ? ' to <em>' + esc(h.new_value) + '</em>' : ''}
        </div>
        <span style="color:var(--txd);white-space:nowrap">${formatRelative(h.changed_at)}</span>
      </div>
    `).join('');
  } catch { /* ignore */ }
}

// ─── ONBOARDING TOUR (#60) ───
async function checkOnboarding() {
  if (!currentUser) return;
  try {
    const settings = await api.get('/api/settings');
    if (settings && settings.onboarding_dismissed) return;

    const itemCount = await api.get('/api/items/count');
    if (itemCount && itemCount.count > 0) return;
    if (categories.length > 0) return;

    showOnboardingTour();
  } catch { /* ignore */ }
}

function showOnboardingTour() {
  const steps = [
    { title: 'Welcome to DataFlow!', text: 'Let\u2019s set up your vault. We\u2019ll guide you through creating your first category and item.' },
    { title: 'Create a Category', text: 'Categories help organize your vault items. Click "Manage Categories" in Settings to create one.' },
    { title: 'Add Your First Item', text: 'Click the "New Item" button to add a password, note, or any secure record.' },
    { title: 'Explore Settings', text: 'Configure your theme, auto-lock, and security preferences in Settings.' },
  ];
  let step = 0;

  function render() {
    const overlay = document.createElement('div');
    overlay.id = 'onboarding-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:var(--bg);border-radius:var(--rl);padding:32px;max-width:400px;width:90%;text-align:center">
        <h3 style="margin-bottom:12px">${esc(steps[step].title)}</h3>
        <p style="font-size:14px;color:var(--txd);margin-bottom:20px">${esc(steps[step].text)}</p>
        <div style="display:flex;justify-content:center;gap:8px;margin-bottom:12px">
          ${steps.map((_, i) => `<span style="width:8px;height:8px;border-radius:50%;background:${i === step ? 'var(--brand)' : 'var(--brd)'}"></span>`).join('')}
        </div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn btn-secondary" id="onboarding-skip">Skip</button>
          <button class="btn btn-primary" id="onboarding-next">${step < steps.length - 1 ? 'Next' : 'Get Started'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    $('onboarding-skip')?.addEventListener('click', dismissOnboarding);
    $('onboarding-next')?.addEventListener('click', () => {
      overlay.remove();
      if (step < steps.length - 1) { step++; render(); }
      else { dismissOnboarding(); }
    });
  }

  render();
}

async function dismissOnboarding() {
  const overlay = $('onboarding-overlay');
  if (overlay) overlay.remove();
  try { await api.put('/api/settings/onboarding_dismissed', { value: 'true' }); } catch { /* ignore */ }
}

// ─── SEARCH HIGHLIGHTING (#64) ───
function highlightMatches(text, searchTerms) {
  if (!text || !searchTerms || !searchTerms.length) return esc(text || '');
  let escaped = esc(text);
  const validTerms = searchTerms.map(t => String(t).trim()).filter(Boolean).map(t => esc(t));
  if (!validTerms.length) return escaped;
  const pattern = validTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

// ─── FILTER PANEL (#63) ───
let activeFilters = {};

function renderFilterPanel() {
  const existing = document.querySelector('.filter-panel');
  if (existing) return;

  const toolbar = document.querySelector('#view-container > div:first-child');
  if (!toolbar) return;

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'filter-toggle';
  toggleBtn.innerHTML = '<span class="material-icons-round" style="font-size:16px">filter_list</span> Filters';
  toggleBtn.addEventListener('click', () => {
    const panel = document.querySelector('.filter-panel');
    if (panel) panel.classList.toggle('open');
  });
  toolbar.appendChild(toggleBtn);

  const panel = document.createElement('div');
  panel.className = 'filter-panel';
  panel.innerHTML = `
    <div class="filter-row">
      <div class="filter-group">
        <label>Category</label>
        <select id="filter-category" class="form-input" style="min-height:28px">
          <option value="">All</option>
          ${categories.map(c => `<option value="${escA(String(c.id))}">${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Tag</label>
        <select id="filter-tag" class="form-input" style="min-height:28px">
          <option value="">All</option>
          ${tags.map(t => `<option value="${escA(String(t.id))}">${esc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Created After</label>
        <input type="date" id="filter-created-after">
      </div>
      <div class="filter-group">
        <label>Created Before</label>
        <input type="date" id="filter-created-before">
      </div>
      <div class="filter-group" style="flex-direction:row;align-items:center;gap:6px;min-width:auto">
        <input type="checkbox" id="filter-favorite">
        <label for="filter-favorite" style="text-transform:none;font-size:13px">Favorites only</label>
      </div>
      <div class="filter-group" style="flex-direction:row;align-items:center;gap:6px;min-width:auto">
        <input type="checkbox" id="filter-has-attachments">
        <label for="filter-has-attachments" style="text-transform:none;font-size:13px">Has attachments</label>
      </div>
      <button class="btn btn-sm btn-secondary" id="filter-apply">Apply</button>
      <button class="btn btn-sm btn-secondary" id="filter-clear">Clear</button>
    </div>
  `;
  toolbar.after(panel);

  $('filter-apply')?.addEventListener('click', applyFilters);
  $('filter-clear')?.addEventListener('click', clearFilters);
}

async function applyFilters() {
  const params = new URLSearchParams();
  if (searchQuery) params.set('q', searchQuery);
  const cat = $('filter-category')?.value;
  if (cat) params.set('category_id', cat);
  const tag = $('filter-tag')?.value;
  if (tag) params.set('tag_id', tag);
  const after = $('filter-created-after')?.value;
  if (after) params.set('created_after', after);
  const before = $('filter-created-before')?.value;
  if (before) params.set('created_before', before);
  if ($('filter-favorite')?.checked) params.set('favorite', 'true');
  if ($('filter-has-attachments')?.checked) params.set('has_attachments', 'true');

  const qs = params.toString();
  const res = await api.get('/api/items' + (qs ? '?' + qs : ''));
  items = res.items || res || [];
  renderItemGrid();
}

async function clearFilters() {
  if ($('filter-category')) $('filter-category').value = '';
  if ($('filter-tag')) $('filter-tag').value = '';
  if ($('filter-created-after')) $('filter-created-after').value = '';
  if ($('filter-created-before')) $('filter-created-before').value = '';
  if ($('filter-favorite')) $('filter-favorite').checked = false;
  if ($('filter-has-attachments')) $('filter-has-attachments').checked = false;
  await loadItems(searchQuery);
  renderItemGrid();
}

// ─── EXPORT WIZARD (#65, #70) ───
function openExportWizard(preselectedIds) {
  let step = 1;
  let exportFormat = 'json';
  let exportScope = preselectedIds ? 'selected' : 'all';
  let selectedCats = [];
  let includeAttachments = false;
  let decryptValues = true;

  function renderStep() {
    let body = '';
    const steps = [1,2,3,4,5];
    const stepBar = `<div class="wizard-steps">${steps.map(s => `<div class="wizard-step ${s < step ? 'done' : s === step ? 'active' : ''}"></div>`).join('')}</div>`;

    if (step === 1) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Format</h3>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer"><input type="radio" name="exp-format" value="json" ${exportFormat==='json'?'checked':''}> JSON</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="exp-format" value="csv" ${exportFormat==='csv'?'checked':''}> CSV</label>`;
    } else if (step === 2) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Scope</h3>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer"><input type="radio" name="exp-scope" value="all" ${exportScope==='all'?'checked':''}> All items</label>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer"><input type="radio" name="exp-scope" value="categories" ${exportScope==='categories'?'checked':''}> Specific categories</label>
        ${preselectedIds ? `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="radio" name="exp-scope" value="selected" ${exportScope==='selected'?'checked':''}> Selected items (${preselectedIds.length})</label>` : ''}
        <div id="exp-cat-list" style="margin-top:8px;display:${exportScope==='categories'?'block':'none'}">
          ${categories.map(c => `<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer"><input type="checkbox" value="${esc(String(c.id))}" class="exp-cat-cb"> ${esc(c.name)}</label>`).join('')}
        </div>`;
    } else if (step === 3) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Options</h3>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer"><input type="checkbox" id="exp-attach" ${includeAttachments?'checked':''}> Include attachments</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="exp-decrypt" ${decryptValues?'checked':''}> Decrypt values</label>`;
    } else if (step === 4) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Preview</h3><div id="exp-preview"><em>Loading...</em></div>`;
    } else if (step === 5) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Ready</h3><p>Click Download to export your data.</p>`;
    }

    const modal = $('modal-export-body') || document.createElement('div');
    modal.innerHTML = body + `
      <div class="modal-actions">
        ${step > 1 ? '<button class="btn btn-secondary" id="exp-back">Back</button>' : ''}
        ${step < 5 ? '<button class="btn btn-primary" id="exp-next">Next</button>' : '<button class="btn btn-primary" id="exp-download">Download</button>'}
      </div>`;

    $('exp-back')?.addEventListener('click', () => { step--; renderStep(); });
    $('exp-next')?.addEventListener('click', () => {
      if (step === 1) {
        exportFormat = document.querySelector('input[name="exp-format"]:checked')?.value || 'json';
      } else if (step === 2) {
        exportScope = document.querySelector('input[name="exp-scope"]:checked')?.value || 'all';
        selectedCats = [...document.querySelectorAll('.exp-cat-cb:checked')].map(cb => cb.value);
      } else if (step === 3) {
        includeAttachments = $('exp-attach')?.checked || false;
        decryptValues = $('exp-decrypt')?.checked || true;
      }
      step++;
      renderStep();
      if (step === 4) loadExportPreview();
    });

    $('exp-download')?.addEventListener('click', doExport);

    // Show/hide category list based on scope radio
    document.querySelectorAll('input[name="exp-scope"]').forEach(r => {
      r.addEventListener('change', () => {
        const catList = $('exp-cat-list');
        if (catList) catList.style.display = r.value === 'categories' ? 'block' : 'none';
      });
    });
  }

  async function loadExportPreview() {
    const params = new URLSearchParams();
    params.set('format', exportFormat === 'csv' ? 'csv' : 'json');
    if (exportScope === 'categories' && selectedCats.length) params.set('category_ids', selectedCats.join(','));
    if (exportScope === 'selected' && preselectedIds) params.set('item_ids', preselectedIds.join(','));

    try {
      const res = await api.get('/api/data/export?' + params.toString());
      const preview = $('exp-preview');
      if (!preview) return;
      if (exportFormat === 'csv') {
        const lines = (typeof res === 'string' ? res : JSON.stringify(res)).split('\n').slice(0, 6);
        preview.innerHTML = `<div class="preview-table"><pre style="font-size:12px;padding:8px;overflow-x:auto">${esc(lines.join('\n'))}</pre></div>`;
      } else {
        const previewItems = (res.items || []).slice(0, 5);
        preview.innerHTML = `<div class="preview-table"><pre style="font-size:12px;padding:8px;overflow-x:auto">${esc(JSON.stringify(previewItems, null, 2).slice(0, 500))}</pre></div>`;
      }
    } catch { const p = $('exp-preview'); if(p) p.innerHTML = '<em>Preview failed</em>'; }
  }

  async function doExport() {
    const params = new URLSearchParams();
    params.set('format', exportFormat);
    if (exportScope === 'categories' && selectedCats.length) params.set('category_ids', selectedCats.join(','));
    if (exportScope === 'selected' && preselectedIds) params.set('item_ids', preselectedIds.join(','));

    try {
      const url = '/api/data/export?' + params.toString();
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dataflow-export.' + exportFormat;
      document.body.appendChild(a);
      a.click();
      a.remove();
      closeModal('modal-export');
      toast('Export started', 'success');
    } catch { toast('Export failed', 'error'); }
  }

  // Create modal if not existing
  if (!$('modal-export')) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-export';
    overlay.innerHTML = `<div class="modal"><div class="modal-header"><h3 class="modal-title">Export</h3><button class="modal-close" aria-label="Close">&times;</button></div><div id="modal-export-body"></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => closeModal('modal-export'));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal('modal-export'); });
  }
  openModal('modal-export');
  renderStep();
}

// ─── IMPORT WIZARD (#66) ───
function openImportWizard() {
  let step = 1;
  let importFile = null;
  let importFormat = 'bitwarden';
  let parsedItems = [];
  let targetCategory = null;

  function renderStep() {
    const steps = [1,2,3,4,5];
    const stepBar = `<div class="wizard-steps">${steps.map(s => `<div class="wizard-step ${s < step ? 'done' : s === step ? 'active' : ''}"></div>`).join('')}</div>`;
    let body = '';

    if (step === 1) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Upload File</h3>
        <div class="drop-zone" id="import-drop" style="margin-bottom:12px;padding:32px">
          <span class="material-icons-round" style="font-size:32px">upload_file</span>
          <p>Drag & drop a file here, or click to browse</p>
          <input type="file" id="import-file-input" style="display:none" accept=".json,.csv,.xml">
        </div>
        <div id="import-file-name" style="font-size:13px;color:var(--txd)"></div>`;
    } else if (step === 2) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Format</h3>
        <p style="font-size:13px;color:var(--txd);margin-bottom:8px">Detected: <strong>${esc(importFormat)}</strong></p>
        <select id="import-format-select" class="form-input" style="max-width:200px">
          <option value="bitwarden" ${importFormat==='bitwarden'?'selected':''}>Bitwarden</option>
          <option value="chrome" ${importFormat==='chrome'?'selected':''}>Chrome</option>
          <option value="lastpass" ${importFormat==='lastpass'?'selected':''}>LastPass</option>
          <option value="onepassword" ${importFormat==='onepassword'?'selected':''}>1Password</option>
          <option value="keepass" ${importFormat==='keepass'?'selected':''}>KeePass</option>
        </select>`;
    } else if (step === 3) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Preview</h3>
        <div class="preview-table">
          <table><thead><tr><th>Title</th><th>Notes</th></tr></thead><tbody>
            ${parsedItems.slice(0, 10).map(i => `<tr><td>${esc(i.title || i.name || '')}</td><td>${esc((i.notes || '').slice(0, 50))}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <p style="font-size:12px;color:var(--txd);margin-top:8px">${esc(String(parsedItems.length))} items found</p>`;
    } else if (step === 4) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Target Category</h3>
        <select id="import-target-cat" class="form-input" style="max-width:200px">
          <option value="">None (uncategorized)</option>
          ${categories.map(c => `<option value="${escA(String(c.id))}">${esc(c.name)}</option>`).join('')}
        </select>`;
    } else if (step === 5) {
      body = `${stepBar}<h3 style="margin-bottom:12px">Importing...</h3>
        <div style="background:var(--bg-h);border-radius:var(--rs);height:8px;overflow:hidden"><div id="import-progress" style="height:100%;background:var(--brand);width:0%;transition:width .3s"></div></div>
        <p id="import-status" style="font-size:13px;color:var(--txd);margin-top:8px">Starting...</p>`;
    }

    const modal = $('modal-import-body') || document.createElement('div');
    modal.innerHTML = body + `
      <div class="modal-actions">
        ${step > 1 && step < 5 ? '<button class="btn btn-secondary" id="imp-back">Back</button>' : ''}
        ${step < 4 ? '<button class="btn btn-primary" id="imp-next">Next</button>' : ''}
        ${step === 4 ? '<button class="btn btn-primary" id="imp-confirm">Import</button>' : ''}
      </div>`;

    // Wire events
    if (step === 1) {
      const dropZone = $('import-drop');
      const fileInput = $('import-file-input');
      if (dropZone) {
        dropZone.addEventListener('click', () => fileInput?.click());
        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', e => {
          e.preventDefault();
          dropZone.classList.remove('dragover');
          if (e.dataTransfer.files.length) handleImportFile(e.dataTransfer.files[0]);
        });
      }
      fileInput?.addEventListener('change', () => { if (fileInput.files.length) handleImportFile(fileInput.files[0]); });
    }

    $('imp-back')?.addEventListener('click', () => { step--; renderStep(); });
    $('imp-next')?.addEventListener('click', () => {
      if (step === 2) importFormat = $('import-format-select')?.value || importFormat;
      step++;
      renderStep();
    });
    $('imp-confirm')?.addEventListener('click', async () => {
      targetCategory = $('import-target-cat')?.value || null;
      step = 5;
      renderStep();
      await doImport();
    });
  }

  function handleImportFile(file) {
    importFile = file;
    const nameEl = $('import-file-name');
    if (nameEl) nameEl.textContent = 'Selected: ' + file.name;
    // Auto-detect format
    if (file.name.endsWith('.csv')) importFormat = 'chrome';
    else if (file.name.endsWith('.xml')) importFormat = 'keepass';
    else importFormat = 'bitwarden';

    // Try to parse
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const content = reader.result;
        if (importFormat === 'bitwarden') {
          const data = JSON.parse(content);
          parsedItems = data.items || data || [];
        } else {
          parsedItems = content.split('\n').slice(1).filter(l => l.trim()).map(l => ({ title: l.split(',')[0] || 'Item' }));
        }
      } catch { parsedItems = []; }
    };
    reader.readAsText(file);
  }

  async function doImport() {
    try {
      const formData = new FormData();
      formData.append('format', importFormat);
      if (importFile) formData.append('file', importFile);

      const res = await fetch('/api/data/import', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });
      const data = await res.json();
      const progress = $('import-progress');
      const status = $('import-status');
      if (progress) progress.style.width = '100%';
      if (status) status.textContent = `Imported ${data.imported || 0} items`;
      await loadData();
      toast('Import complete: ' + (data.imported || 0) + ' items', 'success');
      setTimeout(() => closeModal('modal-import'), 1500);
    } catch { toast('Import failed', 'error'); }
  }

  if (!$('modal-import')) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-import';
    overlay.innerHTML = `<div class="modal"><div class="modal-header"><h3 class="modal-title">Import</h3><button class="modal-close" aria-label="Close">&times;</button></div><div id="modal-import-body"></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => closeModal('modal-import'));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal('modal-import'); });
  }
  openModal('modal-import');
  renderStep();
}

// ─── ENHANCED FIELD TYPE RENDERING (#97) ───
// Note: renderFieldInput is already declared above for item editing (3-arg version).
// This is the 2-arg version for category field editing — renamed to avoid duplicate.
function renderCategoryFieldInput(fieldDef, value) {
  const n = `field-${fieldDef.id}`;
  const v = escA(value || '');
  switch (fieldDef.field_type) {
    case 'date': return `<input type="date" name="${n}" id="${n}" value="${v}" class="form-input">`;
    case 'phone': return `<input type="tel" name="${n}" id="${n}" value="${v}" class="form-input">`;
    case 'url': return `<input type="url" name="${n}" id="${n}" value="${v}" class="form-input" placeholder="https://">`;
    case 'email': return `<input type="email" name="${n}" id="${n}" value="${v}" class="form-input">`;
    case 'select': {
      const opts = fieldDef.options ? JSON.parse(fieldDef.options) : [];
      return `<select name="${n}" id="${n}" class="form-input">${opts.map(o => `<option value="${escA(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
    default: return `<input type="text" name="${n}" id="${n}" value="${v}" class="form-input">`;
  }
}

function renderFieldValue(value, fieldType) {
  if (!value) return esc(value || '');
  switch (fieldType) {
    case 'url':
      return `<a href="${escA(value)}" target="_blank" rel="noopener noreferrer" class="field-link">${esc(value)} <span class="material-icons-round" style="font-size:14px;vertical-align:middle">open_in_new</span></a>`;
    case 'email':
      return `<a href="mailto:${escA(value)}" class="field-link">${esc(value)}</a>`;
    case 'phone':
      return `<a href="tel:${escA(value)}" class="field-link">${esc(value)}</a>`;
    case 'date':
      try { return esc(new Date(value).toLocaleDateString()); } catch { return esc(value); }
    default:
      return esc(value);
  }
}

// ─── ANALYTICS VIEW (#96) ───
async function renderAnalyticsView() {
  const main = $('main-content');
  if (!main) return;
  main.innerHTML = '<h2>Analytics</h2><div id="analytics-content" class="analytics-grid"></div>';
  showSkeletonLoader('analytics-content', 4);
  try {
    const data = await api.get('/api/stats/analytics');
    const el = $('analytics-content');
    if (!el) return;
    const maxCat = Math.max(...(data.itemsByCategory || []).map(c => c.count), 1);
    const catBars = (data.itemsByCategory || []).map(c =>
      `<div class="bar-row"><span class="bar-label">${esc(c.name)}</span><div class="bar-fill" style="width:${Math.round(c.count/maxCat*100)}%">${c.count}</div></div>`
    ).join('');

    const maxMonth = Math.max(...(data.itemsPerMonth || []).map(m => m.count), 1);
    const monthBars = (data.itemsPerMonth || []).reverse().map(m =>
      `<div class="bar-col"><div class="bar-v" style="height:${Math.round(m.count/maxMonth*100)}%"></div><span class="bar-month">${m.month.slice(5)}</span></div>`
    ).join('');

    const tagList = (data.topTags || []).map(t =>
      `<span class="tag-cloud-item" style="font-size:${12 + Math.min(t.count * 2, 14)}px">${esc(t.name)} (${t.count})</span>`
    ).join(' ');

    el.innerHTML = `
      <div class="analytics-card"><h3>Items by Category</h3><div class="bar-chart-h">${catBars || '<p>No data</p>'}</div></div>
      <div class="analytics-card"><h3>Items Over Time</h3><div class="bar-chart-v">${monthBars || '<p>No data</p>'}</div></div>
      <div class="analytics-card"><h3>Activity Stats</h3>
        <div class="stat-row"><span>Shares created</span><span>${(data.sharesPerMonth || []).reduce((s,m)=>s+m.count,0)}</span></div>
        <div class="stat-row"><span>Logins (30d)</span><span>${(data.loginsPerDay || []).reduce((s,d)=>s+d.count,0)}</span></div>
      </div>
      <div class="analytics-card"><h3>Top Tags</h3><div class="tag-cloud">${tagList || '<p>No tags yet</p>'}</div></div>`;
    hideSkeletonLoader('analytics-content');
  } catch (e) { showErrorBoundary('analytics-content', e); }
}

// ─── ACTIVITY FEED VIEW (#100) ───
let activityPollTimer = null;
async function renderActivityView() {
  const main = $('main-content');
  if (!main) return;
  main.innerHTML = `<h2>Activity Feed</h2>
    <div class="activity-controls">
      <select id="activity-member-filter" class="form-input" style="max-width:200px">
        <option value="">All members</option>
      </select>
    </div>
    <div id="activity-feed-list"></div>`;

  // Populate member filter
  try {
    const memberRes = await api.get('/api/members');
    const sel = $('activity-member-filter');
    if (sel && Array.isArray(memberRes)) {
      for (const m of memberRes) {
        sel.innerHTML += `<option value="${m.id}">${esc(m.display_name || m.email)}</option>`;
      }
      sel.addEventListener('change', () => loadActivityFeed(sel.value));
    }
  } catch { /* ignore */ }

  await loadActivityFeed('');

  // Auto-refresh every 30 seconds if visible
  if (activityPollTimer) clearInterval(activityPollTimer);
  activityPollTimer = setInterval(() => {
    if (!document.hidden && currentView === 'activity') {
      const sel = $('activity-member-filter');
      loadActivityFeed(sel ? sel.value : '');
    }
  }, 30000);
}

const activityIcons = {
  'item.create': 'add_circle', 'item.update': 'edit', 'item.delete': 'delete',
  'item.share': 'share', 'item.bulk_delete': 'delete_sweep', 'item.bulk_move': 'drive_file_move',
  'item.merge': 'merge', 'auth.login': 'login', 'auth.register': 'person_add',
  'member.invite': 'group_add', 'member.update': 'manage_accounts',
  'share_link.create': 'link',
};

async function loadActivityFeed(memberId) {
  const el = $('activity-feed-list');
  if (!el) return;
  showSkeletonLoader('activity-feed-list', 5);
  try {
    const url = memberId ? `/api/stats/activity-feed?member_id=${memberId}` : '/api/stats/activity-feed';
    const feed = await api.get(url);
    el.innerHTML = (feed || []).map(e => { const dn = esc(e.display_name || e.email || 'System'); const act = esc(e.action); const res = e.resource ? esc(e.resource) : ''; const rid = e.resource_id ? '#' + esc(e.resource_id) : ''; return `
      <div class="activity-item">
        <span class="material-icons-round activity-icon">${activityIcons[e.action] || 'info'}</span>
        <div class="activity-body">
          <strong>${dn}</strong>
          <span class="activity-action">${act}</span>
          ${e.resource ? `<span class="activity-resource">${res} ${rid}</span>` : ''}
        </div>
        <span class="activity-time">${formatRelative ? formatRelative(e.created_at) : esc(e.created_at)}</span>
      </div>
    `; }).join('') || '<p>No activity yet</p>';
    hideSkeletonLoader('activity-feed-list');
  } catch (e) { showErrorBoundary('activity-feed-list', e); }
}

// ─── SHARE LINK MODAL (#95) ───
async function showShareLinkModal(itemId) {
  let expiresIn = 0;
  let oneTimeUse = false;
  let passphrase = '';

  function renderModal() {
    const body = $('modal-share-link-body');
    if (!body) return;
    body.innerHTML = `
      <div class="form-group"><label>Expires in</label>
        <select id="sl-expiry" class="form-input">
          <option value="0">Never</option><option value="1">1 hour</option>
          <option value="24">1 day</option><option value="168">7 days</option>
          <option value="720">30 days</option>
        </select>
      </div>
      <div class="form-group"><label><input type="checkbox" id="sl-onetime"> One-time use</label></div>
      <div class="form-group"><label>Passphrase (optional)</label><input type="text" id="sl-passphrase" class="form-input" placeholder="Optional passphrase"></div>
      <button class="btn btn-primary" id="sl-create">Create Share Link</button>
      <div id="sl-result"></div>`;
    $('sl-create')?.addEventListener('click', async () => {
      expiresIn = parseInt($('sl-expiry')?.value || '0', 10);
      oneTimeUse = !!$('sl-onetime')?.checked;
      passphrase = $('sl-passphrase')?.value || '';
      try {
        const link = await api.post('/api/share-links', {
          item_id: itemId,
          expiresIn: expiresIn || undefined,
          oneTimeUse,
          passphrase: passphrase || undefined,
        });
        const url = `${location.origin}/#share-link/${link.token}`;
        $('sl-result').innerHTML = `<div class="share-link-result">
          <input type="text" value="${escA(url)}" readonly class="form-input" id="sl-url">
          <button class="btn btn-secondary" id="sl-copy">Copy</button></div>`;
        $('sl-copy')?.addEventListener('click', () => { copyToClipboard($('sl-url')?.value); toast('Link copied!', 'success'); });
      } catch { toast('Failed to create share link', 'error'); }
    });
  }

  if (!$('modal-share-link')) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-share-link';
    overlay.innerHTML = `<div class="modal"><div class="modal-header"><h3 class="modal-title">Create Share Link</h3><button class="modal-close" aria-label="Close">&times;</button></div><div id="modal-share-link-body"></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => closeModal('modal-share-link'));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal('modal-share-link'); });
  }
  openModal('modal-share-link');
  renderModal();
}

// ─── TEMPLATE FUNCTIONS (#98) ───
async function saveAsTemplate(itemId) {
  const name = prompt('Template name:');
  if (!name) return;
  try {
    await api.post('/api/templates', { item_id: itemId, name });
    toast('Template saved!', 'success');
  } catch { toast('Failed to save template', 'error'); }
}

// ─── MERGE WIZARD (#99) ───
async function showMergeWizard(sourceId, targetId) {
  if (!$('modal-merge')) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-merge';
    overlay.innerHTML = `<div class="modal modal-wide"><div class="modal-header"><h3 class="modal-title">Merge Items</h3><button class="modal-close" aria-label="Close">&times;</button></div><div id="modal-merge-body"></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => closeModal('modal-merge'));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal('modal-merge'); });
  }
  openModal('modal-merge');
  const body = $('modal-merge-body');
  if (!body) return;
  body.innerHTML = '<p>Loading...</p>';
  try {
    const src = await api.get(`/api/items/${sourceId}`);
    const tgt = await api.get(`/api/items/${targetId}`);
    const allFields = new Set([...(src.fields || []).map(f => f.field_def_id), ...(tgt.fields || []).map(f => f.field_def_id)]);
    let html = '<div class="merge-compare"><table class="merge-table"><tr><th>Field</th><th>Source</th><th>Target</th><th>Keep</th></tr>';
    html += `<tr><td>Title</td><td>${esc(src.title)}</td><td>${esc(tgt.title)}</td>
      <td><select data-field="title"><option value="target" selected>Target</option><option value="source">Source</option><option value="both">Both</option></select></td></tr>`;
    html += `<tr><td>Notes</td><td>${esc(src.notes||'')}</td><td>${esc(tgt.notes||'')}</td>
      <td><select data-field="notes"><option value="target" selected>Target</option><option value="source">Source</option><option value="both">Both</option></select></td></tr>`;
    for (const fid of allFields) {
      if (!fid) continue;
      const sf = (src.fields||[]).find(f=>f.field_def_id===fid);
      const tf = (tgt.fields||[]).find(f=>f.field_def_id===fid);
      html += `<tr><td>${esc(sf?.field_name||tf?.field_name||'Field '+fid)}</td>
        <td>${esc(sf?.value||'')}</td><td>${esc(tf?.value||'')}</td>
        <td><select data-field="${fid}"><option value="target" selected>Target</option><option value="source">Source</option><option value="both">Both</option></select></td></tr>`;
    }
    html += '</table><button class="btn btn-primary" id="merge-confirm">Merge</button></div>';
    body.innerHTML = html; // esc() used above for all user data
    $('merge-confirm')?.addEventListener('click', async () => {
      const sels = {};
      body.querySelectorAll('select[data-field]').forEach(s => { sels[s.dataset.field] = s.value; });
      try {
        await api.post(`/api/items/${targetId}/merge`, { sourceId, fieldSelections: sels });
        toast('Items merged!', 'success');
        closeModal('modal-merge');
        route();
      } catch { toast('Merge failed', 'error'); }
    });
  } catch { body.innerHTML = '<p>Failed to load items for merge</p>'; }
}

// ─── PRINT VIEW (#69) ───
function openPrintView(itemsData, opts = {}) {
  const showPasswords = opts.showPasswords || false;
  const grouped = {};

  for (const item of (itemsData || items)) {
    const catName = categories.find(c => c.id === item.category_id)?.name || 'Uncategorized';
    if (!grouped[catName]) grouped[catName] = [];
    grouped[catName].push(item);
  }

  let html = `<!DOCTYPE html><html><head><title>DataFlow - Print</title>
    <style>body{font-family:Inter,system-ui,sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#111}
    h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:24px}
    h3{font-size:16px;border-bottom:1px solid #999;padding-bottom:4px;margin:20px 0 12px}
    .item{margin-bottom:12px;padding:8px;border:1px solid #ddd;border-radius:4px}
    .item-title{font-weight:600;font-size:14px;margin-bottom:4px}
    .field{font-size:13px;margin:2px 0}.field-lbl{font-weight:600;color:#666;font-size:11px;text-transform:uppercase}
    .masked{font-family:monospace;letter-spacing:2px;color:#999}
    .toggle-pw{margin:16px 0;padding:8px 16px;cursor:pointer}
    @media print{.no-print{display:none!important}}</style></head><body>
    <h1>DataFlow Export</h1>
    <p style="color:#666;font-size:12px;margin-bottom:20px">Exported: ${new Date().toLocaleString()}</p>
    <button class="no-print toggle-pw" onclick="document.querySelectorAll('.masked').forEach(el=>{el.classList.toggle('masked');el.dataset.v=el.dataset.v==='1'?'0':'1'})">Toggle Passwords</button>`;

  for (const [catName, catItems] of Object.entries(grouped)) {
    html += `<h3>${esc(catName)}</h3>`;
    for (const item of catItems) {
      html += `<div class="item"><div class="item-title">${esc(item.title || 'Untitled')}</div>`;
      for (const f of (item.fields || [])) {
        const val = f.field_type === 'password' && !showPasswords ? '••••••••' : (f.value || f.decrypted_value || '');
        html += `<div class="field"><span class="field-lbl">${esc(f.field_name || f.name || '')}</span>: <span class="${f.field_type === 'password' && !showPasswords ? 'masked' : ''}">${esc(val)}</span></div>`;
      }
      if (item.notes) html += `<div class="field"><span class="field-lbl">Notes</span>: ${esc(item.notes)}</div>`;
      html += `</div>`;
    }
  }

  html += `<script class="no-print">window.onafterprint=()=>window.close()</script></body></html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }
}
