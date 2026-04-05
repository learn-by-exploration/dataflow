// ─── DataFlow Offline Store ───
// Simple localStorage wrapper for UI state persistence.
'use strict';

const STORE_KEY = 'df_store';

const Store = (() => {
  let _cache = null;

  function _load() {
    if (_cache) return _cache;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      _cache = raw ? JSON.parse(raw) : {};
    } catch {
      _cache = {};
    }
    return _cache;
  }

  function _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(_cache || {}));
    } catch { /* quota exceeded — ignore */ }
  }

  function get(key) {
    return _load()[key];
  }

  function set(key, value) {
    _load()[key] = value;
    _save();
  }

  function remove(key) {
    const data = _load();
    delete data[key];
    _save();
  }

  function getView() { return get('currentView') || 'dashboard'; }
  function setView(v) { set('currentView', v); }
  function getTheme() { return get('theme') || 'light'; }
  function setTheme(t) { set('theme', t); }
  function isSidebarCollapsed() { return get('sidebarCollapsed') === true; }
  function setSidebarCollapsed(v) { set('sidebarCollapsed', v); }

  return { get, set, remove, getView, setView, getTheme, setTheme, isSidebarCollapsed, setSidebarCollapsed };
})();

if (typeof window !== 'undefined') window.Store = Store;
