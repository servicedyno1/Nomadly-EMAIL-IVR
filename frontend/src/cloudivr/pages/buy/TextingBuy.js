import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { cp } from '../../paths';
import { Flag } from '../../Pickers';
import { Spinner, ErrorNote, Label } from '../../ui';
import { WalletPay } from '../../WalletPay';
import { useShell } from '../../Shell';
import { CapBadges } from '../../kinds';
import { TextingSuggest } from './TextingSuggest';

function CountryCard({ code, name, line, caps, on, disabled, soon, onPick }) {
  return (
    <button type="button" disabled={disabled} onClick={onPick} aria-pressed={on} data-testid={`texting-buy-country-${code}`}
      className={`civr-card p-4 text-left transition-[border-color,transform] duration-200 ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:-translate-y-0.5'} ${on ? '!border-[var(--c-accent)]' : ''}`}>
      <div className="flex items-center gap-2 font-semibold"><Flag code={code} className="!w-6 !h-[18px]" />{name}{soon && <span className="civr-pill ml-auto">Soon</span>}{on && <Check className="w-4 h-4 ml-auto text-[var(--c-accent)]" />}</div>
      <CapBadges caps={caps} className="mt-2" />
      <div className="text-xs text-[var(--c-muted)] mt-2" data-testid={`texting-buy-country-${code}-price`}>{line}</div>
    </button>
  );
}

function Results({ list, pick, setPick, onRetry, typeName }) {
  if (!list.length) return <div className="civr-card p-5 text-sm flex flex-wrap items-center gap-3" data-testid="texting-buy-no-results"><span className="flex-1 min-w-[200px] text-[var(--c-muted)]">No numbers free in this country right now. Search again in a few minutes, or pick another country.</span><button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onRetry} data-testid="texting-buy-retry">Search again</button></div>;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="texting-buy-results">
      {list.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} aria-pressed={pick?.phoneNumber === n.phoneNumber} data-testid={`texting-buy-result-${i}`}
          className={`civr-card p-4 text-left ${pick?.phoneNumber === n.phoneNumber ? '!border-[var(--c-accent)]' : ''}`}>
          <div className="font-mono text-lg">{n.assigned ? `${n.phoneNumber} …` : n.phoneNumber}</div>
          <div className="text-xs text-[var(--c-muted)] mt-0.5">{n.assigned ? `A number starting ${n.phoneNumber} is assigned when you buy` : `${typeName || 'Mobile'}${n.region ? ` · ${n.region}` : ''}`}</div>
          <CapBadges caps={[...(n.capabilities?.voice ? ['calls'] : []), 'texts']} className="mt-2" />
        </button>
      ))}
    </div>
  );
}

// Calls + texting: a two-way number in the USA (texting after 10DLC registration) or another texting country.
export function TextingBuy({ onStage }) {
  const { data } = useApi('/texting/ready');
  const { refreshSummary } = useShell();
  const nav = useNavigate();
  const [country, setCountry] = useState(null);
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const stage = pick ? 3 : 2;
  useEffect(() => { onStage?.(stage); }, [stage, onStage]);
  if (!data) return <Spinner />;
  const choose = async (it) => {
    setCountry(it); setPick(null); setRes(null); setErr(null); setBusy('search');
    try { const d = await api(`/numbers/search?country=${it.country}&type=${it.type}&texting=1`); setRes((d.numbers || []).filter(n => n.capabilities?.sms)); } catch (e) { setErr(e); } finally { setBusy(''); }
  };
  const buy = async () => {
    setBusy('buy'); setErr(null);
    try {
      const d = await api('/numbers/checkout', { method: 'POST', body: { phoneNumber: pick.phoneNumber, plan: data.plan, method: 'wallet', autoRenew: true, withTexting: true } });
      refreshSummary();
      if (d.order) return nav(cp(`/app/orders/${encodeURIComponent(d.order.id)}`));
      toast.success(`${d.number?.phoneNumber || pick.phoneNumber} is yours`);
      nav(cp(`/app/numbers/${encodeURIComponent(d.number?.phoneNumber || pick.phoneNumber)}`));
    } catch (e) { setErr(e); toast.error(e.message); } finally { setBusy(''); }
  };
  const intl = country;
  // Same rule as calling numbers: free with the plan in its countries, otherwise plan + country charge.
  const addon = pick?.planAddons?.[data.plan] ?? 0, price = (data.price || 0) + addon;
  return (
    <div className="space-y-8" data-testid="texting-buy">
      {data.available && data.items.length > 1 && <TextingSuggest items={data.items} onPick={choose} />}
      <div>
        <Label>Pick a country</Label>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="texting-buy-countries">
          {data.items.map(it => <CountryCard key={it.country} code={it.country} name={it.name} caps={[...(it.caps.voice ? ['calls'] : []), 'texts']} on={intl?.country === it.country} disabled={!data.available} soon={!data.available} onPick={() => choose(it)}
            line={`${data.price ? `${money(data.price)}/month${it.included ? '' : ' + country charge'} · ` : ''}${money(it.textPrice)} per text sent · receiving free${it.needs10dlc ? ' · texting after USA registration' : ''}`} />)}
        </div>
      </div>
      <ErrorNote error={err} testid="texting-buy-error" />
      {intl && <div><Label>{`Pick your ${intl.name} number`}</Label>{busy === 'search' ? <Spinner label="Finding numbers…" testid="texting-buy-searching" /> : res && <Results list={res} pick={pick} setPick={setPick} onRetry={() => choose(intl)} typeName={intl.typeName} />}</div>}
      {intl && pick && (
        <div className="civr-card p-6 space-y-4 civr-rise" data-testid="texting-buy-checkout">
          <Label>Pay</Label>
          <div className="flex flex-wrap items-center gap-3"><div className="flex-1"><div className="font-mono text-xl" data-testid="texting-buy-picked">{pick.assigned ? `${pick.phoneNumber} … (assigned when you buy)` : pick.phoneNumber}</div><div className="text-sm text-[var(--c-muted)]">{`Calls + texting · ${money(intl.textPrice)} per text sent · receiving free · renews monthly`}</div><div className="text-xs text-[var(--c-muted)] mt-1" data-testid="texting-buy-breakdown">{addon > 0 ? `Plan ${money(data.price)} + country charge ${money(addon)}` : 'Number included free with the plan'}</div></div><div className="font-mono text-xl" data-testid="texting-buy-price">{money(price)}<span className="text-xs text-[var(--c-muted)]"> /month</span></div></div>
          {intl.needs10dlc && <p className="text-sm civr-card p-4" data-testid="texting-buy-10dlc">Calls work as soon as you pay. USA carriers need your business registered before texts can be sent: fill in <Link to={cp('/app/settings#settings-tendlc')} className="underline text-[var(--c-accent)]" data-testid="texting-buy-10dlc-link">USA texting registration</Link> ($49 once). Texting turns on when it’s approved.</p>}
          <WalletPay price={price} onWallet={buy} busy={busy === 'buy'} testid="texting-buy-pay" walletTestid="texting-buy-pay-button" />
        </div>
      )}
    </div>
  );
}
