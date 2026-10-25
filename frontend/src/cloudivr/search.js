import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { tr } from './i18n';

const digits = (s) => String(s).replace(/\D/g, '');

// Filters a list as the user types. `fields(item)` → the texts to look in (English data is also matched in the
// page language); a phone-like query ignores spaces, dashes and "+".
export function useSearch(items, fields) {
  const [q, setQ] = useState('');
  const all = items || [];
  const t = q.trim().toLowerCase();
  const d = digits(t);
  const phoneish = d.length >= 3 && /^[\d\s()+.-]+$/.test(t);
  const list = !t ? all : all.filter((x) => {
    const vals = fields(x).filter(v => v != null && v !== '' && v !== false).map(String);
    return vals.some(v => `${v} ${tr(v)}`.toLowerCase().includes(t) || (phoneish && digits(v).includes(d)));
  });
  return { q, setQ, list, active: !!t, total: all.length };
}

// Search input for a list: "/" jumps here (shortcuts.js), Esc or × clears it, and it shows how many match.
export function SearchBox({ s, placeholder = 'Search', testid, className = '' }) {
  return (
    <div className={`relative ${className}`} role="search">
      <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#71717a] pointer-events-none" />
      <input type="text" enterKeyHint="search" autoComplete="off" data-search-box className="civr-input !pl-10 !pr-24" value={s.q}
        onChange={e => s.setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && s.q) { e.preventDefault(); s.setQ(''); } }}
        placeholder={placeholder} aria-label={placeholder} data-testid={testid} />
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {s.active ? <>
          <span className="font-mono text-xs text-[#a1a1aa]" data-testid={`${testid}-count`}>{`${s.list.length}/${s.total}`}</span>
          <button type="button" onClick={() => s.setQ('')} aria-label="Clear search" className="w-8 h-8 flex items-center justify-center rounded-full text-[#a1a1aa] hover:text-white hover:bg-white/5" data-testid={`${testid}-clear`}><X className="w-4 h-4" /></button>
        </> : <kbd className="hidden md:inline-flex items-center justify-center w-6 h-6 mr-1.5 rounded-md border border-[#2a2a2a] font-mono text-xs text-[#71717a]" aria-hidden="true" data-no-translate>/</kbd>}
      </div>
      <span className="sr-only" role="status" aria-live="polite">{s.active ? `Showing ${s.list.length} of ${s.total}` : ''}</span>
    </div>
  );
}

// Shown in place of the list when the search finds nothing.
export function NoMatches({ s, testid }) {
  if (!s.active || s.list.length) return null;
  return (
    <div className="civr-card p-8 text-center" data-testid={testid}>
      <div className="font-semibold text-[#f3f4f6]">{`Nothing matches “${s.q.trim()}”`}</div>
      <p className="text-sm text-[#a1a1aa] mt-1">Try another word or part of a number.</p>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm mt-4" onClick={() => s.setQ('')} data-testid={`${testid}-clear`}>Clear search</button>
    </div>
  );
}
