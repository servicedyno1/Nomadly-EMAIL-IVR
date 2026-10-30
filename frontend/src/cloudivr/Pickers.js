import React from 'react';
import 'flag-icons/css/flag-icons.min.css';
import btc from 'cryptocurrency-icons/svg/color/btc.svg';
import ltc from 'cryptocurrency-icons/svg/color/ltc.svg';
import eth from 'cryptocurrency-icons/svg/color/eth.svg';
import usdt from 'cryptocurrency-icons/svg/color/usdt.svg';
import doge from 'cryptocurrency-icons/svg/color/doge.svg';
import bch from 'cryptocurrency-icons/svg/color/bch.svg';
import trx from 'cryptocurrency-icons/svg/color/trx.svg';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from './api';

// Real flag images (emoji flags show as two letters on Windows).
export const Flag = ({ code, className = '' }) => (code
  ? <span aria-hidden="true" className={`fi fi-${String(code).toLowerCase()} shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,.12)] ${className}`} />
  : null);

const COIN = { BTC: btc, LTC: ltc, ETH: eth, USDT: usdt, DOGE: doge, BCH: bch, TRON: trx, TRX: trx };
const NET = { TRC20: trx, ERC20: eth };
const COIN_NAME = { BTC: 'Bitcoin', LTC: 'Litecoin', ETH: 'Ethereum', USDT: 'Tether', DOGE: 'Dogecoin', BCH: 'Bitcoin Cash', TRON: 'Tron', TRX: 'Tron' };
// "USDT (TRC20)" / "USDT-TRC20" -> ['USDT', 'TRC20']
const parseCoin = (c) => { const m = String(c || '').toUpperCase().match(/^([A-Z]+)[\s(-]*([A-Z0-9]+)?\)?$/); return m ? [m[1], m[2]] : [String(c || ''), null]; };

export function CoinIcon({ coin, size = 20 }) {
  const [base, net] = parseCoin(coin);
  if (!COIN[base]) return null;
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <img src={COIN[base]} alt="" width={size} height={size} />
      {NET[net] && <img src={NET[net]} alt="" className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-[var(--c-card,#141414)]" width={size * 0.55} height={size * 0.55} />}
    </span>
  );
}

export const coinName = (coin) => { const [base, net] = parseCoin(coin); return COIN_NAME[base] ? `${COIN_NAME[base]}${net ? ` · ${net}` : ''}` : ''; };

export function Coin({ coin, size = 20, className = '' }) {
  return <span className={`inline-flex items-center gap-2 ${className}`}><CoinIcon coin={coin} size={size} />{coin}</span>;
}

// A dropdown that can show icons (native <select> can't). options: [{ value, label, icon, hint }]
export function IconSelect({ value, onChange, options, testid, label, placeholder = 'Pick…' }) {
  const slug = (v) => String(v).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="civr-input !flex items-center justify-between gap-2 text-left [&>span]:min-w-0 [&>span]:truncate" aria-label={label} data-testid={testid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="civr !min-h-0 z-[100] max-h-[23rem] rounded-xl border !border-[var(--c-border)] !bg-[var(--c-card)] !text-[var(--c-text)] shadow-xl" data-testid={`${testid}-menu`}>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value} className="min-h-[40px] rounded-lg pr-8 cursor-pointer text-sm focus:!bg-[var(--c-accent-soft)] focus:!text-[var(--c-text)]" data-testid={`${testid}-option-${slug(o.value)}`}>
            <span className="flex items-center gap-2.5 min-w-0">{o.icon}<span className="truncate">{o.label}</span>{o.hint && <span className="text-xs text-[var(--c-muted)] shrink-0">{o.hint}</span>}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Coins per 1 USD from the server (display only); refreshed every minute while a coin picker is open on the page.
export function useCoinRates() {
  const [rates, setRates] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    const load = () => api('/wallet/rates').then(d => live && setRates(d.rates)).catch(() => {});
    load(); const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return rates;
}

const fmtCoin = (n) => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(3)).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
const TICKER = { TRON: 'TRX' };
export const approxCoin = (rates, coin, usd) => { const t = String(coin).replace(/\s*\(.*\)/, ''); return rates?.[coin] && usd > 0 ? `≈ ${fmtCoin(rates[coin] * usd)} ${TICKER[t] || t}` : ''; };

export function CoinSelect({ coins, value, onChange, testid, amountUsd }) {
  const rates = useCoinRates();
  const usd = Number(amountUsd) || 0;
  return (
    <div className="space-y-1.5">
      <IconSelect value={value} onChange={onChange} testid={testid} label="Coin"
        options={coins.map(c => ({ value: c, label: c, hint: approxCoin(rates, c, usd) || coinName(c).split(' · ')[0], icon: <CoinIcon coin={c} /> }))} />
      {approxCoin(rates, value, usd) && <div className="text-xs text-[var(--c-muted)] break-words" data-testid={`${testid}-approx`}>{`${approxCoin(rates, value, usd)} at today’s rate · exact amount shown with the address`}</div>}
    </div>
  );
}

const left = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`; };
// Crypto payment window (6 h). After it, the address may stop being watched by the payment provider; late payments are still credited.
export function PayWindow({ expiresAt, testid }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const end = new Date(expiresAt).getTime();
  if (now >= end) return <p role="status" className="text-sm text-[#fb7185]" data-testid={`${testid}-expired`}>This payment has expired. If you already sent it, it will still be credited when it arrives. Otherwise, start a new payment.</p>;
  return <p className="text-xs text-[var(--c-muted)]" data-testid={testid}>{`Pay within ${left(end - now)} · expires at ${new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</p>;
}
