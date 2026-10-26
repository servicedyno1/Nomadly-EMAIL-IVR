import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Hash, Plus, Wallet, Phone, Eye, EyeOff, LogOut, HelpCircle, Megaphone, Bot, CornerDownLeft } from 'lucide-react';
import { api, enc } from './api';
import { NAV_ITEMS, appPath } from './nav';
import { cp } from './paths';
import { useCivrAuth } from './AuthContext';
import { usePrivacy } from './privacy';
import { confirmLeave } from './guard';
import { helpFor } from './shortcuts';

export const OPEN_PALETTE = 'civr:open-palette';
export const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE));
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

const digits = (s) => String(s || '').replace(/\D/g, '');
const hit = (q, fields) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const d = digits(t);
  return fields.some(f => f && (String(f).toLowerCase().includes(t) || (d.length >= 3 && digits(f).includes(d))));
};

// Ctrl/⌘ K: jump to any number, page or action from anywhere in the app.
export function Palette({ openPhone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [nums, setNums] = useState(null);
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const { logout } = useCivrAuth();
  const pv = usePrivacy();
  const input = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); } };
    const ev = () => setOpen(true);
    window.addEventListener('keydown', key); window.addEventListener(OPEN_PALETTE, ev);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener(OPEN_PALETTE, ev); };
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ(''); setSel(0);
    setTimeout(() => input.current?.focus(), 0);
    api('/numbers').then(d => setNums(d.numbers || [])).catch(() => setNums(n => n || []));
  }, [open]);

  const items = useMemo(() => {
    const numbers = (nums || []).map(n => ({ id: `num-${n.phoneNumber}`, group: 'Numbers', label: pv.phone(n.phoneNumber), sub: `${n.countryName || n.country} · ${n.planName} · ${n.status}`, Icon: Hash, keys: [n.phoneNumber, n.countryName, n.planName, n.status], run: () => nav(cp(`/app/numbers/${enc(n.phoneNumber)}`)) }));
    const pages = NAV_ITEMS.map(([to, label, Icon, id]) => ({ id: `page-${id}`, group: 'Pages', label, Icon, run: () => nav(appPath(to)) }));
    const actions = [
      ['buy', 'Buy a number', Plus, () => nav(cp('/app/buy'))],
      ['campaign', 'New campaign', Megaphone, () => nav(cp('/app/campaigns/new'))],
      ['agent', 'New AI voice agent', Bot, () => nav(cp('/app/ai-agents/new'))],
      ['funds', 'Add funds', Wallet, () => nav(cp('/app/wallet'))],
      ['phone', 'Open the browser phone', Phone, openPhone],
      ['private', pv.on ? 'Private mode off' : 'Private mode on', pv.on ? Eye : EyeOff, pv.toggle],
      ['help', 'Help for this page', HelpCircle, () => nav(helpFor(pathname, search))],
      ['logout', 'Sign out', LogOut, async () => { if (!(await confirmLeave())) return; nav(cp(), { replace: true }); await logout(); }],
    ].map(([id, label, Icon, run]) => ({ id: `act-${id}`, group: 'Actions', label, Icon, run }));
    return [...numbers, ...pages, ...actions].filter(it => hit(q, [it.label, it.sub, ...(it.keys || [])])).slice(0, 40);
  }, [q, nums, pv, pathname, search, nav, openPhone, logout]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const run = (it) => { setOpen(false); it.run(); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) run(items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };
  if (!open) return null;
  let lastGroup = null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[10vh] bg-black/70 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} data-testid="palette-backdrop">
      <div role="dialog" aria-modal="true" aria-label="Jump to" className="civr-card !bg-[#111] w-full max-w-xl overflow-hidden shadow-2xl shadow-black/60 civr-rise" data-testid="palette">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-[#222]">
          <Search className="w-4 h-4 text-[#71717a] shrink-0" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} role="combobox" aria-expanded="true" aria-controls="civr-palette-list" aria-activedescendant={items[sel] ? `civr-pi-${items[sel].id}` : undefined} aria-label="Search numbers, pages and actions" placeholder="Type a number, a page or an action…" autoComplete="off" className="flex-1 bg-transparent outline-none text-[15px] text-[#f3f4f6] placeholder:text-[#71717a]" data-testid="palette-input" />
          <kbd className="hidden sm:inline-flex items-center h-6 px-1.5 rounded-md border border-[#2a2a2a] font-mono text-[11px] text-[#71717a]" data-no-translate>Esc</kbd>
        </div>
        <div ref={listRef} id="civr-palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-2" data-testid="palette-list">
          {!items.length && <div className="px-4 py-8 text-sm text-center text-[#a1a1aa]" data-testid="palette-empty">{`Nothing matches “${q.trim()}”.`}</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup; lastGroup = it.group;
            return (
              <React.Fragment key={it.id}>
                {head && <div className="px-4 pt-3 pb-1 text-[11px] font-mono uppercase tracking-widest text-[#71717a]">{it.group}</div>}
                <button type="button" id={`civr-pi-${it.id}`} role="option" aria-selected={i === sel} data-idx={i} onMouseEnter={() => setSel(i)} onClick={() => run(it)} data-testid={`palette-item-${it.id}`}
                  className={`w-full flex items-center gap-3 px-4 min-h-[44px] text-left text-sm transition-colors ${i === sel ? 'bg-[#818cf8]/12 text-[#f3f4f6]' : 'text-[#d4d4d8]'}`}>
                  <it.Icon className={`w-4 h-4 shrink-0 ${i === sel ? 'text-[#818cf8]' : 'text-[#71717a]'}`} />
                  <span className={`truncate ${it.group === 'Numbers' ? 'font-mono' : ''}`}>{it.label}</span>
                  {it.sub && <span className="truncate text-xs text-[#a1a1aa]">{it.sub}</span>}
                  {i === sel && <CornerDownLeft className="w-3.5 h-3.5 ml-auto shrink-0 text-[#71717a]" aria-hidden="true" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="hidden sm:flex items-center gap-4 px-4 h-9 border-t border-[#222] text-[11px] text-[#71717a]" data-no-translate>
          <span><kbd className="font-mono">↑↓</kbd> move</span><span><kbd className="font-mono">↵</kbd> open</span><span><kbd className="font-mono">{isMac ? '⌘' : 'Ctrl'} K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
