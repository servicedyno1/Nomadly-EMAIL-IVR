import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Search, Loader2, Check, ArrowRight } from 'lucide-react';
import { api, usd } from '../../api';
import { cp } from '../../paths';
import { useCivrAuth } from '../../AuthContext';
import { Card } from './ProductHero';

export const FAX_PICK_KEY = 'civr.faxPick';
const points = (f) => ['Sends and receives faxes only. It never takes calls or texts', `${f?.freePages ?? 25} free pages a month, then ${usd(f?.pagePrice ?? 0.05)} a page`, 'Received faxes arrive as PDFs in CloudIVR and by email', 'Send to one number or up to 500 at once, with a cover page'];

// Landing Fax tab: visitors search real fax numbers first; the pick is kept through sign-up and pre-selected on Buy.
export function FaxLanding({ fax }) {
  const { account } = useCivrAuth();
  const nav = useNavigate();
  const [q, setQ] = useState({ country: 'US', areaCode: '' });
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const search = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setPick(null);
    try { setRes(await api(`/public/fax-numbers/search?country=${q.country}${q.type ? `&type=${q.type}` : ''}${q.areaCode && ['US', 'CA'].includes(q.country) ? `&areaCode=${q.areaCode}` : ''}`)); } catch (x) { setErr(x.message); setRes(null); } finally { setBusy(false); }
  };
  const go = () => {
    sessionStorage.setItem(FAX_PICK_KEY, JSON.stringify({ ...pick, country: q.country, type: q.type || fax?.countries?.find(x => x.code === q.country)?.types?.[0]?.type || 'local', at: Date.now() }));
    nav(account ? cp('/app/buy?purpose=fax') : cp('/signup?plan=fax'));
  };
  return (
    <div className="grid lg:grid-cols-5 gap-5" data-testid="fax-landing">
      <div className="lg:col-span-2"><Card id="fax" icon={Printer} badge={`${fax?.countries?.length || 15} countries`} title="Fax number" kind="Fax-only number, online" price={fax?.price || 50} points={points(fax)} note="Search for your exact number, then create your free account to pay." /></div>
      <div className="lg:col-span-3 v2-surface p-6 sm:p-7" data-testid="fax-landing-search">
        <div className="font-semibold text-slate-950">Find your fax number</div>
        {fax && !fax.available ? <p className="text-sm text-slate-600 mt-3" data-testid="fax-landing-unavailable">Fax numbers are not available right now. Please check back soon.</p> : <>
          <form onSubmit={search} className="mt-4 grid sm:grid-cols-3 gap-3" data-testid="fax-landing-form">
            <select value={q.country} onChange={e => setQ({ country: e.target.value, type: '', areaCode: '' })} aria-label="Country" className="rounded-xl border border-slate-300 bg-white px-3 h-12 text-slate-900" data-testid="fax-landing-country">{(fax?.countries || [{ code: 'US', name: 'United States' }]).map(c => <option key={c.code} value={c.code}>{c.name}{c.types.every(t => t.paperwork !== 'none') ? ' · name + address' : ''}</option>)}</select>
            {(() => { const c = fax?.countries?.find(x => x.code === q.country); return c?.types?.length > 1 ? <select value={q.type || c.types[0].type} onChange={e => setQ({ ...q, type: e.target.value })} aria-label="Number type" className="rounded-xl border border-slate-300 bg-white px-3 h-12 text-slate-900" data-testid="fax-landing-type">{c.types.map(t => <option key={t.type} value={t.type}>{t.label}{t.paperwork !== 'none' ? ' · name + address' : ''}</option>)}</select> : c?.areaCodes !== false ? <input value={q.areaCode} maxLength={3} onChange={e => setQ({ ...q, areaCode: e.target.value.replace(/\D/g, '') })} placeholder="Area code (optional)" aria-label="Area code" className="rounded-xl border border-slate-300 bg-white px-3 h-12 text-slate-900" data-testid="fax-landing-area" /> : <div />; })()}
            <button className="civr-l-btn !h-12 inline-flex items-center justify-center gap-2" disabled={busy} data-testid="fax-landing-search-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Search</button>
          </form>
          {err && <p role="alert" className="text-sm text-rose-600 mt-3" data-testid="fax-landing-error">{err}</p>}
          {!res && !busy && !err && <p className="text-sm text-slate-600 mt-4" data-testid="fax-landing-hint">Pick a country and tap Search. You’ll see real fax numbers you can choose from — no account needed yet.</p>}
          {res?.nearbyOnly && <p className="text-sm text-slate-600 mt-3" data-testid="fax-landing-nearby">{`No fax numbers in area code ${res.areaCode} right now. These are nearby.`}</p>}
          {res && !res.numbers.length && <p className="text-sm text-slate-600 mt-3" data-testid="fax-landing-none">No fax numbers for that search. Try another area code.</p>}
          {res?.numbers?.length > 0 && (
            <div className="mt-4 grid sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1" data-testid="fax-landing-results">
              {res.numbers.map((n, i) => (
                <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} data-testid={`fax-landing-result-${i}`} className={`rounded-xl border px-4 py-3 text-left transition-colors ${pick?.phoneNumber === n.phoneNumber ? 'border-[#1d6fd8] bg-[#edf4ff]' : 'border-slate-200 bg-white hover:border-[#1d6fd8]/40'}`}>
                  <div className="flex items-center justify-between font-mono text-slate-950">{n.phoneNumber}{pick?.phoneNumber === n.phoneNumber && <Check className="w-4 h-4 text-[#1d6fd8]" />}</div>
                  <div className="text-xs text-slate-500 break-words">{n.region || 'Any region'}</div>
                </button>
              ))}
            </div>
          )}
          {pick && <button type="button" onClick={go} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="fax-landing-continue">{account ? `Get ${pick.phoneNumber}` : `Create free account for ${pick.phoneNumber}`}<ArrowRight className="w-4 h-4" /></button>}
        </>}
      </div>
    </div>
  );
}
