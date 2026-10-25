import { useEffect, useState } from 'react';

// Installable web app: the browser's install prompt is caught early (it fires once, soon after load) and kept for
// the Install button; iPhones have no prompt, so they get "Share → Add to Home Screen" steps instead.
let deferred = null;
const subs = new Set();
const ping = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; ping(); });
  window.addEventListener('appinstalled', () => { deferred = null; ping(); });
}

export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
export const isIos = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function registerPwa() {
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) navigator.serviceWorker.register('/civr-ring-sw.js').catch(() => null);
}

export function usePwa() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const install = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null;
    ping();
    return r?.outcome === 'accepted';
  };
  return { canInstall: !!deferred, installed: isStandalone(), ios: isIos(), install };
}
