import React, { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { BRAND } from './Brand';
import { OPTIONAL, readConsent, saveConsent, onOpenCookieSettings } from './consent';

const GROUPS = [
  ['necessary', 'Necessary', 'Keep you signed in and secure, remember your language, private mode and unsaved drafts, and store this choice. Always on.'],
  ['preferences', 'Preferences', 'Remember display choices on this device: your text-call setup and text size, and tips you closed.'],
  ['statistics', 'Statistics', 'Anonymous usage analytics and session replays that show us where the site is confusing. What you type into forms is hidden from these replays.'],
  ['marketing', 'Marketing', 'Remember the referral link that brought you here, so the friend who invited you gets their reward when you sign up.'],
];

function Switch({ id, label, on, locked, onChange }) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer select-none" data-testid={`cookie-${id}-switch`}>
      <span className="text-[15px] font-semibold text-slate-900">{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={locked} onClick={() => onChange(!on)} data-testid={`cookie-${id}-toggle`}
        className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${on ? 'bg-[#4f46e5]' : 'bg-slate-800'} ${locked ? 'opacity-70 cursor-not-allowed' : ''}`}>
        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

function Details() {
  return (
    <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 pt-4 text-sm text-slate-600" data-testid="cookie-details">
      {GROUPS.map(([id, label, text]) => <div key={id}><dt className="font-semibold text-slate-900">{label}</dt><dd className="mt-0.5 leading-relaxed">{text}</dd></div>)}
    </dl>
  );
}

function Buttons({ choose, pick }) {
  const cls = 'h-12 w-full rounded-lg text-[15px] font-bold transition-colors duration-200';
  return (
    <div className="flex flex-col gap-2.5 lg:w-64 shrink-0">
      <button type="button" className={`${cls} bg-[#4f46e5] text-white hover:bg-[#4338ca]`} onClick={() => choose({ preferences: true, statistics: true, marketing: true })} data-testid="cookie-allow-all">Allow all</button>
      <button type="button" className={`${cls} border-2 border-[#4f46e5] text-slate-900 hover:bg-indigo-50`} onClick={() => choose(pick)} data-testid="cookie-allow-selection">Allow selection</button>
      <button type="button" className={`${cls} border-2 border-[#4f46e5] text-slate-900 hover:bg-indigo-50`} onClick={() => choose({})} data-testid="cookie-deny">Deny</button>
    </div>
  );
}

export function CookieBanner() {
  const [open, setOpen] = useState(() => !readConsent());
  const [pick, setPick] = useState(() => Object.fromEntries(OPTIONAL.map(k => [k, !!readConsent()?.[k]])));
  const [more, setMore] = useState(false);
  useEffect(() => onOpenCookieSettings(() => { setPick(Object.fromEntries(OPTIONAL.map(k => [k, !!readConsent()?.[k]]))); setOpen(true); }), []);
  if (!open) return null;
  const choose = (c) => { saveConsent(c); setOpen(false); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] p-2 sm:p-4 pointer-events-none" data-testid="cookie-banner">
      <section role="dialog" aria-labelledby="civr-cookie-title" className="civr-rise pointer-events-auto relative mx-auto max-w-7xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white text-slate-700 shadow-[0_-8px_40px_-8px_rgba(15,23,42,.35)] border border-slate-200 p-5 sm:p-8" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        <button type="button" onClick={() => choose({})} className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors" aria-label="Close — only necessary cookies" title="Close — only necessary cookies" data-testid="cookie-close"><X className="w-5 h-5" /></button>
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
          <img src={BRAND.icon} alt="" aria-hidden="true" className="hidden lg:block w-24 h-24 self-center rounded-2xl" />
          <div className="flex-1 min-w-0 pr-8 lg:pr-0">
            <h2 id="civr-cookie-title" className="text-lg font-bold text-slate-900" data-testid="cookie-title">This website uses cookies</h2>
            <p className="mt-3 text-[15px] leading-relaxed" data-testid="cookie-text">We use cookies and similar storage to keep you signed in and secure, remember your choices, and — only if you allow it — measure how the site is used and credit the friend who invited you. We don’t sell your data or show ads.</p>
          </div>
          <Buttons choose={choose} pick={pick} />
        </div>
        <div className="mt-6 pt-5 border-t border-slate-200 flex flex-wrap items-center gap-x-8 gap-y-4">
          {GROUPS.map(([id, label]) => <Switch key={id} id={id} label={label} on={id === 'necessary' || !!pick[id]} locked={id === 'necessary'} onChange={v => setPick(p => ({ ...p, [id]: v }))} />)}
          <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more} className="ml-auto inline-flex items-center gap-1 text-[15px] font-semibold text-[#4f46e5] hover:underline" data-testid="cookie-details-toggle">{more ? 'Hide details' : 'Show details'}<ChevronRight className={`w-4 h-4 transition-transform duration-200 ${more ? 'rotate-90' : ''}`} /></button>
        </div>
        {more && <Details />}
      </section>
    </div>
  );
}
