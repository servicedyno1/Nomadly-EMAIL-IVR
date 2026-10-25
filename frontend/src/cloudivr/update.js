import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { anyDirty, confirmLeave } from './guard';
import { ask } from './confirm';
import { cp } from './paths';
import { useRtc } from './rtc';

// After a deploy, a tab that was already open keeps running the old code: moving between pages inside the app never
// reloads it, so new screens (e.g. a new number tab) stay invisible until a manual refresh. Production builds load
// /static/js/main.<hash>.js and every deploy changes that hash, so the app re-reads its own page now and then. When the
// hash differs it shows "Refresh now" and also picks the new version up by itself on the next page change — but only when
// nothing would be lost (no unsaved form, no call ringing or in progress on the browser phone). Each new build is
// reloaded for at most once per tab, so a stale CDN copy can never cause a reload loop.
const MAIN = /\/static\/js\/main\.([a-f0-9]{6,})\.js/;
const EVERY_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;
const RELOADED = 'civr.updateReloadedFor';
const DEV = process.env.NODE_ENV !== 'production';

const ss = {
  get: (k) => { try { return window.sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { window.sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

let ready = null; // hash of a newer build, once one has been seen
let lastCheck = 0;
let busy = () => false; // set by the signed-in shell: true while the browser phone rings or is on a call
const subs = new Set();
const publish = (v) => { if (v !== ready) { ready = v; subs.forEach((f) => f(v)); } };

// Development builds have no hashed bundle, so the check is off there. QA can simulate a deploy in a development build
// with sessionStorage keys civr.devRunningBuild / civr.devLatestBuild (both ignored by production builds).
export function runningBuild() {
  const el = typeof document !== 'undefined' && document.querySelector('script[src*="/static/js/main."]');
  const m = el && (el.getAttribute('src') || '').match(MAIN);
  if (m) return m[1];
  return DEV ? ss.get('civr.devRunningBuild') : null;
}

async function latestBuild() {
  if (DEV && ss.get('civr.devLatestBuild')) return ss.get('civr.devLatestBuild');
  const r = await fetch(`${cp('/app')}?build-check=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'text/html' } });
  if (!r.ok) return null;
  const m = (await r.text()).match(MAIN);
  return m ? m[1] : null;
}

export async function checkForUpdate({ force = false } = {}) {
  const running = runningBuild();
  if (!running || (!force && Date.now() - lastCheck < MIN_GAP_MS)) return ready;
  lastCheck = Date.now();
  const latest = await latestBuild().catch(() => null);
  if (latest && latest !== running) publish(latest);
  return ready;
}

function reloadIfSafe(build) {
  if (!build || anyDirty() || busy() || ss.get(RELOADED) === build) return false;
  ss.set(RELOADED, build);
  window.location.reload();
  return true;
}

// Mounted once for the whole CloudIVR app (landing, sign-in and the signed-in app).
export function UpdateWatcher() {
  const { pathname } = useLocation();
  const prev = useRef(pathname);
  useEffect(() => {
    if (!runningBuild()) return undefined;
    checkForUpdate({ force: true });
    const t = setInterval(() => checkForUpdate({ force: true }), EVERY_MS);
    const wake = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); };
  }, []);
  // A page change is the moment to pick up a new version: the user is leaving this screen anyway.
  useEffect(() => {
    if (prev.current === pathname) return;
    prev.current = pathname;
    if (!runningBuild()) return;
    if (ready) reloadIfSafe(ready);
    else checkForUpdate().then(reloadIfSafe);
  }, [pathname]);
  return null;
}

// Signed-in shell only: the banner, plus telling the watcher when a browser-phone call must not be cut off.
export function UpdateBanner() {
  const rtc = useRtc();
  const call = rtc?.call || null;
  const [build, setBuild] = useState(ready);
  const [hiddenFor, setHiddenFor] = useState(null);
  useEffect(() => { subs.add(setBuild); setBuild(ready); return () => { subs.delete(setBuild); }; }, []);
  useEffect(() => { busy = () => !!call; return () => { busy = () => false; }; }, [call]);
  if (!build || hiddenFor === build) return null;
  const refresh = async () => {
    if (call && !(await ask('Refreshing ends the call on the browser phone. Refresh anyway?', { danger: true, ok: 'Refresh and end the call', cancel: 'Not now' }))) return;
    if (!(await confirmLeave())) return;
    ss.set(RELOADED, build);
    window.location.reload();
  };
  return (
    <div role="status" aria-live="polite" className="text-sm text-[#a7f3d0] bg-[#34d399]/10 border-b border-[#34d399]/30 px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center" data-testid="app-update-banner">
      <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 shrink-0" />A new version of CloudIVR is ready.</span>
      <span className="flex items-center gap-1">
        <button type="button" onClick={refresh} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="app-update-refresh-button">Refresh now</button>
        <button type="button" onClick={() => setHiddenFor(build)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="app-update-later-button">Later</button>
      </span>
    </div>
  );
}
