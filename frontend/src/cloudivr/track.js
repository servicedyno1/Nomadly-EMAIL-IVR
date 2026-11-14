import { api } from './api';

// Where a visitor came from (first touch, kept 90 days) + a light event log for journeys and drop-offs.
const KEY = 'civr_src';
const ANON = 'civr_anon';
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref'];

export function captureSource() {
  try {
    const cur = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (cur && Date.now() - cur.at < 90 * 864e5) return;
    const q = new URLSearchParams(window.location.search);
    const utm = Object.fromEntries(UTM.filter(k => q.get(k)).map(k => [k, q.get(k).slice(0, 120)]));
    const ref = document.referrer && !document.referrer.includes(window.location.host) ? document.referrer.slice(0, 300) : null;
    localStorage.setItem(KEY, JSON.stringify({ ...utm, referrer: ref, landing: window.location.pathname.slice(0, 200), at: Date.now() }));
  } catch { /* storage blocked */ }
}

export const sourceOf = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

const anonId = () => { try { let a = localStorage.getItem(ANON); if (!a) { a = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(ANON, a); } return a; } catch { return null; } };

let last = '';
export function track(name, props = {}) {
  const key = `${name}|${window.location.pathname}|${JSON.stringify(props)}`;
  if (key === last) return; // same event twice in a row (React dev double-run, re-renders)
  last = key;
  api('/events', { method: 'POST', body: { name, props, anon: anonId(), path: window.location.pathname } }).catch(() => {});
}
