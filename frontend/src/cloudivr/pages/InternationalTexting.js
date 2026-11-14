import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageSquare, Phone, PhoneOff, Search, Check, Globe } from 'lucide-react';
import { api, money, useApi } from '../api';
import { cp } from '../paths';
import { PageHeader, Spinner, ErrorNote, Label } from '../ui';
import { WalletPay } from '../WalletPay';
import { useShell } from '../Shell';

const Badge = ({ on, Icon, OffIcon, label, testid }) => (
  <span className={`civr-pill ${on ? 'civr-pill-ok' : ''} inline-flex items-center gap-1`} data-testid={testid}>{on ? <Icon className="w-3 h-3" /> : <OffIcon className="w-3 h-3" />}{on ? label : `No ${label.toLowerCase()}`}</span>
);

function CountryList({ items, value, onPick }) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="intl-texting-countries">
      {items.map(it => (
        <button key={it.country} type="button" onClick={() => onPick(it)} aria-pressed={value?.country === it.country} data-testid={`intl-texting-country-${it.country}`}
          className={`civr-card p-4 text-left transition-[border-color,transform] duration-200 hover:-translate-y-0.5 ${value?.country === it.country ? '!border-[var(--c-accent)]' : ''}`}>
          <div className="flex items-center gap-2 font-semibold"><span className="text-xl">{it.flag}</span>{it.name}<span className="text-xs text-[var(--c-muted)] font-normal">· Mobile</span>{value?.country === it.country && <Check className="w-4 h-4 ml-auto text-[var(--c-accent)]" />}</div>
          <div className="flex flex-wrap gap-1.5 mt-2"><Badge on Icon={MessageSquare} OffIcon={MessageSquare} label="SMS" testid={`intl-texting-country-${it.country}-sms`} /><Badge on={it.caps.voice} Icon={Phone} OffIcon={PhoneOff} label="Calls" testid={`intl-texting-country-${it.country}-voice`} /></div>
          <div className="text-xs text-[var(--c-muted)] mt-2" data-testid={`intl-texting-country-${it.country}-text-price`}>{`${money(it.textPrice)} per text sent · receiving is free`}</div>
        </button>
      ))}
    </div>
  );
}

function Results({ list, pick, setPick }) {
  if (!list.length) return <p className="text-sm text-[var(--c-muted)]" data-testid="intl-texting-no-results">No numbers free right now. Try again in a few minutes.</p>;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="intl-texting-results">
      {list.map(n => (
        <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} aria-pressed={pick?.phoneNumber === n.phoneNumber} data-testid={`intl-texting-result-${n.phoneNumber}`}
          className={`civr-card p-4 text-left ${pick?.phoneNumber === n.phoneNumber ? '!border-[var(--c-accent)]' : ''}`}>
          <div className="font-mono text-lg">{n.phoneNumber}</div>
          <div className="text-xs text-[var(--c-muted)] mt-0.5">Mobile{n.region ? ` · ${n.region}` : ''}</div>
          <div className="flex gap-1.5 mt-2"><Badge on={!!n.capabilities?.sms} Icon={MessageSquare} OffIcon={MessageSquare} label="SMS" testid={`intl-texting-result-${n.phoneNumber}-sms`} /><Badge on={!!n.capabilities?.voice} Icon={Phone} OffIcon={PhoneOff} label="Calls" testid={`intl-texting-result-${n.phoneNumber}-voice`} /></div>
        </button>
      ))}
    </div>
  );
}

export default function InternationalTexting() {
  const { data } = useApi('/texting/ready');
  const { refreshSummary } = useShell();
  const nav = useNavigate();
  const [country, setCountry] = useState(null);
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  if (!data) return <Spinner />;
  const choose = async (it) => {
    setCountry(it); setPick(null); setRes(null); setErr(null); setBusy('search');
    try { const d = await api(`/numbers/search?country=${it.country}&type=${it.type}&texting=1`); setRes((d.numbers || []).filter(n => n.capabilities?.sms)); } catch (e) { setErr(e); } finally { setBusy(''); }
  };
  const buy = async () => {
    setBusy('buy'); setErr(null);
    try {
      const d = await api('/numbers/checkout', { method: 'POST', body: { phoneNumber: pick.phoneNumber, plan: data.plan, method: 'wallet', autoRenew: true } });
      refreshSummary();
      if (d.order) return nav(cp(`/app/orders/${encodeURIComponent(d.order.id)}`));
      toast.success(`${d.number?.phoneNumber || pick.phoneNumber} is yours`);
      nav(cp(`/app/numbers/${encodeURIComponent(d.number?.phoneNumber || pick.phoneNumber)}`));
    } catch (e) { setErr(e); toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-8" data-testid="intl-texting-page">
      <PageHeader label="Phone numbers" title="International Texting" sub={`Two-way texting numbers in ${data.items.length} countries. No ID needed, live the day you buy. ${data.price ? `${money(data.price)}/month on the Basic plan.` : ''}`} testid="intl-texting-header" />
      <div><Label>1 · Pick a country</Label><CountryList items={data.items} value={country} onPick={choose} /></div>
      <p className="text-sm text-[var(--c-muted)] flex items-center gap-2" data-testid="intl-texting-usa-note"><Globe className="w-4 h-4" />Need a USA number? <Link to={cp('/app/texting-number')} className="underline" data-testid="intl-texting-usa-link">USA Texting Number</Link> — unlimited texts, assigned near your ZIP code.</p>
      <ErrorNote error={err} testid="intl-texting-error" />
      {country && <div><Label>{`2 · Pick your ${country.name} number`}</Label>{busy === 'search' ? <Spinner label="Finding numbers…" testid="intl-texting-searching" /> : res && <Results list={res} pick={pick} setPick={setPick} />}</div>}
      {pick && (
        <div className="civr-card p-6 space-y-4" data-testid="intl-texting-checkout">
          <div className="flex flex-wrap items-center gap-3"><div className="flex-1"><div className="font-mono text-xl" data-testid="intl-texting-picked">{pick.phoneNumber}</div><div className="text-sm text-[var(--c-muted)]">{`Basic plan · ${money(country.textPrice)} per text sent · receiving free`}</div></div><div className="font-mono text-xl" data-testid="intl-texting-price">{money(data.price)}<span className="text-xs text-[var(--c-muted)]"> /month</span></div></div>
          <WalletPay price={data.price} onWallet={buy} busy={busy === 'buy'} crypto={false} testid="intl-texting-pay" walletTestid="intl-texting-pay-button" />
        </div>
      )}
    </div>
  );
}
