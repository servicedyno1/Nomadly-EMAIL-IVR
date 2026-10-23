import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Check, Loader2, Clock } from 'lucide-react';
import { api, money, enc, useApi } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, Spinner, ErrorNote, Label } from '../ui';
import { cp } from '../paths';
import Checkout from './buy/Checkout';

// The chosen number + plan survive the wallet top-up detour (Wallet links back with ?resume=1).
const RESUME_KEY = 'civr.buyResume';
const readResume = (params) => {
  if (!params.get('resume')) return null;
  try { return JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null'); } catch (_) { return null; }
};

function SearchForm({ catalog, q, setQ, onSearch, busy }) {
  const country = catalog.countries.find(c => c.code === q.country) || catalog.countries[0];
  const setCountry = (code) => { const c = catalog.countries.find(x => x.code === code); setQ({ country: code, type: c.types[0], areaCode: '' }); };
  const local = ['US', 'CA'].includes(q.country) && q.type === 'local';
  return (
    <form onSubmit={onSearch} className="civr-card p-6 grid md:grid-cols-4 gap-4 items-end" data-testid="buy-search-form">
      <Field label="Country">
        <select className="civr-input" value={q.country} onChange={e => setCountry(e.target.value)} data-testid="buy-country-select">
          {catalog.countries.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
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
  if (!res.numbers.length) return <div className="civr-card p-6 text-sm text-[#a1a1aa]" data-testid="buy-no-results">No numbers available for that search. Try another area code or type.</div>;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="buy-results">
      {res.numbers.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} data-testid={`buy-result-${i}`}
          className={`civr-card text-left p-4 ${pick?.phoneNumber === n.phoneNumber ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-mono text-lg">{n.phoneNumber}</span>{pick?.phoneNumber === n.phoneNumber && <Check className="w-4 h-4 text-[#34d399]" />}</div>
          <div className="text-xs text-[#9a9a9a] mt-1 truncate">{n.region || 'Any region'}</div>
          <div className="flex gap-2 mt-4">
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
    <div className="grid md:grid-cols-3 gap-4">
      {plans.filter(p => p.available).map(p => (
        <button key={p.id} type="button" onClick={() => onChange(p.id)} data-testid={`buy-plan-${p.id}`} className={`civr-card text-left p-6 ${value === p.id ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-display text-2xl font-bold">{p.name}</span>{value === p.id && <Check className="w-5 h-5 text-[#34d399]" />}</div>
          <div className="font-mono text-2xl mt-2">{money(p.price + (surcharge || 0))}<span className="text-xs text-[#9a9a9a]"> /month</span></div>
          <div className="text-xs text-[#a1a1aa] mt-1">{p.minutes} min · {p.sms} SMS included</div>
          <ul className="mt-4 flex flex-col gap-1 text-xs text-[#bbb]">{p.features.slice(0, 6).map(f => <li key={f}>· {f}</li>)}</ul>
        </button>
      ))}
    </div>
  );
}

// A crypto checkout still waiting for its payment.
function OpenOrder({ order }) {
  return (
    <Link to={cp(`/app/orders/${enc(order.id)}`)} className="civr-card civr-card-link p-4 mb-4 text-sm flex items-center gap-3" data-testid="buy-open-order-banner">
      <Clock className="w-4 h-4 text-[#fbbf24] shrink-0" />
      <span className="flex-1">Crypto payment {order.status === 'underpaid' ? 'came in short' : 'pending'} for <span className="font-mono">{order.phoneNumber}</span> ({money(order.price)})</span>
      <span className="text-[#34d399]">View →</span>
    </Link>
  );
}

export default function BuyNumber() {
  const { catalog, summary, refreshSummary } = useShell();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [saved] = useState(() => readResume(params));
  const [q, setQ] = useState(saved?.q || { country: 'US', type: 'local', areaCode: '' });
  const [res, setRes] = useState(saved?.res || null);
  const [pick, setPick] = useState(saved?.pick || null);
  const [plan, setPlan] = useState(saved?.plan || params.get('plan') || 'starter');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const { data: open } = useApi('/numbers/orders?open=1');
  useEffect(() => { refreshSummary(); }, [refreshSummary]);
  if (!catalog) return <Spinner />;
  const planObj = catalog.plans.find(p => p.id === plan && p.available) || catalog.plans.find(p => p.available);
  const total = planObj ? planObj.price + (pick?.surcharge || 0) : 0;
  const fromParam = !saved && params.get('plan') && planObj?.id === params.get('plan');

  const search = async (e) => {
    e.preventDefault(); setBusy('search'); setError(null); setPick(null);
    try { setRes(await api(`/numbers/search?country=${q.country}&type=${q.type}${q.areaCode ? `&areaCode=${q.areaCode}` : ''}`)); } catch (err) { setError(err); setRes(null); } finally { setBusy(''); }
  };
  const topUp = (shortBy) => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ q, res, pick, plan: planObj?.id }));
    nav(cp(`/app/wallet?need=${shortBy}&for=${enc(pick.phoneNumber)}`));
  };
  const buy = async ({ method, coin, autoRenew }) => {
    setBusy('buy'); setError(null);
    try {
      const d = await api('/numbers/checkout', { method: 'POST', body: { phoneNumber: pick.phoneNumber, plan: planObj.id, method, coin, autoRenew } });
      sessionStorage.removeItem(RESUME_KEY);
      refreshSummary();
      if (d.order) { nav(cp(`/app/orders/${enc(d.order.id)}`)); return; }
      if (d.verification) { toast.success('Paid — one last step for this number'); nav(cp('/app/verification')); return; }
      if (d.substitutedFrom) toast.info(`${d.substitutedFrom} was just taken, so you got ${d.number.phoneNumber} instead — same price.`);
      else toast.success(`${d.number.phoneNumber} is yours`);
      nav(cp(`/app/numbers/${enc(d.number.phoneNumber)}`));
    } catch (err) { setError(err); } finally { setBusy(''); }
  };

  return (
    <div data-testid="buy-page">
      <PageHeader label="Buy" title="Get a new number" sub={`${catalog.countries.length} countries. Pay with crypto or your wallet, renews monthly.`} testid="buy-header" />
      {open?.orders?.[0] && <OpenOrder order={open.orders[0]} />}
      {saved?.pick && <div className="civr-card p-4 mb-4 text-sm flex items-center gap-2" data-testid="buy-resume-note"><Check className="w-4 h-4 text-[#34d399]" />Welcome back — {saved.pick.phoneNumber} and the {planObj?.name} plan are still selected below.</div>}
      {fromParam && <div className="text-sm text-[#34d399] mb-4 flex items-center gap-2" data-testid="buy-plan-hint"><Check className="w-4 h-4" />{planObj.name} plan picked — search for a number below.</div>}
      <SearchForm catalog={catalog} q={q} setQ={setQ} onSearch={search} busy={busy === 'search'} />
      <div className="mt-4"><ErrorNote error={error} testid="buy-error" /></div>
      {res && <div className="mt-8"><Label>1 · Pick a number</Label><Results res={res} pick={pick} setPick={setPick} /></div>}
      {pick && (
        <div className="mt-8 civr-rise">
          <Label>2 · Pick a plan</Label>
          <PlanPicker plans={catalog.plans} value={planObj?.id} onChange={setPlan} surcharge={pick.surcharge} />
          <Checkout key={`${pick.phoneNumber}-${summary ? 1 : 0}`} pick={pick} planObj={planObj} total={total} balance={summary?.balance} coins={catalog.coins || []} busy={busy === 'buy'} onPay={buy} onTopUp={topUp} />
        </div>
      )}
    </div>
  );
}
