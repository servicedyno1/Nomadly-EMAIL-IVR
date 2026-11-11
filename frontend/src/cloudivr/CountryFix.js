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

let cache = null;
const loadCountries = () => (cache ||= api('/phone-countries').then(d => d.countries).catch((e) => { cache = null; throw e; }));

// One country for the whole list: "12 numbers have no country code — [United Kingdom (+44)] [Add country code]".
export function CountryFix({ count, suggest, onApply, busy, testid = 'country-fix', note }) {
  const [list, setList] = useState([]);
  const [cc, setCc] = useState(suggest || '');
  useEffect(() => { loadCountries().then(setList).catch(() => {}); }, []);
  useEffect(() => { if (suggest) setCc(c => c || suggest); }, [suggest]);
  if (!count) return null;
  return (
    <div className="mt-2 rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/10 p-3" data-testid={testid}>
      <div className="flex items-start gap-2 text-sm">
        <Globe2 className="w-4 h-4 mt-0.5 shrink-0 text-[#fbbf24]" />
        <span data-testid={`${testid}-count`}>{count === 1 ? '1 number has no country code.' : `${count.toLocaleString()} numbers have no country code.`} Pick their country and we’ll add it — each number is checked first.</span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mt-2.5">
        <select className="civr-input !h-10 flex-1" value={cc} onChange={e => setCc(e.target.value)} aria-label="Country of these numbers" data-testid={`${testid}-select`}>
          <option value="">Choose the country…</option>
          {list.map(c => <option key={c.iso} value={c.iso}>{`${c.name} (${c.code})`}</option>)}
        </select>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={!cc || busy} onClick={() => onApply(cc)} data-testid={`${testid}-apply`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Add country code</button>
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
