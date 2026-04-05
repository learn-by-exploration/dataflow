// ─── DataFlow API Client ───
// Centralized fetch wrapper with CSRF, auth redirect, and error handling.

import { toast } from './utils.js';

function getCsrfToken() {
  const m = document.cookie.match(/csrf_token=([a-f0-9]{64})/);
  return m ? m[1] : '';
}

async function _fetch(method, path, body) {
  try {
    const opts = { method, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      };
      opts.body = JSON.stringify(body);
    } else if (method !== 'GET') {
      opts.headers = { 'X-CSRF-Token': getCsrfToken() };
    }
    const r = await fetch(path, opts);
    if (r.status === 401) {
      window.location.href = '/login.html';
      return {};
    }
    if (!r.ok) {
      return await r.json().catch(() => ({}));
    }
    return await r.json();
  } catch (e) {
    toast('Network error — please try again', 'error');
    throw e;
  }
}

export const api = {
  get: (path) => _fetch('GET', path),
  post: (path, body) => _fetch('POST', path, body),
  put: (path, body) => _fetch('PUT', path, body),
  del: (path) => _fetch('DELETE', path),
};

export { getCsrfToken };
