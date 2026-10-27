import React, { useEffect, useState } from 'react';
import { ChevronRight, Cookie, X } from 'lucide-react';
import { OPTIONAL, readConsent, saveConsent, onOpenCookieSettings } from './consent';

const GROUPS = [
  ['necessary', 'Necessary', 'Keep you signed in and secure, remember your language, private mode, unsaved drafts and your support chat, and store this choice. Always on.'],
  ['preferences', 'Preferences', 'Remember display choices on this device: your text-call setup and text size, and tips you closed.'],
  ['statistics', 'Statistics', 'Anonymous usage analytics and session replays that show us where the site is confusing. What you type into forms is hidden from these replays.'],
  ['marketing', 'Marketing', 'Remember the referral link that brought you here, so the friend who invited you gets their reward when you sign up.'],
];

function Switch({ id, label, on, locked, onChange }) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer select-none min-h-[44px]" data-testid={`cookie-${id}-switch`}>
      <span className="text-[15px] font-semibold text-slate-900">{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={locked} onClick={() => onChange(!on)} data-testid={`cookie-${id}-toggle`}
        className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${on ? 'bg-[#0f172a]' : 'bg-slate-400'} ${locked ? 'opacity-70 cursor-not-allowed' : ''}`}>
        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

const btn = 'h-11 px-4 rounded-full text-sm font-semibold transition-colors duration-200 whitespace-nowrap';

// Compact single-line consent bar; "Manage" opens the full choice panel (toggles + what each group does).
function Manage({ pick, setPick, choose, onBack }) {
  const [more, setMore] = useState(false);
  return (
    <div className="p-5 sm:p-6" data-testid="cookie-manage">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="civr-cookie-title" className="text-lg font-bold text-slate-900" data-testid="cookie-title">Cookie settings</h2><p className="mt-2 text-sm text-slate-600 leading-relaxed" data-testid="cookie-text">We use cookies and similar storage to keep you signed in and secure, remember your choices, and — only if you allow it — measure how the site is used and credit the friend who invited you. We don’t sell your data or show ads.</p></div>
        <button type="button" onClick={onBack} className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors" aria-label="Back" data-testid="cookie-manage-back"><X className="w-5 h-5" /></button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-1">
        {GROUPS.map(([id, label]) => <Switch key={id} id={id} label={label} on={id === 'necessary' || !!pick[id]} locked={id === 'necessary'} onChange={v => setPick(p => ({ ...p, [id]: v }))} />)}
        <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more} className="ml-auto inline-flex items-center gap-1 min-h-[44px] text-sm font-semibold text-[#0f172a] hover:underline" data-testid="cookie-details-toggle">{more ? 'Hide details' : 'Show details'}<ChevronRight className={`w-4 h-4 transition-transform duration-200 ${more ? 'rotate-90' : ''}`} /></button>
      </div>
      {more && <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 pt-4 text-sm text-slate-600" data-testid="cookie-details">{GROUPS.map(([id, label, text]) => <div key={id}><dt className="font-semibold text-slate-900">{label}</dt><dd className="mt-0.5 leading-relaxed">{text}</dd></div>)}</dl>}
      <div className="mt-5 pt-4 border-t border-slate-200 flex flex-wrap gap-2 justify-end">
        <button type="button" className={`${btn} border border-slate-300 text-slate-900 hover:bg-slate-100`} onClick={() => choose({})} data-testid="cookie-deny">Deny</button>
        <button type="button" className={`${btn} border border-slate-300 text-slate-900 hover:bg-slate-100`} onClick={() => choose(pick)} data-testid="cookie-allow-selection">Allow selection</button>
        <button type="button" className={`${btn} bg-[#0f172a] text-white hover:bg-black`} onClick={() => choose({ preferences: true, statistics: true, marketing: true })} data-testid="cookie-allow-all">Allow all</button>
      </div>
    </div>
  );
}

export function CookieBanner() {
  const [open, setOpen] = useState(() => !readConsent());
  const [pick, setPick] = useState(() => Object.fromEntries(OPTIONAL.map(k => [k, !!readConsent()?.[k]])));
  const [manage, setManage] = useState(false);
  useEffect(() => onOpenCookieSettings(() => { setPick(Object.fromEntries(OPTIONAL.map(k => [k, !!readConsent()?.[k]]))); setManage(true); setOpen(true); }), []);
  if (!open) return null;
  const choose = (c) => { saveConsent(c); setOpen(false); setManage(false); };
  return (
    <div className="civr-l-cookiebar fixed inset-x-0 bottom-0 z-[90] p-2 sm:p-4 pointer-events-none" data-testid="cookie-banner">
      <section role="dialog" aria-labelledby="civr-cookie-title" aria-describedby="civr-cookie-text" className={`civr-rise civr-l-cookie pointer-events-auto mx-auto text-slate-700 max-h-[85vh] overflow-y-auto ${manage ? 'max-w-3xl' : 'max-w-4xl'}`} style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {manage ? <Manage pick={pick} setPick={setPick} choose={choose} onBack={() => setManage(false)} /> : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3 sm:px-5" data-testid="cookie-compact">
            <Cookie className="w-5 h-5 text-slate-900 shrink-0 hidden sm:block" aria-hidden="true" />
            <p id="civr-cookie-text" className="text-sm text-slate-700 leading-snug flex-1 min-w-0" data-testid="cookie-text"><span id="civr-cookie-title" className="font-semibold text-slate-900">Cookies:</span> sign-in and security always; analytics and referral credit only if you allow them. No ads, no data sales.</p>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => setManage(true)} className={`${btn} text-slate-900 hover:bg-slate-100`} data-testid="cookie-manage-btn">Manage</button>
              <button type="button" onClick={() => choose({})} className={`${btn} border border-slate-300 text-slate-900 hover:bg-slate-100`} data-testid="cookie-deny">Deny</button>
              <button type="button" onClick={() => choose({ preferences: true, statistics: true, marketing: true })} className={`${btn} bg-[#0f172a] text-white hover:bg-black flex-1 sm:flex-none`} data-testid="cookie-allow-all">Allow all</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
