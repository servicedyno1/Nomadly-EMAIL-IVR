import { useCallback, useEffect, useState } from 'react';
import { IS_CIVR_DOMAIN } from './paths';

// Same-origin on CloudIVR's own domain and when REACT_APP_BACKEND_URL is unset (production droplet build:
// Express serves UI + API on one host). Shared preview hosts use REACT_APP_BACKEND_URL.
const API_ROOT = IS_CIVR_DOMAIN ? '' : (process.env.REACT_APP_BACKEND_URL || '');
const BASE = `${API_ROOT}/api/cloudivr-web`;

// What went wrong + what to do, when the server sent no message of its own (proxy errors, restarts, limits).
function fallbackMessage(status) {
  if (status === 401) return 'Please sign in again.';
  if (status === 403) return 'You don’t have access to this.';
  if (status === 404) return 'We couldn’t find that. It may have been deleted — go back and refresh the page.';
  if (status === 413) return 'That file is too big. Try a smaller one.';
  if (status === 429) return 'Too many tries in a short time. Wait a minute, then try again.';
  if (status === 500) return 'Something went wrong on our side. Please try again — if it keeps happening, message support.';
  if (status > 500) return 'CloudIVR is busy or restarting. Wait a minute, then try again.';
  return `Request failed (${status}). Please try again.`;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || fallbackMessage(status));
    this.status = status;
    this.code = body?.error;
  }
}

// fetch() only throws when the request never reached the server (offline, DNS, connection reset).
const networkError = () => new ApiError(0, {
  error: 'network',
  message: typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'You’re offline. Check your internet connection, then try again.'
    : 'Can’t reach CloudIVR right now. Check your connection, then try again.',
});

export async function api(path, { method = 'GET', body, form } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body ? JSON.stringify(body) : undefined),
      // Deletes waiting behind an Undo toast are sent while the tab closes (see undo.js).
      keepalive: method === 'DELETE',
    });
  } catch (_) { throw networkError(); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const enc = (s) => encodeURIComponent(s);
// Saves an API file (e.g. a CSV report) with the session cookie.
export async function downloadFile(path, name) {
  let res;
  try { res = await fetch(`${BASE}${path}`, { credentials: 'include' }); } catch (_) { throw networkError(); }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Library audio is served by this app's own API host, so playback works on every environment.
export const playUrl = (u) => { const f = String(u || '').split('/assets/user-audio/')[1]; return f ? `${API_ROOT}/api/assets/user-audio/${f}` : u; };
export const money = (n) => `$${Number(n || 0).toFixed(2)}`;
export const usd = (n) => (Number.isInteger(Number(n)) ? `$${Number(n)}` : money(n));
export const startPrice = (c) => (c?.plans?.length ? usd(Math.min(...c.plans.map(p => p.price))) : null);
const locale = () => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;
export const when = (d) => (d ? new Date(d).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const day = (d) => (d ? new Date(d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const secs = (s) => { const n = Number(s || 0); return n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`; };

// Loads `path` (null = skip); returns { data, error, loading, reload, setData }.
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!!path);
  const reload = useCallback(async () => {
    if (!path) return null;
    setLoading(true);
    try { const d = await api(path); setData(d); setError(null); return d; } catch (e) { setError(e); return null; } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
