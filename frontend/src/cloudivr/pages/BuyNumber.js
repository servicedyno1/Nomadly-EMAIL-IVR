import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Check, Loader2, ShieldCheck } from 'lucide-react';
import { api, money, enc } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, Spinner, ErrorNote, Label } from '../ui';
import { cp } from '../paths';

function SearchForm({ catalog, q, setQ, onSearch, busy }) {
  const country = catalog.countries.find(c => c.code === q.country) || catalog.countries[0];
  const setCountry = (code) => { const c = catalog.countries.find(x => x.code === code); setQ({ country: code, type: c.types[0], areaCode: '' }); };
  const local = ['US', 'CA'].includes(q.country) && q.type === 'local';
  return (
    <form onSubmit={onSearch} className="civr-card p-6 grid md:grid-cols-4 gap-4 items-end" data-testid="buy-search-form">
      <Field label="Country">
        <select className="civr-input" value={q.country} onChange={e => setCountry(e.target.value)} data-testid="buy-country-select">
          {catalog.countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}{c.verification ? ' · ID check' : ''}</option>)}
        </select>
      </Field>
      <Field label="Number type">
        <select className="civr-input" value={q.type} onChange={e => setQ({ ...q, type: e.target.value })} data-testid="buy-type-select">
          {country.types.map(t => <option key={t} value={t}>{catalog.typeNames[t] || t}</option>)}
        </select>
      </Field>
      <Field label="Area code (optional)">
        <input className="civr-input font-mono" disabled={!local} maxLength={3} value={q.areaCode} onChange={e => setQ({ ...q, areaCode: e.target.value.replace(/\D/g, '') })} placeholder={local ? '415' : 'US/CA local only'} data-testid="buy-area-code-input" />
      </Field>
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="buy-search-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Search numbers</button>
    </form>
  );
}

function Results({ res, pick, setPick }) {
  if (!res.numbers.length) return <div className="civr-card p-6 text-sm text-[#888]" data-testid="buy-no-results">No numbers available for that search. Try another area code or type.</div>;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="buy-results">
      {res.numbers.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} data-testid={`buy-result-${i}`}
          className={`civr-card text-left p-4 ${pick?.phoneNumber === n.phoneNumber ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-mono text-lg">{n.phoneNumber}</span>{pick?.phoneNumber === n.phoneNumber && <Check className="w-4 h-4 text-[#34d399]" />}</div>
          <div className="text-xs text-[#777] mt-1 truncate">{n.region || 'Any region'}</div>
          <div className="flex gap-1.5 mt-3">
            {n.capabilities.voice && <span className="civr-pill">voice</span>}{n.capabilities.sms && <span className="civr-pill">sms</span>}{n.capabilities.fax && <span className="civr-pill">fax</span>}
            {n.surcharge > 0 && <span className="civr-pill civr-pill-warn">+{money(n.surcharge)}/mo</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

function PlanPicker({ plans, value, onChange, surcharge }) {
  return (
    <div className="grid md:grid-cols-3 gap-3">
      {plans.filter(p => p.available).map(p => (
        <button key={p.id} type="button" onClick={() => onChange(p.id)} data-testid={`buy-plan-${p.id}`} className={`civr-card text-left p-5 ${value === p.id ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-display text-2xl font-bold">{p.name}</span>{value === p.id && <Check className="w-5 h-5 text-[#34d399]" />}</div>
          <div className="font-mono text-2xl mt-2">{money(p.price + (surcharge || 0))}<span className="text-xs text-[#777]"> /month</span></div>
          <div className="text-xs text-[#888] mt-1">{p.minutes} min · {p.sms} SMS included</div>
          <ul className="mt-3 space-y-1 text-xs text-[#aaa]">{p.features.slice(0, 6).map(f => <li key={f}>· {f}</li>)}</ul>
        </button>
      ))}
    </div>
  );
}

export default function BuyNumber() {
  const { catalog, summary, refreshSummary } = useShell();
  const nav = useNavigate();
  const [q, setQ] = useState({ country: 'US', type: 'local', areaCode: '' });
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(null);
  const [plan, setPlan] = useState('starter');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  if (!catalog) return <Spinner />;
  const planObj = catalog.plans.find(p => p.id === plan);
  const total = planObj ? planObj.price + (pick?.surcharge || 0) : 0;

  const search = async (e) => {
    e.preventDefault(); setBusy('search'); setError(null); setPick(null);
    try { setRes(await api(`/numbers/search?country=${q.country}&type=${q.type}${q.areaCode ? `&areaCode=${q.areaCode}` : ''}`)); } catch (err) { setError(err); setRes(null); } finally { setBusy(''); }
  };
  const buy = async () => {
    setBusy('buy'); setError(null);
    try {
      const d = await api('/numbers/buy', { method: 'POST', body: { phoneNumber: pick.phoneNumber, plan } });
      refreshSummary();
      if (d.verification) { toast.success('Paid — now finish the verification'); nav(cp('/app/verification')); return; }
      toast.success(`${d.number.phoneNumber} is yours`);
      nav(cp(`/app/numbers/${enc(d.number.phoneNumber)}`));
    } catch (err) { setError(err); } finally { setBusy(''); }
  };

  return (
    <div data-testid="buy-page">
      <PageHeader label="Buy" title="Get a new number" sub={`${catalog.countries.length} countries. Paid from your wallet, renews monthly.`} testid="buy-header" />
      <SearchForm catalog={catalog} q={q} setQ={setQ} onSearch={search} busy={busy === 'search'} />
      <div className="mt-4"><ErrorNote error={error} testid="buy-error" /></div>
      {res?.verification?.required && (
        <div className="civr-card p-5 mt-4 flex gap-3 text-sm" data-testid="buy-verification-note">
          <ShieldCheck className="w-5 h-5 text-[#fbbf24] shrink-0" />
          <div><div className="font-semibold mb-1">This country needs an ID check</div><div className="text-[#999] civr-prompt" dangerouslySetInnerHTML={{ __html: (res.verification.note || '').replace(/\n/g, '<br/>') }} /></div>
        </div>
      )}
      {res && <div className="mt-8"><Label>1 · Pick a number</Label><Results res={res} pick={pick} setPick={setPick} /></div>}
      {pick && (
        <div className="mt-8 civr-rise">
          <Label>2 · Pick a plan</Label>
          <PlanPicker plans={catalog.plans} value={plan} onChange={setPlan} surcharge={pick.surcharge} />
          <div className="civr-card p-6 mt-6 flex flex-col md:flex-row md:items-center gap-4" data-testid="buy-summary">
            <div className="flex-1">
              <div className="font-mono text-xl">{pick.phoneNumber}</div>
              <div className="text-sm text-[#888]">{planObj?.name} plan · wallet {money(summary?.balance)}</div>
            </div>
            <div className="font-mono text-3xl" data-testid="buy-total">{money(total)}</div>
            {summary && summary.balance < total
              ? <Link to={cp('/app/wallet')} className="civr-btn civr-btn-ghost" data-testid="buy-topup-link">Top up wallet first</Link>
              : <button className="civr-btn civr-btn-primary" onClick={buy} disabled={busy === 'buy'} data-testid="buy-confirm-button">{busy === 'buy' && <Loader2 className="w-4 h-4 animate-spin" />}Pay {money(total)} &amp; activate</button>}
          </div>
        </div>
      )}
    </div>
  );
}
