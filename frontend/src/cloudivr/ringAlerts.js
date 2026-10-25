import { useEffect, useRef } from 'react';
import { tr } from './i18n';
import { BRAND } from './Brand';

// Background tabs throttle page timers (down to once a minute); a worker's timer keeps the ring check every ~2 s.
export function every(ms, fn) {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${ms})`], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => { w.terminate(); URL.revokeObjectURL(url); };
  } catch (_) { const t = setInterval(fn, ms); return () => clearInterval(t); }
}

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifyState = () => (canNotify() ? Notification.permission : 'unsupported');
const OPTS = (body, tag) => ({ body, tag, requireInteraction: true, icon: BRAND.notifyIcon });
// Phones only show page notifications through a service worker.
async function worker() {
  if (!navigator.serviceWorker) return null;
  await navigator.serviceWorker.register('/civr-ring-sw.js').catch(() => null);
  return Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 3000))]);
}

// Asks once (from the number's setting) — browsers only show the prompt after a tap.
export async function askNotify() {
  if (!canNotify()) return 'unsupported';
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (p === 'granted') worker();
  return p;
}

async function show(title, body, tag) {
  try {
    const n = new Notification(title, OPTS(body, tag));
    n.onclick = () => { window.focus(); n.close(); };
    return n;
  } catch (_) {
    const reg = await worker();
    if (!reg) return null;
    await reg.showNotification(title, OPTS(body, tag));
    return { close: () => reg.getNotifications({ tag }).then(l => l.forEach(x => x.close())).catch(() => {}) };
  }
}
const closeAll = (p) => Promise.resolve(p).then(n => n?.close()).catch(() => {});

// Desktop / phone notification for each ringing call while the tab is in the background.
export function useRingNotify(calls, describe) {
  const open = useRef(new Map());
  useEffect(() => {
    const ids = new Set(calls.map(c => c.id));
    open.current.forEach((p, id) => { if (!ids.has(id)) { closeAll(p); open.current.delete(id); } });
    if (!canNotify() || Notification.permission !== 'granted' || !document.hidden) return;
    calls.forEach(c => { if (!open.current.has(c.id)) open.current.set(c.id, show(tr('Incoming call'), describe(c), `civr-ring-${c.id}`).catch(() => null)); });
  }, [calls, describe]);
  useEffect(() => { const m = open.current; return () => m.forEach(closeAll); }, []);
}

// Flashes the tab title while a call rings.
export function useTitleFlash(on) {
  useEffect(() => {
    if (!on) return undefined;
    const orig = document.title, alt = `📞 ${tr('Incoming call…')}`;
    let flip = false;
    const t = setInterval(() => { flip = !flip; document.title = flip ? alt : orig; }, 1000);
    return () => { clearInterval(t); document.title = orig; };
  }, [on]);
}
