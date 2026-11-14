import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Check, Loader2, Clock, Layers, Plus } from 'lucide-react';
import { api, money, enc, useApi } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, Spinner, ErrorNote, Label } from '../ui';
import { cp } from '../paths';
import Checkout from './buy/Checkout';
import { PlanFeatures, RecommendedBadge, availablePlans } from '../PlanFeatures';
import { usePrivacy } from '../privacy';
import { Flag, IconSelect } from '../Pickers';
import { saveIntent, setupPath, USE_PLAN, rememberedUse } from './buy/setupIntent';
import { PurposePicker, PurposeSection, SmsPurposeCard, usePurposeCards } from './buy/PurposePicker';
import { FaxNumberBuy } from './buy/FaxNumberBuy';
import { useCivrAuth } from '../AuthContext';
import { BuyProfileGate } from '../profile/ProfilePrompts';
import { RequestOrder, PendingRequests } from './buy/RequestOrder';
import { PaperworkNote } from './buy/Paperwork';

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
    <form onSubmit={onSearch} className="civr-card p-6 grid sm:grid-cols-2 xl:grid-cols-4 gap-4 items-end" data-testid="buy-search-form">
      <Field label="Country">
        <IconSelect value={q.country} onChange={setCountry} label="Country" testid="buy-country-select"
          options={catalog.countries.map(c => ({ value: c.code, label: c.name, icon: <Flag code={c.code} /> }))} />
      </Field>
      <Field label="Number type">
        <select className="civr-input" value={q.type} onChange={e => setQ({ ...q, type: e.target.value })} data-testid="buy-type-select">
          {country.types.map(t => <option key={t} value={t}>{catalog.typeNames[t] || t}</option>)}
        </select>
      </Field>
      <Field label="Area code (optional)">
        <input className="civr-input font-mono" disabled={!local} maxLength={3} value={q.areaCode} onChange={e => setQ({ ...q, areaCode: e.target.value.replace(/\D/g, '') })} placeholder={local ? 'Any (e.g. 415)' : 'USA/CA local only'} data-testid="buy-area-code-input" />
      </Field>
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="buy-search-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Search numbers</button>
    </form>
  );
}

const cap = (w) => w.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
// 'CA, US, SHAFTER, SHAFTER' → 'Shafter, CA'
const place = (r) => { const p = [...new Set(String(r || '').split(',').map(x => x.trim()).filter(Boolean))]; if (!p.length) return 'Any region'; const st = p.find(x => /^[A-Z]{2}$/.test(x) && x !== 'US'); const city = p.find(x => x.length > 2 && x !== 'US'); return city ? `${cap(city)}${st ? `, ${st}` : ''}` : p.join(', '); };

function Results({ res, pick, setPick }) {
  if (!res.numbers.length) return <div className="civr-card p-6 text-sm text-[#a1a1aa]" data-testid="buy-no-results">No numbers available for that search. Try another area code or type.</div>;
  return (<>
    {res.fallback && <div className="civr-card p-4 mb-4 text-sm text-[#a1a1aa]" data-testid="buy-area-fallback-note">Area code {res.fallback.areaCode} has no numbers right now — here are other numbers{res.fallback.region ? ` in ${res.fallback.region}` : ''} you can use instantly.</div>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4 gap-4" data-testid="buy-results">
      {res.numbers.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => { setPick(n); setTimeout(() => document.querySelector('[data-testid="buy-plan-picker"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); }} data-testid={`buy-result-${i}`}
          className={`civr-card text-left p-4 ${pick?.phoneNumber === n.phoneNumber ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-mono text-lg">{n.phoneNumber}</span>{pick?.phoneNumber === n.phoneNumber && <Check className="w-4 h-4 text-[#818cf8]" />}</div>
          <div className="text-xs text-[#a1a1aa] mt-1 truncate">{place(n.region)}</div>
          <div className="flex gap-2 mt-4">
            {n.capabilities.voice && <span className="civr-pill">Calls</span>}{n.capabilities.sms && <span className="civr-pill">Texts</span>}{n.capabilities.fax && <span className="civr-pill" title="Send and receive faxes on the Business plan" data-testid={`buy-fax-pill-${i}`}>Fax</span>}
            {n.surcharge > 0 && <span className="civr-pill civr-pill-warn">+{money(n.surcharge)}/mo</span>}
          </div>
        </button>
      ))}
    </div>
  </>);
}

function PlanPicker({ plans, value, onChange, surcharge }) {
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="buy-plan-picker">
      {availablePlans(plans).map(p => (
        <button key={p.id} type="button" onClick={() => onChange(p.id)} aria-pressed={value === p.id} data-testid={`buy-plan-${p.id}`} data-selected={value === p.id ? 'true' : 'false'}
          className={`civr-card text-left p-6 flex flex-col ${value === p.id ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between gap-2 min-h-[28px]">
            <span className="font-display text-2xl font-bold">{p.name}</span>
            <span className="flex items-center gap-2">{p.recommended && <RecommendedBadge testid={`buy-plan-${p.id}-recommended`} />}{value === p.id && <Check className="w-5 h-5 text-[#818cf8]" />}</span>
          </div>
          <div className="font-mono text-2xl mt-2">{money(p.price + (surcharge || 0))}<span className="text-xs text-[#a1a1aa]"> /month</span></div>
          <div className="mt-4"><PlanFeatures plan={p} plans={plans} compact testid={`buy-plan-${p.id}-feature`} /></div>
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
      <span className="text-[#818cf8]">View →</span>
    </Link>
  );
}

// 3-step progress: Find → Pick → Plan & pay (2 steps for an extra number, which has no plan to pick).
function Steps({ current, extra }) {
  const steps = extra ? ['Find a number', 'Pick & pay'] : ['Find a number', 'Pick a number', 'Plan & pay'];
  return (
    <ol className="flex items-center gap-2 sm:gap-3 mb-6 civr-rise" aria-label="Checkout steps" data-testid="buy-steps">
      {steps.map((label, i) => {
        const k = i + 1; const state = k < current ? 'done' : k === current ? 'current' : 'todo';
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3 min-w-0" aria-current={state === 'current' ? 'step' : undefined} data-state={state} data-testid={`buy-step-${k}`}>
            <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-xs font-bold transition-colors ${state === 'done' ? 'bg-[#34d399] text-[#052e1f]' : state === 'current' ? 'bg-[var(--c-accent-strong,#6366f1)] text-white' : 'border border-[var(--c-border-hover,#2a2a2a)] text-[#a1a1aa]'}`} aria-hidden="true">{state === 'done' ? <Check className="w-4 h-4" /> : k}</span>
            <span className={`text-sm truncate ${state === 'current' ? 'font-semibold' : 'text-[#a1a1aa]'} ${state === 'todo' ? 'hidden sm:inline' : ''}`}>{label}</span>
            {i < steps.length - 1 && <span aria-hidden="true" className={`h-px w-6 sm:w-10 shrink-0 ${state === 'done' ? 'bg-[#34d399]' : 'bg-[var(--c-border-hover,#2a2a2a)]'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

// Existing customers: hang a new number off a plan they already pay for (shares its minutes, SMS & features)
// instead of buying a whole new plan. One tap jumps into the ?extra= flow.
function ExistingPlanChooser({ nums, price, pv }) {
  const nav = useNavigate();
  const [sel, setSel] = useState(nums[0]?.phoneNumber || '');
  return (
    <div className="civr-card civr-rise p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 !border-[#38bdf8]/40 bg-gradient-to-r from-[#38bdf8]/10 to-transparent" data-testid="buy-add-to-plan-card">
      <div className="w-11 h-11 rounded-xl bg-[#38bdf8]/15 flex items-center justify-center shrink-0"><Layers className="w-5 h-5 text-[#38bdf8]" /></div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-base">Add a number to your current plan</div>
        <div className="text-sm text-[#a1a1aa] mt-1">{`${money(price)}/month. It shares the plan, features and SIP logins of the line you pick. No new plan needed.`}</div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 shrink-0 w-full sm:w-auto">
        <select className="civr-input !h-11 sm:w-60" value={sel} onChange={e => setSel(e.target.value)} data-testid="buy-add-to-plan-select">
          {nums.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{`${pv.phone(n.phoneNumber)} · ${n.planName}`}</option>)}
        </select>
        <button type="button" className="civr-btn civr-btn-primary whitespace-nowrap !h-11 px-5" disabled={!sel} onClick={() => nav(cp(`/app/buy?extra=${enc(sel)}`))} data-testid="buy-add-to-plan-cta"><Plus className="w-4 h-4" />Add to this plan</button>
      </div>
    </div>
  );
}

export default function BuyNumber() {
  const { catalog, summary, refreshSummary } = useShell();
  const needsProfile = !useCivrAuth()?.account?.profileComplete;
  const [reqTick, setReqTick] = useState(0);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [saved] = useState(() => readResume(params));
  const [q, setQ] = useState(saved?.q || { country: (params.get('country') || 'US').toUpperCase(), type: params.get('type') || 'local', areaCode: '' });
  const [res, setRes] = useState(saved?.res || null);
  const [pick, setPick] = useState(saved?.pick || null);
  const [plan, setPlan] = useState(saved?.plan || params.get('plan') || USE_PLAN[rememberedUse()] || null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [coupon, setCoupon] = useState(saved?.coupon || null);
  const extraOf = params.get('extra');
  const { data: extra } = useApi(extraOf ? `/numbers/${enc(extraOf)}/extra` : null);
  const { data: myNums } = useApi('/numbers');
  const pv = usePrivacy();
  const { data: open } = useApi('/numbers/orders?open=1');
  const { data: textingOffer } = useApi(extraOf ? null : '/mobile-numbers');
  const [use] = useState(rememberedUse);
  const [purposes, setPurposes] = useState(() => (params.get('purpose') ? params.get('purpose').split(',') : saved || params.get('plan') || params.get('coupon') ? ['voice'] : []));
  const cards = usePurposeCards(catalog, myNums);
  const line = !!extraOf || purposes.includes('voice') || purposes.includes('sip');
  useEffect(() => { refreshSummary(); }, [refreshSummary]);
  if (!catalog) return <Spinner />;
  // Active main numbers the caller can hang an extra number off of.
  const eligible = (myNums?.numbers || []).filter(n => n.status === 'active' && !n.isSubNumber && !n.replacedBy);
  const parent = extraOf ? (myNums?.numbers || []).find(n => n.phoneNumber === extraOf) : null;
  // Picked plan → the recommended plan (Pro) → the first plan on sale.
  const avail = (id) => catalog.plans.find(p => p.id === id && p.available);
  const planObj = avail(plan) || avail(catalog.recommendedPlan) || catalog.plans.find(p => p.available);
  const total = extraOf ? (pick?.extraPrice ?? extra?.price ?? 0) : planObj ? planObj.price + (pick?.surcharge || 0) : 0;
  const pc = res?.paperwork?.compliance;
  const docsMissing = res?.paperwork?.level === 2 && (!res.paperwork.documents?.ready || (pc && (pc.identity?.status !== 'verified' || (pc.business && pc.company?.status !== 'approved'))));
  const fromParam = !saved && params.get('plan') && planObj?.id === params.get('plan');

  const search = async (e) => {
    e.preventDefault(); setBusy('search'); setError(null); setPick(null);
    try { setRes(await api(`/numbers/search?country=${q.country}&type=${q.type}${q.areaCode ? `&areaCode=${q.areaCode}` : ''}`)); } catch (err) { setError(err); setRes(null); } finally { setBusy(''); }
  };
  const topUp = (shortBy) => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ q, res, pick, plan: planObj?.id, coupon }));
    nav(cp(`/app/wallet?need=${shortBy}&for=${enc(pick.phoneNumber)}${extraOf ? `&extra=${enc(extraOf)}` : ''}`));
  };
  const buy = async ({ method, coin, autoRenew, texting, useWallet }) => {
    setBusy('buy'); setError(null);
    try {
      const d = extraOf
        ? method === 'crypto'
          ? await api(`/numbers/${enc(extraOf)}/extra-checkout`, { method: 'POST', body: { phoneNumber: pick.phoneNumber, coin, coupon: coupon?.code, autoRenew, useWallet } })
          : await api(`/numbers/${enc(extraOf)}/extra`, { method: 'POST', body: { phoneNumber: pick.phoneNumber, coupon: coupon?.code, autoRenew } })
        : await api('/numbers/checkout', { method: 'POST', body: { phoneNumber: pick.phoneNumber, plan: planObj.id, method, coin, autoRenew, coupon: coupon?.code, texting, useWallet } });
      sessionStorage.removeItem(RESUME_KEY);
      refreshSummary();
      const useNow = use && !extraOf && USE_PLAN[use] === planObj?.id ? use : null;
      if (!extraOf) saveIntent(useNow, d.number?.phoneNumber || null);
      if (d.texting) d.texting.error ? toast.error(d.texting.error) : toast.success('Texting Number ordered — we’ll tell you when it’s ready');
      if (d.order) { nav(cp(`/app/orders/${enc(d.order.id)}`)); return; }
      if (d.verification) { toast.success('Paid — one last step for this number'); nav(cp('/app/verification')); return; }
      if (d.substitutedFrom) toast.info(`${d.substitutedFrom} was just taken, so you got ${d.number.phoneNumber} instead — same price.`);
      else toast.success(`${d.number.phoneNumber} is yours`);
      nav(cp(setupPath(useNow, d.number.phoneNumber)));
    } catch (err) { setError(err); toast.error(err.message); } finally { setBusy(''); }
  };

  return (
    <div data-testid="buy-page">
      {extraOf ? <PageHeader label="Phone numbers · Extra number" title="Add an extra number" sub={`Shares the plan of ${pv.phone(extraOf)} — ${money(extra?.price || 25)}/month, same features. Pay from your wallet or with crypto.${extra ? ` ${extra.used} of ${extra.limit} used.` : ''}`} testid="buy-header" />
        : <PageHeader label="Phone numbers" title="Get a number" sub="Choose what the number is for. Everything is month to month and paid from your wallet." testid="buy-header" />}
      {extraOf
        ? <p className="text-sm text-[#a1a1aa] -mt-2 mb-6" data-testid="buy-extra-back"><Link to={cp('/app/buy')} className="inline-block py-2 text-[#818cf8] underline underline-offset-2" data-testid="buy-extra-back-button">Buy a brand-new number with its own plan instead</Link></p>
        : <>
          {eligible.length > 0 && <ExistingPlanChooser nums={eligible} price={catalog.extraNumber?.price || 25} pv={pv} />}
          <PurposePicker cards={cards} value={purposes} onChange={setPurposes} />
          {!purposes.length && <div className="civr-card p-5 mb-6 text-sm text-[#a1a1aa]" data-testid="buy-purpose-empty">Choose a card above. Its steps appear here.</div>}
        </>}
      {line && !extraOf && <PurposeSection n={1} title={`${[purposes.includes('voice') && 'Voice', purposes.includes('sip') && 'SIP'].filter(Boolean).join(' & ') || 'Voice'} · Business Line`} sub={purposes.includes('sip') ? 'Find a number, then pick Starter, Pro or Business: those plans include SIP logins.' : 'Find a number, pick a plan and pay.'} testid="buy-line-section" />}
      {line && <>
      {open?.orders?.[0] && <OpenOrder order={open.orders[0]} />}
      <PendingRequests refresh={reqTick} />
      {saved?.pick && <div className="civr-card p-4 mb-4 text-sm flex items-center gap-2" data-testid="buy-resume-note"><Check className="w-4 h-4 text-[#818cf8]" />Welcome back — {saved.pick.phoneNumber} and the {planObj?.name} plan are still selected below.</div>}
      {fromParam && <div className="text-sm text-[#818cf8] mb-4 flex items-center gap-2" data-testid="buy-plan-hint"><Check className="w-4 h-4" />{planObj.name} plan picked — search for a number below.</div>}
      <Steps current={pick ? (extraOf ? 2 : 3) : res ? 2 : 1} extra={!!extraOf} />
      <Label>Find a number</Label>
      <SearchForm catalog={catalog} q={q} setQ={setQ} onSearch={search} busy={busy === 'search'} />

      <div className="mt-4"><ErrorNote error={error} testid="buy-error" /></div>
      {res?.request ? <div className="mt-8"><Label>Pick a plan and order</Label>
        <PlanPicker plans={catalog.plans} value={planObj?.id} onChange={setPlan} surcharge={0} />
        <div className="mt-6">{needsProfile ? <BuyProfileGate /> : <RequestOrder request={res.request} plan={planObj} onDone={() => { setRes(null); setReqTick(t => t + 1); }} />}</div></div>
        : res && <div className="mt-8"><Label>Pick a number</Label>
          <PaperworkNote paperwork={res.paperwork} country={q.country} countryName={catalog.countries.find(c => c.code === q.country)?.name || q.country} onChange={(documents) => setRes(r => ({ ...r, paperwork: { ...r.paperwork, documents } }))} />
          <Results res={res} pick={pick} setPick={setPick} /></div>}
      {pick && (
        <div className="mt-8 civr-rise">
          {!extraOf && <>
          <Label>Pick a plan and pay</Label>
          <p className="text-xs text-[#a1a1aa] -mt-1 mb-3" data-testid="buy-plan-help">Each plan includes everything in the one before it. You can upgrade your Business Line later from its Billing tab.</p>
          <PlanPicker plans={catalog.plans} value={planObj?.id} onChange={setPlan} surcharge={pick.surcharge} />
          </>}
          {needsProfile ? <BuyProfileGate /> : docsMissing ? <div className="civr-card p-5 text-sm text-[#fbbf24]" data-testid="buy-documents-required">Finish the steps above (documents, ID check{pc?.business ? ', company papers' : ''}) to buy this number.</div> : <Checkout key={`${pick.phoneNumber}-${summary ? 1 : 0}`} pick={pick} planObj={planObj} total={total} balance={summary?.balance} coins={catalog.coins || []} busy={busy === 'buy'} onPay={buy} onTopUp={topUp}
            textingOffer={extraOf ? null : textingOffer} coupon={coupon} setCoupon={setCoupon} initialCode={params.get('coupon') || ''} cryptoMin={extraOf ? catalog.minTopup : 0} label={extraOf ? `Extra number on ${pv.phone(extraOf)} · monthly` : null} autoRenewDefault={extraOf ? (parent ? parent.autoRenew !== false : true) : true} />}
        </div>
      )}
      </>}
      {!extraOf && purposes.includes('sms') && <PurposeSection n={line ? 2 : 1} title="SMS · Texting Number" sub="A separate number made for texting." testid="buy-sms-section"><SmsPurposeCard /></PurposeSection>}
      {!extraOf && purposes.includes('fax') && <PurposeSection n={1 + (line ? 1 : 0) + (purposes.includes('sms') ? 1 : 0)} title="Fax · Fax-only number" sub="Search, pick your number and pay from your wallet." testid="buy-fax-section">{needsProfile ? <BuyProfileGate /> : <FaxNumberBuy balance={summary?.balance} onBought={refreshSummary} />}</PurposeSection>}
    </div>
  );
}
