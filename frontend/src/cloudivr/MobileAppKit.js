import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

const KEY = 'civr-install-dismissed';
const DAYS = 30;
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isPhone = () => window.matchMedia?.('(max-width: 767px)').matches;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const dismissedRecently = () => Date.now() - Number(localStorage.getItem(KEY) || 0) < DAYS * 864e5;

// Gives every table cell its column name so phone CSS can show rows as labelled cards.
function labelTables() {
  document.querySelectorAll('.civr table:not(.civr-keep-table)').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!heads.length) return;
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i] && td.getAttribute('data-label') !== heads[i]) td.setAttribute('data-label', heads[i]); }));
  });
}

function useCardTables() {
  useEffect(() => {
    let t = null;
    const run = () => { clearTimeout(t); t = setTimeout(labelTables, 120); };
    run();
    const mo = new MutationObserver(run);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); clearTimeout(t); };
  }, []);
}

// "Add CloudIVR to your home screen": the browser's install prompt on Android/Chrome, a Share-menu hint on iPhone.
function InstallBanner() {
  const [prompt, setPrompt] = useState(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return undefined;
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const t = setTimeout(() => { if (isPhone()) setShow(true); }, 15000);
    const done = () => setShow(false);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', done); clearTimeout(t); };
  }, []);
  if (!show || (!prompt && !isIos())) return null;
  const close = () => { localStorage.setItem(KEY, String(Date.now())); setShow(false); };
  const install = async () => { prompt.prompt(); await prompt.userChoice.catch(() => null); close(); };
  return (
    <div role="region" aria-label="Install the app" className="md:hidden fixed left-3 right-20 z-[60] bottom-[calc(5rem+env(safe-area-inset-bottom))] rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-black/10 p-4 flex items-center gap-3 civr-rise" data-testid="install-banner">
      <img src="/civr/brand/icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">Get the CloudIVR app</div>
        <div className="text-xs text-slate-600 mt-0.5">{prompt ? 'Opens full screen, right from your home screen.' : <>Tap <Share className="inline w-3.5 h-3.5 -mt-0.5" aria-label="Share" /> then “Add to Home Screen”.</>}</div>
      </div>
      {prompt && <button type="button" onClick={install} className="h-11 px-4 rounded-full bg-[#1d6fd8] text-white text-sm font-semibold inline-flex items-center gap-1.5" data-testid="install-banner-install"><Download className="w-4 h-4" aria-hidden="true" />Install</button>}
      <button type="button" onClick={close} aria-label="Not now" className="w-11 h-11 grid place-items-center rounded-full text-slate-500 hover:bg-slate-100" data-testid="install-banner-close"><X className="w-5 h-5" /></button>
    </div>
  );
}

// Phone polish mounted once for the whole site.
export function MobileAppKit() {
  useCardTables();
  return <InstallBanner />;
}
