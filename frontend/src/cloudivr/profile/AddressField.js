import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin, Search, PencilLine } from 'lucide-react';
import { api } from '../api';
import { Field } from '../ui';

const newSession = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

// Google suggestions as the customer types (via our server); picking one fills the address fields.
function useSuggest(q, country, session) {
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (q.trim().length < 3) { setList([]); return undefined; }
    const t = setTimeout(() => {
      setBusy(true);
      api(`/address/suggest?${qs({ q, country, session })}`).then(d => { setList(d.suggestions || []); setError(null); }).catch(e => { setList([]); setError(e.message); }).finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, country, session]);
  return { list, busy, error, clear: () => setList([]) };
}

function Suggestions({ list, active, onPick }) {
  if (!list.length) return null;
  return (
    <ul role="listbox" className="absolute z-20 left-0 right-0 mt-1 civr-card !bg-[#0e0e10] p-1 shadow-2xl shadow-black/60 max-h-72 overflow-y-auto" data-testid="address-suggestions">
      {list.map((s, i) => (
        <li key={s.id} role="option" aria-selected={i === active}>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(s); }} className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${i === active ? 'bg-white/5' : 'hover:bg-white/5'}`} data-testid={`address-suggestion-${i}`}>
            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-[#818cf8]" />
            <span className="min-w-0"><span className="block text-sm font-medium truncate">{s.main}</span><span className="block text-xs text-[#a1a1aa] truncate">{s.secondary}</span></span>
          </button>
        </li>
      ))}
      <li className="px-3 pt-1 pb-1.5 text-[10px] text-[#71717a] text-right">powered by Google</li>
    </ul>
  );
}

function AddressSearch({ country, onFill }) {
  const session = useMemo(newSession, []);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState(false);
  const { list, busy, error, clear } = useSuggest(typed ? q : '', country, session);
  const box = useRef(null);
  const pick = async (s) => {
    clear(); setTyped(false); setQ(`${s.main}${s.secondary ? `, ${s.secondary}` : ''}`); setLoading(true);
    try { const d = await api(`/address/place?${qs({ id: s.id, session })}`); onFill(d.address); } catch (e) { onFill(null, e.message); } finally { setLoading(false); }
  };
  const key = (e) => {
    if (!list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, list.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); pick(list[active]); }
    if (e.key === 'Escape') clear();
  };
  return (
    <Field label="Find your address" hint={error || 'Start typing the street and number, then pick it from the list.'}>
      <div className="relative" ref={box}>
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a] pointer-events-none" />
        <input className="civr-input !pl-9 !pr-9" value={q} onChange={e => { setQ(e.target.value); setTyped(true); setActive(0); }} onKeyDown={key} onBlur={() => setTimeout(clear, 150)} placeholder="e.g. 10 George St, Sydney" autoComplete="off" aria-autocomplete="list" data-testid="address-search-input" />
        {(busy || loading) && <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-[#818cf8]" data-testid="address-search-loading" />}
        <Suggestions list={list} active={active} onPick={pick} />
      </div>
    </Field>
  );
}

function CountrySelect({ value, onChange, countries }) {
  return (
    <select className="civr-input" value={value || ''} onChange={e => onChange(e.target.value)} aria-label="Country" data-testid="address-country-select">
      <option value="">Choose the country…</option>
      {countries.map(c => <option key={c.iso} value={c.iso}>{c.name}</option>)}
    </select>
  );
}

// Structured address: search fills it, every line stays editable.
export function AddressField({ value, onChange, countries }) {
  const a = value || {};
  const [manual, setManual] = useState(!!a.line1);
  const [note, setNote] = useState(null);
  const set = (k) => (e) => onChange({ ...a, [k]: e.target.value, placeId: null });
  const fill = (addr, err) => { if (err) { setNote(err); setManual(true); return; } setNote(null); onChange({ ...addr }); setManual(true); };
  return (
    <div className="space-y-4" data-testid="address-field">
      <Field label="Country"><CountrySelect value={a.countryCode} onChange={(cc) => onChange({ ...a, countryCode: cc })} countries={countries} /></Field>
      <AddressSearch country={a.countryCode} onFill={fill} />
      {note && <div className="text-xs text-[#fbbf24]" data-testid="address-search-note">{note}</div>}
      {manual ? (
        <div className="grid sm:grid-cols-2 gap-4 civr-rise" data-testid="address-manual-fields">
          <div className="sm:col-span-2"><Field label="Street address"><input className="civr-input" value={a.line1 || ''} onChange={set('line1')} autoComplete="address-line1" data-testid="address-line1-input" /></Field></div>
          <div className="sm:col-span-2"><Field label="Apartment, suite, floor (optional)"><input className="civr-input" value={a.line2 || ''} onChange={set('line2')} autoComplete="address-line2" data-testid="address-line2-input" /></Field></div>
          <Field label="City"><input className="civr-input" value={a.city || ''} onChange={set('city')} autoComplete="address-level2" data-testid="address-city-input" /></Field>
          <Field label="State / region (optional)"><input className="civr-input" value={a.region || ''} onChange={set('region')} autoComplete="address-level1" data-testid="address-region-input" /></Field>
          <Field label="Postal code"><input className="civr-input" value={a.postalCode || ''} onChange={set('postalCode')} autoComplete="postal-code" data-testid="address-postal-input" /></Field>
        </div>
      ) : (
        <button type="button" onClick={() => setManual(true)} className="text-sm text-[#818cf8] hover:underline inline-flex items-center gap-1.5 min-h-[40px]" data-testid="address-manual-toggle"><PencilLine className="w-4 h-4" />Can’t find it? Type the address</button>
      )}
    </div>
  );
}
