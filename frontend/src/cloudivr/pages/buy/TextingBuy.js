import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { cp } from '../../paths';
import { Flag } from '../../Pickers';
import { Spinner, ErrorNote, Label } from '../../ui';
import { WalletPay } from '../../WalletPay';
import { useShell } from '../../Shell';
import { CapBadges } from '../../kinds';
import { MobileOffer } from './MobileOffer';

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

function Results({ list, pick, setPick }) {
  if (!list.length) return <p className="text-sm text-[var(--c-muted)]" data-testid="texting-buy-no-results">No numbers free right now. Try again in a few minutes.</p>;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="texting-buy-results">
      {list.map((n, i) => (
        <button key={n.phoneNumber} type="button" onClick={() => setPick(n)} aria-pressed={pick?.phoneNumber === n.phoneNumber} data-testid={`texting-buy-result-${i}`}
          className={`civr-card p-4 text-left ${pick?.phoneNumber === n.phoneNumber ? '!border-[var(--c-accent)]' : ''}`}>
          <div className="font-mono text-lg">{n.phoneNumber}</div>
          <div className="text-xs text-[var(--c-muted)] mt-0.5">Mobile{n.region ? ` · ${n.region}` : ''}</div>
          <CapBadges caps={[...(n.capabilities?.voice ? ['calls'] : []), 'texts']} className="mt-2" />
        </button>
      ))}
    </div>
  );
}

// Calls + texting: the USA number (unlimited texts, assigned near a ZIP) or a two-way number in another country.
export function TextingBuy({ onStage, startCountry }) {
  const { data } = useApi('/texting/ready');
  const { data: usa } = useApi('/mobile-numbers');
  const { refreshSummary } = useShell();
  const nav = useNavigate();
  const [country, setCountry] = useState(startCountry === 'US' ? 'US' : null);
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const stage = country === 'US' || pick ? 3 : 2;
  useEffect(() => { onStage?.(stage); }, [stage, onStage]);
  if (!data || !usa) return <Spinner />;
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
  const intl = country && country !== 'US' ? country : null;
  return (
    <div className="space-y-8" data-testid="texting-buy">
      <div>
        <Label>Pick a country</Label>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="texting-buy-countries">
          <CountryCard code="US" name="United States" caps={['calls', 'texts']} on={country === 'US'} disabled={!usa.available} onPick={() => { setCountry('US'); setPick(null); setRes(null); }}
            line={usa.available ? `${money(usa.price)}/month · unlimited texts · number assigned near your ZIP code` : 'Not available right now'} />
          {data.items.map(it => <CountryCard key={it.country} code={it.country} name={it.name} caps={[...(it.caps.voice ? ['calls'] : []), 'texts']} on={intl?.country === it.country} disabled={!data.available} soon={!data.available} onPick={() => choose(it)}
            line={`${data.price ? `${money(data.price)}/month · ` : ''}${money(it.textPrice)} per text sent · receiving is free`} />)}
        </div>
      </div>
      <ErrorNote error={err} testid="texting-buy-error" />
      {country === 'US' && <div data-testid="texting-buy-usa"><Label>ZIP code and payment</Label><MobileOffer open onBought={() => nav(cp('/app/numbers?show=texts'))} /></div>}
      {intl && <div><Label>{`Pick your ${intl.name} number`}</Label>{busy === 'search' ? <Spinner label="Finding numbers…" testid="texting-buy-searching" /> : res && <Results list={res} pick={pick} setPick={setPick} />}</div>}
      {intl && pick && (
        <div className="civr-card p-6 space-y-4 civr-rise" data-testid="texting-buy-checkout">
          <Label>Pay</Label>
          <div className="flex flex-wrap items-center gap-3"><div className="flex-1"><div className="font-mono text-xl" data-testid="texting-buy-picked">{pick.phoneNumber}</div><div className="text-sm text-[var(--c-muted)]">{`Calls + texting · ${money(intl.textPrice)} per text sent · receiving free · renews monthly`}</div></div><div className="font-mono text-xl" data-testid="texting-buy-price">{money(data.price)}<span className="text-xs text-[var(--c-muted)]"> /month</span></div></div>
          <WalletPay price={data.price} onWallet={buy} busy={busy === 'buy'} testid="texting-buy-pay" walletTestid="texting-buy-pay-button" />
        </div>
      )}
    </div>
  );
}
