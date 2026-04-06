// ─── DataFlow Utility Functions ───
// Pure helper functions used across the frontend.

/**
 * HTML entity escaping — prevents XSS in rendered content
 */
export function esc(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

/**
 * Attribute-safe escaping — for use inside HTML attribute values
 */
export function escA(s) {
  return String(s == null ? '' : s).replace(/[&"'<>]/g, m => ({
    '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;'
  })[m]);
}

/**
 * Shorthand: get element by ID
 */
export const $ = id => document.getElementById(id);

/**
 * Format date string (ISO or Date object) to human-readable
 */
export function formatDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format relative time — "2 days ago", "in 3 hours", etc.
 */
export function formatRelative(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const now = new Date();
  const diffMs = now - dt;
  const diffSec = Math.floor(Math.abs(diffMs) / 1000);
  const past = diffMs > 0;

  if (diffSec < 60) return past ? 'just now' : 'just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return past ? `${m}m ago` : `in ${m}m`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return past ? `${h}h ago` : `in ${h}h`;
  }
  if (diffSec < 604800) {
    const days = Math.floor(diffSec / 86400);
    return past ? `${days}d ago` : `in ${days}d`;
  }
  return formatDate(dt);
}

/**
 * Copy text to clipboard, auto-clear after 30s
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    // Auto-clear clipboard after 30 seconds
    setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
    }, 30000);
    toast('Copied!', 'success');
    return true;
  } catch {
    toast('Copy failed', 'error');
    return false;
  }
}

/**
 * Toast notification
 */
export function toast(message, type = 'info') {
  showToast(message, type);
}

/**
 * Enhanced toast with options — stackable, auto-dismiss, action buttons
 */
export function showToast(message, type = 'info', options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Limit stacking to max 3
  const existing = container.querySelectorAll('.toast');
  if (existing.length >= 3) existing[0].remove();

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.textContent = message;

  // Dismiss button
  const dismiss = document.createElement('button');
  dismiss.className = 'toast-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '\u00d7';
  dismiss.addEventListener('click', () => removeToast(el));
  el.appendChild(dismiss);

  // Optional action button
  if (options.action && options.actionLabel) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-action';
    actionBtn.textContent = options.actionLabel;
    actionBtn.addEventListener('click', () => { options.action(); removeToast(el); });
    el.appendChild(actionBtn);
  }

  container.appendChild(el);

  const duration = options.duration || (type === 'error' ? 10000 : 5000);
  const timer = setTimeout(() => removeToast(el), duration);
  el._toastTimer = timer;

  function removeToast(t) {
    clearTimeout(t._toastTimer);
    t.classList.add('toast-fade');
    setTimeout(() => t.remove(), 300);
  }
}

/**
 * Debounce helper
 */
export function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
