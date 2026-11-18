import { openHelpChat } from '../../shortcuts';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Check, Loader2, Clock, Layers, Plus } from 'lucide-react';
import { api, money, enc, useApi } from '../../api';
import { useShell } from '../../Shell';
import { Field, Spinner, ErrorNote, Label } from '../../ui';
import { cp } from '../../paths';
import Checkout from './Checkout';
import { PlanFeatures, RecommendedBadge, availablePlans } from '../../PlanFeatures';
import { usePrivacy } from '../../privacy';
import { Flag, IconSelect } from '../../Pickers';
import { saveIntent, setupPath, USE_PLAN, rememberedUse } from './setupIntent';
import { useCivrAuth } from '../../AuthContext';
import { BuyProfileGate } from '../../profile/ProfilePrompts';
import { RequestOrder, PendingRequests } from './RequestOrder';
import { PaperworkNote } from './Paperwork';

// The chosen number + plan survive the wallet top-up detour (Wallet links back with ?resume=1).
const RESUME_KEY = 'civr.buyResume';
const readResume = (params) => {
  if (!params.get('resume')) return null;
  try { return JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null'); } catch (_) { return null; }
};

// Every country and type, for a plan's own number and for extra numbers alike (outside the plan's countries adds a monthly charge).
const planCountries = (catalog) => catalog.countries;

function SearchForm({ catalog, q, setQ, onSearch, busy, extra }) {
  const list = planCountries(catalog, extra);
  const country = list.find(c => c.code === q.country) || list[0];
  const setCountry = (code) => { const c = list.find(x => x.code === code); setQ({ country: code, type: c.types[0], areaCode: '' }); };
  const off = country && (country.code !== q.country || !country.types.includes(q.type));
  useEffect(() => { if (off) setQ({ country: country.code, type: country.types.includes(q.type) && country.code === q.country ? q.type : country.types[0], areaCode: '' }); }, [off]); // eslint-disable-line react-hooks/exhaustive-deps
  const local = ['US', 'CA'].includes(q.country) && q.type === 'local';
  return (
    <form onSubmit={onSearch} className="civr-card p-6 grid sm:grid-cols-2 xl:grid-cols-4 gap-4 items-end" data-testid="buy-search-form">
      <Field label="Country">
        <IconSelect value={q.country} onChange={setCountry} label="Country" testid="buy-country-select"
          options={list.map(c => ({ value: c.code, label: extra ? c.name : `${c.name} · ${c.included === true || c.included === 'all' ? 'free with every plan' : c.included === 'business' ? 'free with Business' : 'extra monthly charge'}`, icon: <Flag code={c.code} /> }))} />
      </Field>
      <Field label="Number type">
        <select className="civr-input" value={country.types.includes(q.type) ? q.type : country.types[0]} onChange={e => setQ({ ...q, country: country.code, type: e.target.value })} data-testid="buy-type-select">
          {country.types.map(t => <option key={t} value={t}>{catalog.typeNames[t] || t}</option>)}
        </select>
      </Field>
      <Field label="Area code (optional)">
        <input className="civr-input font-mono" disabled={!local} maxLength={3} value={q.areaCode} onChange={e => setQ({ ...q, areaCode: e.target.value.replace(/\D/g, '') })} placeholder={local ? 'Any, e.g. 415' : 'Only for USA/Canada local'} data-testid="buy-area-code-input" />
      </Field>
      {!extra && <p className="sm:col-span-2 xl:col-span-4 text-xs text-[var(--c-muted)] -mt-1 order-last" data-testid="buy-included-note">Plans include a number from the USA, Canada or UK (Business also: Netherlands, France, Spain). Any other country adds a monthly charge, shown before you pay.</p>}
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="buy-search-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Search numbers</button>
    </form>
  );
}

const cap = (w) => w.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
// 'CA, US, SHAFTER, SHAFTER' → 'Shafter, CA'
const place = (r) => { const p = [...new Set(String(r || '').split(',').map(x => x.trim()).filter(Boolean))]; if (!p.length) return 'Any region'; const st = p.find(x => /^[A-Z]{2}$/.test(x) && x !== 'US'); const city = p.find(x => x.length > 2 && x !== 'US'); return city ? `${cap(city)}${st ? `, ${st}` : ''}` : p.join(', '); };

// Monthly add-on for this number on a plan: free inside the plan's countries, otherwise the country charge.
const addonOf = (n, planId) => (n ? n.planAddons?.[planId] ?? n.surcharge ?? 0 : 0);

function Results({ res, isOn, onPick, planTexting, planId }) {
  if (!res.numbers.length) return <div className="civr-card p-6 text-sm text-[var(--c-muted)] flex flex-wrap items-center gap-3" data-testid="buy-no-results"><span className="flex-1 min-w-[14rem]">{res.message || 'No numbers available for that search. Try another area code or type.'}</span>{res.unavailable && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => openHelpChat?.(`I'd like a number that isn't listed: ${res.message || ''}`)} data-testid="buy-no-results-support">Message support</button>}</div>;
  return (<>
    {res.fallback && <div className="civr-card p-4 mb-4 text-sm text-[#a1a1aa]" data-testid="buy-area-fallback-note">Area code {res.fallback.areaCode} has no numbers right now — here are other numbers{res.fallback.region ? ` in ${res.fallback.region}` : ''} you can use instantly.</div>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4 gap-4" data-testid="buy-results">
      {res.numbers.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => onPick(n)} data-testid={`buy-result-${i}`} aria-pressed={isOn(n)} data-selected={isOn(n) ? 'true' : 'false'}
          className={`civr-card text-left p-4 ${isOn(n) ? 'civr-trace' : ''}`}>
          <div className="flex items-center justify-between"><span className="font-mono text-lg" data-testid={`buy-result-${i}-number`}>{n.assigned ? `${n.phoneNumber} …` : n.phoneNumber}</span>{isOn(n) && <Check className="w-4 h-4 text-[#818cf8]" />}</div>
          <div className="text-xs text-[#a1a1aa] mt-1 break-words">{place(n.region)}</div>
          {n.assigned && <div className="text-xs text-[var(--c-muted)] mt-1" data-testid={`buy-result-${i}-assigned`}>A number starting {n.phoneNumber} is assigned when you buy</div>}
          <div className="flex gap-2 mt-4">
            {n.capabilities.voice && <span className="civr-pill">Calls</span>}{n.capabilities.sms && planTexting && <span className="civr-pill" title="Texting is an optional add-on you can switch on in the number’s settings" data-testid={`buy-texts-optional-${i}`}>Texts optional</span>}
            {planId && (addonOf(n, planId) > 0 ? <span className="civr-pill civr-pill-warn" data-testid={`buy-result-${i}-addon`}>+{money(addonOf(n, planId))}/mo country charge</span> : <span className="civr-pill" data-testid={`buy-result-${i}-free`}>Free with plan</span>)}
          </div>
        </button>
      ))}
    </div>
  </>);
}

function PlanPicker({ plans, value, onChange, pick, businessOnly }) {
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="buy-plan-picker">
      {availablePlans(plans).map(p => { const locked = businessOnly && p.id !== 'business'; return (
        <button key={p.id} type="button" disabled={locked} onClick={() => onChange(p.id)} aria-pressed={value === p.id} data-testid={`buy-plan-${p.id}`} data-selected={value === p.id ? 'true' : 'false'} title={locked ? 'Numbers from this country come with the Business plan' : undefined}
          className={`civr-card text-left p-6 flex flex-col ${value === p.id ? 'civr-trace' : ''} ${locked ? 'opacity-45 cursor-not-allowed' : ''}`}>
          {locked && <span className="text-[11px] uppercase tracking-wider text-[#fbbf24] mb-2" data-testid={`buy-plan-${p.id}-locked`}>Business plan only for this country</span>}
          <div className="flex items-center justify-between gap-2 min-h-[28px]">
            <span className="font-display text-2xl font-bold">{p.name}</span>
            <span className="flex items-center gap-2">{p.recommended && <RecommendedBadge testid={`buy-plan-${p.id}-recommended`} />}{value === p.id && <Check className="w-5 h-5 text-[#818cf8]" />}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums mt-2">{money(p.price + addonOf(pick, p.id))}<span className="text-xs text-[#a1a1aa]"> /month</span></div>
          {pick && <div className="text-xs text-[var(--c-muted)] mt-1" data-testid={`buy-plan-${p.id}-breakdown`}>{addonOf(pick, p.id) > 0 ? `Plan ${money(p.price)} + country charge ${money(addonOf(pick, p.id))}` : 'Number included free with this plan'}</div>}
          <div className="mt-4"><PlanFeatures plan={p} plans={plans} compact testid={`buy-plan-${p.id}-feature`} /></div>
        </button>
      ); })}
    </div>
  );
}

// Extra numbers: how many are ticked and how many the plan still has room for.
function PickBar({ picks, slots, onClear }) {
  return (
    <div className="civr-card p-4 mb-4 text-sm flex flex-wrap items-center gap-3" data-testid="buy-extra-pick-bar">
      <Layers className="w-4 h-4 text-[#38bdf8] shrink-0" />
      <span className="flex-1 min-w-[12rem]" data-testid="buy-extra-pick-count">{picks.length ? `${picks.length} selected` : 'Tick one or more numbers'}{Number.isFinite(slots) ? ` · room for ${slots} on this plan` : ' · no limit on this plan'}</span>
      {picks.length > 0 && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onClear} data-testid="buy-extra-pick-clear">Clear</button>}
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

// Calls: find a number, then plan and pay. With extraOf, the number joins an existing plan instead.
export function CallsBuy({ extraOf, onStage }) {
  const { catalog, summary, refreshSummary } = useShell();
  const needsProfile = !useCivrAuth()?.account?.profileComplete;
  const [reqTick, setReqTick] = useState(0);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [saved] = useState(() => readResume(params));
  const [q, setQ] = useState(saved?.q || { country: (params.get('country') || 'US').toUpperCase(), type: params.get('type') || 'local', areaCode: '' });
  const [res, setRes] = useState(saved?.res || null);
  const [single, setPick] = useState(saved?.pick || null);
  const [picks, setPicks] = useState(saved?.picks || []);
  const [plan, setPlan] = useState(saved?.plan || params.get('plan') || USE_PLAN[rememberedUse()] || null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [coupon, setCoupon] = useState(saved?.coupon || null);
  const { data: extra } = useApi(extraOf ? `/numbers/${enc(extraOf)}/extra` : null);
  const { data: myNums } = useApi('/numbers');
  const pv = usePrivacy();
  const slots = extra ? (extra.unlimited ? Infinity : extra.left ?? Math.max(0, extra.limit - extra.used)) : 0;
  const pick = extraOf ? (picks.length ? { ...picks[0], phoneNumber: picks.length > 1 ? `${picks.length} numbers` : picks[0].phoneNumber } : null) : single;
  const { data: open } = useApi('/numbers/orders?open=1');
  // Start the search in the background as soon as the area code is typed, so pressing Search answers straight away.
  useEffect(() => {
    if (q.areaCode && q.areaCode.length !== 3) return undefined;
    const t = setTimeout(() => api(`/numbers/search/warm?country=${q.country}&type=${q.type}${q.areaCode ? `&areaCode=${q.areaCode}` : ''}`).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q.country, q.type, q.areaCode]);
  const [use] = useState(rememberedUse);
  const stage = single || picks.length || res?.request ? 3 : 2;
  useEffect(() => { onStage?.(stage); }, [stage, onStage]);
  useEffect(() => { refreshSummary(); }, [refreshSummary]);
  if (!catalog) return <Spinner />;
  const eligible = (myNums?.numbers || []).filter(n => n.status === 'active' && !n.isSubNumber && !n.replacedBy);
  const parent = extraOf ? (myNums?.numbers || []).find(n => n.phoneNumber === extraOf) : null;
  const avail = (id) => catalog.plans.find(p => p.id === id && p.available);
  const businessOnly = false;
  const planObj = businessOnly ? avail('business') : avail(plan) || avail(catalog.recommendedPlan) || catalog.plans.find(p => p.available);
  const total = extraOf ? Math.round(picks.reduce((t, p) => t + Math.max(0.5, (p.extraPrice ?? extra?.price ?? 0) * (extra?.prorate ?? 1)), 0) * 100) / 100 : planObj ? planObj.price + addonOf(pick, planObj.id) : 0;
  const pc = res?.paperwork?.compliance;
  const docsMissing = res?.paperwork?.level === 2 && (!res.paperwork.documents?.ready || (pc && (pc.identity?.status !== 'verified' || (pc.business && pc.company?.status !== 'approved'))));

  const search = async (e) => {
    e.preventDefault(); setBusy('search'); setError(null); setPick(null); setPicks([]);
    try { setRes(await api(`/numbers/search?country=${q.country}&type=${q.type}${q.areaCode ? `&areaCode=${q.areaCode}` : ''}`)); } catch (err) { setError(err); setRes(null); } finally { setBusy(''); }
  };
  const topUp = (shortBy) => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ q, res, pick: single, picks, plan: planObj?.id, coupon }));
    nav(cp(`/app/wallet?need=${shortBy}&for=${enc(extraOf ? picks[0].phoneNumber : pick.phoneNumber)}${extraOf ? `&extra=${enc(extraOf)}` : ''}`));
  };
  const isOn = (n) => (extraOf ? picks.some(p => p.phoneNumber === n.phoneNumber) : single?.phoneNumber === n.phoneNumber);
  const onPick = (n) => {
    if (!extraOf) { setPick(n); setTimeout(() => document.querySelector('[data-testid="buy-plan-picker"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); return; }
    if (isOn(n)) return setPicks(ps => ps.filter(p => p.phoneNumber !== n.phoneNumber));
    if (picks.length >= slots) return toast.error(`This plan has room for ${slots} more extra number${slots === 1 ? '' : 's'}. Untick one first, or upgrade the plan.`);
    setPicks(ps => [...ps, n]);
  };
  const buy = async ({ method, coin, autoRenew, texting, useWallet }) => {
    setBusy('buy'); setError(null);
    try {
      const d = extraOf
        ? method === 'crypto'
          ? await api(`/numbers/${enc(extraOf)}/extra-checkout`, { method: 'POST', body: { phoneNumbers: picks.map(p => p.phoneNumber), coin, coupon: coupon?.code, autoRenew, useWallet } })
          : await api(`/numbers/${enc(extraOf)}/extra`, { method: 'POST', body: { phoneNumbers: picks.map(p => p.phoneNumber), coupon: coupon?.code, autoRenew } })
        : await api('/numbers/checkout', { method: 'POST', body: { phoneNumber: pick.phoneNumber, plan: planObj.id, method, coin, autoRenew, coupon: coupon?.code, texting, useWallet } });
      sessionStorage.removeItem(RESUME_KEY);
      refreshSummary();
      const useNow = use && !extraOf && USE_PLAN[use] === planObj?.id ? use : null;
      if (!extraOf) saveIntent(useNow, d.number?.phoneNumber || null);
      if (d.texting) d.texting.error ? toast.error(d.texting.error) : toast.success('Texting Number ordered — we’ll tell you when it’s ready');
      if (d.order) { nav(cp(`/app/orders/${enc(d.order.id)}`)); return; }
      if (d.added) {
        toast.success(`${d.added.length} extra number${d.added.length === 1 ? '' : 's'} added`);
        if (d.failed?.length) toast.warning(d.message, { duration: 12000 });
        nav(cp(`/app/numbers/${enc(extraOf)}?tab=billing`)); return;
      }
      if (d.verification) { toast.success('Paid — one last step for this number'); nav(cp('/app/verification')); return; }
      if (d.pending) toast.success(`Paid — ${d.number.phoneNumber} is being set up. We’ll email you when it’s ready.`);
      else if (d.substitutedFrom) toast.info(`${d.substitutedFrom} was just taken, so you got ${d.number.phoneNumber} instead — same price.`);
      else toast.success(`${d.number.phoneNumber} is yours`);
      nav(cp(setupPath(useNow, d.number.phoneNumber)));
    } catch (err) { setError(err); toast.error(err.message); } finally { setBusy(''); }
  };

  return (
    <div data-testid="buy-line-section">
      {!extraOf && eligible.length > 0 && <ExistingPlanChooser nums={eligible} price={catalog.extraNumber?.price || 25} pv={pv} />}
      {open?.orders?.[0] && <OpenOrder order={open.orders[0]} />}
      <PendingRequests refresh={reqTick} />
      {saved?.pick && <div className="civr-card p-4 mb-4 text-sm flex items-center gap-2" data-testid="buy-resume-note"><Check className="w-4 h-4 text-[#818cf8]" />Welcome back — {saved.pick.phoneNumber} and the {planObj?.name} plan are still selected below.</div>}
      {!extraOf && <div className="mb-8">
        <Label>Choose your plan</Label>
        <p className="text-xs text-[#a1a1aa] -mt-1 mb-3" data-testid="buy-plan-help">Pick a plan first — then search for a number to go with it. Every plan includes everything in the one before it, and you can upgrade any time from the number’s Billing tab.</p>
        <PlanPicker plans={catalog.plans} value={planObj?.id} onChange={setPlan} pick={pick || res?.request} businessOnly={businessOnly} />
      </div>}
      <Label>{!extraOf && planObj ? `Pick a number for your ${planObj.name} plan` : 'Pick a number'}</Label>
      <SearchForm catalog={catalog} q={q} setQ={setQ} onSearch={search} busy={busy === 'search'} extra={!!extraOf} />
      <div className="mt-4"><ErrorNote error={error} testid="buy-error" /></div>
      {res?.request ? <div className="mt-8">
        <div className="mt-2">{needsProfile ? <BuyProfileGate /> : <RequestOrder request={res.request} plan={planObj} addon={addonOf(res.request, planObj?.id)} onDone={() => { setRes(null); setReqTick(t => t + 1); }} />}</div></div>
        : res && <div className="mt-6">
          <PaperworkNote paperwork={res.paperwork} country={q.country} countryName={catalog.countries.find(c => c.code === q.country)?.name || q.country} onChange={(documents) => setRes(r => ({ ...r, paperwork: { ...r.paperwork, documents } }))} />
          {extraOf && res.numbers.length > 0 && <PickBar picks={picks} slots={slots} onClear={() => setPicks([])} />}
          <Results res={res} isOn={isOn} onPick={onPick} planTexting={catalog.planTexting} planId={extraOf ? null : planObj?.id} /></div>}
      {pick && (
        <div className="mt-8 civr-rise">
          <Label>{extraOf ? 'Pay' : `Pay for ${pick.phoneNumber} · ${planObj?.name} plan`}</Label>
          {needsProfile ? <BuyProfileGate /> : docsMissing ? <div className="civr-card p-5 text-sm text-[#fbbf24]" data-testid="buy-documents-required">Finish the steps above (documents, ID check{pc?.business ? ', company papers' : ''}) to buy this number.</div> : <Checkout key={`${extraOf ? picks.length : pick.phoneNumber}-${summary ? 1 : 0}`} pick={pick} planObj={planObj} total={total} balance={summary?.balance} coins={catalog.coins || []} busy={busy === 'buy'} onPay={buy} onTopUp={topUp}
            textingOffer={null} coupon={coupon} setCoupon={setCoupon} initialCode={params.get('coupon') || ''} cryptoMin={extraOf ? catalog.minTopup : 0} label={extraOf ? `${picks.length > 1 ? `${picks.map(p => p.phoneNumber).join(', ')} · extra numbers` : 'Extra number'} on ${pv.phone(extraOf)}${extra?.renewsOn && extra.prorate < 1 ? ` · today covers the days until ${new Date(extra.renewsOn).toLocaleDateString()}, then renews with the plan` : ' · monthly'}` : null} autoRenewDefault={extraOf ? (parent ? parent.autoRenew !== false : true) : true} />}
        </div>
      )}
    </div>
  );
}
