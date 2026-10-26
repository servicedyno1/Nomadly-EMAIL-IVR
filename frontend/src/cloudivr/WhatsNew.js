import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Users, Sparkles, Webhook, Download, X, Gift, ArrowRight } from 'lucide-react';
import { api, enc } from './api';
import { useCivrAuth } from './AuthContext';
import { useRtc } from './rtc';
import { cp } from './paths';

// "What's new" card, shown once per account the first time a release with news loads (after a deploy the app reloads
// itself — see update.js — so this is what customers see next). Bump `id` and edit `items` for the next release.
// Accounts created on/after `since` never see it: for them these features are simply part of the app.
export const RELEASE = {
  id: '2026-10-25',
  since: '2026-10-25T18:00:00Z', // ≈ when this release went live; accounts created after it never see this card
  items: [
    { key: 'triggers', Icon: Zap, title: 'Text Triggers', body: 'A text to your number can start a call automatically — a call back to you, a recorded message or your AI agent.', feature: 'textTriggers', tab: 'triggers', plan: 'Pro plan and up' },
    { key: 'ringgroup', Icon: Users, title: 'Ring groups', body: 'Ring up to 5 phones at once — the first one to answer gets the caller.', feature: 'ringGroup', tab: 'ringgroup', plan: 'Pro plan and up' },
    { key: 'summary', Icon: Sparkles, title: 'AI call summaries', body: 'Voicemails and recorded calls get a short summary, the caller’s mood and next steps.', feature: 'aiSummary', tab: 'logs', plan: 'Pro plan and up' },
    { key: 'webhooks', Icon: Webhook, title: 'Call events for your CRM and Zapier', body: 'Send calls, voicemails and texts to your own tools the moment they happen.', to: '/app/settings#webhooks' },
    { key: 'install', Icon: Download, title: 'Install the app', body: 'Put CloudIVR on your phone or computer like a normal app.', to: '/app/settings#install' },
  ],
};

const OPEN_EVENT = 'civr:whats-new';
export const openWhatsNew = () => window.dispatchEvent(new Event(OPEN_EVENT));
const seenKey = (account) => `civr.whatsNew.${account?.id || 'me'}`;
const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private browsing */ } };

// Where "Show me" goes for a number feature: the first active number whose plan has it, else the first number (its tab
// explains the upgrade), else the numbers page.
function numberLink(numbers, it) {
  const active = (numbers || []).filter(n => n.status === 'active');
  const n = active.find(x => x.access?.[it.feature]) || active[0];
  return n ? cp(`/app/numbers/${enc(n.phoneNumber)}?tab=${it.tab}`) : cp('/app/numbers');
}

export function WhatsNew() {
  const { account } = useCivrAuth() || {};
  const rtc = useRtc();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [numbers, setNumbers] = useState(null);
  const box = useRef(null);
  const loading = useRef(null);
  // One /numbers fetch per open; "Show me" waits for it so it never falls back to the list just because it was quick.
  const loadNumbers = useCallback(() => {
    if (!loading.current) loading.current = api('/numbers').then(d => d.numbers || [], () => { loading.current = null; return []; });
    return loading.current;
  }, []);
  const key = seenKey(account);
  const onCall = !!rtc?.call;

  // Once per account per release, for accounts that existed before it; never on top of a browser-phone call.
  useEffect(() => {
    if (!account?.id || onCall || read(key) === RELEASE.id) return undefined;
    if (!account.createdAt || new Date(account.createdAt) >= new Date(RELEASE.since)) { write(key, RELEASE.id); return undefined; }
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [account?.id, account?.createdAt, key, onCall]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  useEffect(() => { if (open && numbers === null) loadNumbers().then(setNumbers); }, [open, numbers, loadNumbers]);

  // Closing forgets the numbers list, so a later re-open (Help → What's new) links to the numbers as they are then.
  const close = useCallback(() => { write(key, RELEASE.id); setOpen(false); loading.current = null; setNumbers(null); }, [key]);

  // Keyboard: focus "Got it", Esc closes, Tab stays inside the card.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    box.current?.querySelector('[data-testid="whats-new-dismiss"]')?.focus({ preventScroll: true }); // card opens at its top on phones
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = [...box.current.querySelectorAll('button')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (prev?.focus) prev.focus(); };
  }, [open, close]);

  if (!open) return null;
  const go = async (it) => {
    if (it.to) { close(); nav(cp(it.to)); return; }
    const list = numbers ?? await loadNumbers();
    close();
    nav(numberLink(list, it));
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} data-testid="whats-new-backdrop">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="whats-new-title" className="civr-card !bg-[#111] w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:p-7 civr-rise shadow-2xl shadow-black/60" data-testid="whats-new-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="civr-label mb-2 flex items-center gap-1.5"><Gift className="w-3.5 h-3.5" />New in CloudIVR</div>
            <h2 id="whats-new-title" className="font-display text-2xl sm:text-3xl font-bold">What’s new</h2>
            <p className="text-sm text-[#a1a1aa] mt-1">Five things you can try today.</p>
          </div>
          <button type="button" onClick={close} className="w-11 h-11 -mt-2 -mr-2 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5 shrink-0" aria-label="Close" data-testid="whats-new-close"><X className="w-4 h-4" /></button>
        </div>
        <ul className="mt-5 space-y-2.5" data-testid="whats-new-list">
          {RELEASE.items.map(it => (
            <li key={it.key} className="flex items-start gap-3 rounded-xl border border-[#1f1f1f] bg-[#0c0c0c] p-3.5" data-testid={`whats-new-item-${it.key}`}>
              <div className="w-9 h-9 rounded-lg bg-[#818cf8]/10 flex items-center justify-center shrink-0"><it.Icon className="w-4 h-4 text-[#818cf8]" /></div>
              <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex flex-wrap items-center gap-x-2 gap-y-1">{it.title}{it.plan && <span className="civr-pill !text-[11px] !py-0">{it.plan}</span>}</div>
                  <p className="text-xs text-[#a1a1aa] mt-1 leading-relaxed">{it.body}</p>
                </div>
                <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm shrink-0 self-start sm:self-center" onClick={() => go(it)} data-testid={`whats-new-go-${it.key}`}>Show me<ArrowRight className="w-3.5 h-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end"><button type="button" className="civr-btn civr-btn-primary" onClick={close} data-testid="whats-new-dismiss">Got it</button></div>
      </div>
    </div>
  );
}
