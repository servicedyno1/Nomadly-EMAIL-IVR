import { useCallback, useEffect, useState } from 'react';

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api/cloudivr-web`;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || (status === 401 ? 'Please sign in again.' : `Request failed (${status})`));
    this.status = status;
    this.code = body?.error;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const enc = (s) => encodeURIComponent(s);
// Library audio is served by this app's own API host, so playback works on every environment.
export const playUrl = (u) => { const f = String(u || '').split('/assets/user-audio/')[1]; return f ? `${process.env.REACT_APP_BACKEND_URL}/api/assets/user-audio/${f}` : u; };
export const money = (n) => `$${Number(n || 0).toFixed(2)}`;
export const when = (d) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
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
