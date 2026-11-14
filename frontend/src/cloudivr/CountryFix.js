import { FlagSelect } from './Pickers';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Globe2, Loader2 } from 'lucide-react';
import { api } from './api';

// Numbers typed without a country code (no +/00, and not 1 + 10 digits). Mirrors the server check.
export const noCodeCount = (text) => String(text || '').split(/[,;\t\n]/).map(t => t.trim())
  .filter(t => /^[\d\s().-]+$/.test(t) && t.replace(/\D/g, '').length >= 7 && !/^1\d{10}$/.test(t.replace(/\D/g, ''))
    && (/^\d{10}$/.test(t.replace(/\D/g, '')) || /^0\d{6,}$/.test(t.replace(/\D/g, '')))).length;

// Mostly bare 10-digit numbers → pre-pick USA/Canada (the customer can change it).
const suggestOf = (text) => { const t = String(text || '').split(/[,;\t\n]/).map(x => x.trim()).filter(x => !/^(\+|00)/.test(x.replace(/\s/g, ''))).map(x => x.replace(/\D/g, '')).filter(d => d.length >= 7 && !/^1\d{10}$/.test(d)); return t.length && t.filter(d => d.length === 10).length / t.length >= 0.8 ? 'US' : null; };

// { countries, last } — `last` is the country this account picked last time (remembered on the account).
let cache = null;
const loadCountries = () => (cache ||= api('/phone-countries').catch((e) => { cache = null; throw e; }));
const remember = (cc) => { if (cache) cache = cache.then(d => ({ ...d, last: cc })); };
// Last-used country first, then A–Z.
const ordered = (d) => (d.last ? [...d.countries.filter(c => c.iso === d.last), ...d.countries.filter(c => c.iso !== d.last)] : d.countries);

function useCountries(suggest, initial) {
  const [d, setD] = useState({ countries: [], last: null });
  const [cc, setCc] = useState(initial || '');
  useEffect(() => { loadCountries().then(x => { setD(x); setCc(c => c || x.last || suggest || ''); }).catch(() => {}); }, [suggest]);
  return { list: ordered(d), last: d.last, cc, setCc };
}

// A single number (add / edit contact): only shown when the number has no country code.
export function PhoneCountry({ phone, value, onChange, testid = 'phone-country' }) {
  const n = noCodeCount(phone);
  const { list, last, cc, setCc } = useCountries(suggestOf(phone), value);
  useEffect(() => { if (n && cc && cc !== value) onChange(cc); }, [n, cc, value, onChange]);
  if (!n) return null;
  return (
    <div className="mt-2 rounded-lg border border-[#fbbf24]/40 bg-[#fbbf24]/10 p-2.5" data-testid={testid}>
      <div className="text-xs mb-1.5 flex items-center gap-1.5"><Globe2 className="w-3.5 h-3.5 text-[#fbbf24]" />No country code — which country is this number in?</div>
      <FlagSelect code={cc}><select className="civr-input !h-10" value={cc} onChange={e => { setCc(e.target.value); onChange(e.target.value); }} aria-label="Country of this number" data-testid={`${testid}-select`}>
        <option value="">Choose the country…</option>
        {list.map(c => <option key={c.iso} value={c.iso}>{`${c.name} (${c.code})${c.iso === last ? ' · last used' : ''}`}</option>)}
      </select></FlagSelect>
      <div className="text-xs text-[#a1a1aa] mt-1.5">We add the code when you save, after checking the number fits that country.</div>
    </div>
  );
}

// One country for the whole list: "12 numbers have no country code — [United Kingdom (+44)] [Add country code]".
export function CountryFix({ count, suggest, onApply, busy, testid = 'country-fix', note }) {
  const { list, last, cc, setCc } = useCountries(suggest);
  if (!count) return null;
  return (
    <div className="mt-2 rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/10 p-3" data-testid={testid}>
      <div className="flex items-start gap-2 text-sm">
        <Globe2 className="w-4 h-4 mt-0.5 shrink-0 text-[#fbbf24]" />
        <span data-testid={`${testid}-count`}>{count === 1 ? '1 number has no country code.' : `${count.toLocaleString()} numbers have no country code.`} Pick their country and we’ll add it — each number is checked first.</span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mt-2.5">
        <div className="flex-1"><FlagSelect code={cc}><select className="civr-input !h-10 w-full" value={cc} onChange={e => setCc(e.target.value)} aria-label="Country of these numbers" data-testid={`${testid}-select`}>
          <option value="">Choose the country…</option>
          {list.map(c => <option key={c.iso} value={c.iso}>{`${c.name} (${c.code})${c.iso === last ? ' · last used' : ''}`}</option>)}
        </select></FlagSelect></div>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={!cc || busy} onClick={() => { remember(cc); onApply(cc); }} data-testid={`${testid}-apply`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Add country code</button>
      </div>
      {note && <div className="text-xs text-[#a1a1aa] mt-2" data-testid={`${testid}-note`}>{note}</div>}
    </div>
  );
}

// Text boxes (campaign numbers, Quick call, Text-to-voice call): rewrites the text in place via the server check.
export function TextCountryFix({ text, onChange, testid }) {
  const [busy, setBusy] = useState(false);
  const [noteOf, setNoteOf] = useState({ text: null, note: '' });
  const note = noteOf.text === text ? noteOf.note : '';
  const n = noCodeCount(text);
  const apply = async (country) => {
    setBusy(true);
    try {
      const d = await api('/contacts/fix-country', { method: 'POST', body: { text, country } });
      onChange(d.text);
      const left = d.notFitCount ? ` ${d.notFitCount === 1 ? `1 number doesn’t look like a ${d.countryName} number — check it` : `${d.notFitCount} numbers don’t look like ${d.countryName} numbers — check them`}: ${d.notFit.slice(0, 5).join(', ')}${d.notFitCount > 5 ? '…' : ''}` : '';
      setNoteOf({ text: d.text, note: left.trim() });
      if (d.fixed) toast.success(`Added the ${d.countryName} code to ${d.fixed === 1 ? '1 number' : `${d.fixed} numbers`}.${left}`);
      else toast.error(n === 1 ? `This number doesn’t look like a ${d.countryName} number.` : `None of these numbers look like ${d.countryName} numbers.`);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!n && !note) return null;
  if (!n) return <div className="text-xs text-[#fbbf24] mt-2" data-testid={`${testid}-note`}>{note}</div>;
  return <CountryFix count={n} suggest={suggestOf(text)} onApply={apply} busy={busy} testid={testid} note={note} />;
}
