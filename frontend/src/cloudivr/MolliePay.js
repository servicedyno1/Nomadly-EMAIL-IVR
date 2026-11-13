import React, { useEffect, useRef, useState } from 'react';
import { CreditCard, Loader2, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { api, useApi, money } from './api';
import { cp } from './paths';
import { ErrorNote } from './ui';

const SYMBOL = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', CHF: 'CHF ', SEK: 'SEK ', NOK: 'NOK ', DKK: 'DKK ', PLN: 'PLN ', CZK: 'CZK ' };
export const fmtCur = (cur, v) => `${SYMBOL[cur] || `${cur} `}${v}`;
const DONE = ['paid'], BAD = ['canceled', 'expired', 'failed', 'error'];

// Card / PayPal / iDEAL … options Mollie has on for this amount (null while loading, [] when Mollie is off).
export function useMollie(amountUsd) {
  const { data } = useApi(amountUsd >= 1 ? `/wallet/mollie/options?amountUsd=${amountUsd}` : null);
  return data ? (data.enabled ? data : { enabled: false, currencies: [] }) : null;
}

// Polls a Mollie payment until it is paid / failed; the backend re-checks it with Mollie on every call.
export function useMollieStatus(ref, onPaid) {
  const [status, setStatus] = useState(ref ? 'open' : null);
  const fired = useRef(false);
  useEffect(() => {
    if (!ref) return undefined;
    let stop = false;
    const tick = async () => { try { const r = await api(`/wallet/mollie/${ref}`); if (!stop) setStatus(r.status); } catch (_) { /* keep polling */ } };
    tick(); const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [ref]);
  useEffect(() => { if (DONE.includes(status) && !fired.current) { fired.current = true; onPaid?.(); } }, [status, onPaid]);
  return status;
}

// Mollie.js v2 (Checkout Sessions components), loaded once.
let mollieJs = null;
const loadMollieJs = () => (mollieJs = mollieJs || new Promise((ok, no) => {
  if (window.Mollie?.Checkout) return ok(window.Mollie);
  const el = document.createElement('script');
  el.src = 'https://js.mollie.com/v2/mollie.js'; el.async = true;
  el.onload = () => (window.Mollie?.Checkout ? ok(window.Mollie) : no(new Error('Card form did not load.')));
  el.onerror = () => { mollieJs = null; no(new Error('Card form did not load. Check your connection and try again.')); };
  document.body.appendChild(el);
}));

// In-app checkout: Apple Pay / Google Pay / PayPal buttons, then card (with in-page bank check) and other methods.
function MollieInApp({ session, testid }) {
  const express = useRef(null), methods = useRef(null);
  const [err, setErr] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let parts = [];
    loadMollieJs().then((M) => {
      const checkout = M.Checkout(session.clientAccessToken, { locale: 'en-US' });
      const ex = checkout.create('express-component'), mt = checkout.create('methods-component');
      if (express.current) ex.mount(express.current);
      if (methods.current) mt.mount(methods.current);
      parts = [ex, mt]; setReady(true);
    }).catch(setErr);
    return () => parts.forEach(c => { try { c.unmount?.(); } catch (_) { /* already gone */ } });
  }, [session.clientAccessToken]);
  return (
    <div className="space-y-3" data-testid={`${testid}-inapp`}>
      {!ready && !err && <p className="flex items-center gap-2 text-sm text-[var(--c-muted)]" data-testid={`${testid}-inapp-loading`}><Loader2 className="w-4 h-4 animate-spin" />Loading secure card form…</p>}
      <div ref={express} data-testid={`${testid}-inapp-express`} />
      <div ref={methods} className="rounded-xl bg-white p-3" data-testid={`${testid}-inapp-methods`} />
      <ErrorNote error={err} testid={`${testid}-inapp-error`} />
      <p className="text-xs text-[var(--c-muted)]">Card details go straight to Mollie and never touch our servers.</p>
    </div>
  );
}

function Chips({ items, value, onChange, testid, render }) {
  return <div className="flex flex-wrap gap-2" data-testid={testid}>{items.map(x => <button type="button" key={x.key} onClick={() => onChange(x.key)} className={`civr-pill civr-preset cursor-pointer inline-flex items-center gap-1.5 ${value === x.key ? 'civr-pill-on' : ''}`} data-testid={`${testid}-${String(x.key).toLowerCase()}`}>{render(x)}</button>)}</div>;
}

// The picker: currency (with the converted price) + method, then "Continue to secure checkout".
export function MollieForm({ opts, amountUsd, sameTab, onStarted, onClose, testid }) {
  const [cur, setCur] = useState(opts.currencies[0]?.currency);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [session, setSession] = useState(null);
  const [hosted, setHosted] = useState(false);
  const c = opts.currencies.find(x => x.currency === cur) || opts.currencies[0];
  const mth = c.methods.some(m => m.id === method) ? method : '';
  const go = async () => {
    setBusy(true); setErr(null);
    const tab = sameTab ? null : window.open('', '_blank');
    try {
      const r = await api('/wallet/mollie/pay', { method: 'POST', body: { amountUsd, currency: c.currency, method: mth || null, returnUrl: `${window.location.origin}${cp('/app/wallet')}` } });
      if (tab) { tab.location.href = r.checkoutUrl; onStarted?.(r); } else window.location.assign(r.checkoutUrl);
    } catch (e) { tab?.close(); setErr(e); } finally { setBusy(false); }
  };
  const payHere = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/wallet/mollie/session', { method: 'POST', body: { amountUsd, currency: c.currency, returnUrl: `${window.location.origin}${cp('/app/wallet')}` } });
      setSession(r); onStarted?.({ ...r, inApp: true });
    } catch (e) { setHosted(true); setErr(e); } finally { setBusy(false); }
  };
  if (session) return <div data-testid={testid}><p className="text-sm mb-3" data-testid={`${testid}-inapp-amount`}>{`Paying ${fmtCur(session.currency, session.amount)} · ${money(amountUsd)} goes to your wallet`}</p><MollieInApp session={session} testid={testid} /></div>;
  return (
    <div className="space-y-3" data-testid={testid}>
      {opts.mode === 'test' && <span className="civr-pill !text-xs" data-testid={`${testid}-test-badge`}>Test mode — no real money moves</span>}
      <label className="block max-w-xs"><span className="civr-label">Pay in</span><select className="civr-input font-mono mt-1" value={c.currency} onChange={(e) => setCur(e.target.value)} data-testid={`${testid}-currency`}>{opts.currencies.map(x => <option key={x.currency} value={x.currency}>{`${x.currency} · ${fmtCur(x.currency, x.amount)}`}</option>)}</select></label>
      {hosted && <Chips items={[{ key: '', description: 'Any method' }, ...c.methods.map(m => ({ key: m.id, ...m }))]} value={mth} onChange={setMethod} testid={`${testid}-method`} render={(m) => <>{m.image && <img src={m.image} alt="" className="h-4 w-auto" />}{m.description}</>} />}
      <p className="text-xs text-[var(--c-muted)]" data-testid={`${testid}-note`}>{`You pay ${fmtCur(c.currency, c.amount)} · ${money(amountUsd)} goes to your wallet${c.currency !== 'USD' ? ' (today’s exchange rate)' : ''}.`}</p>
      <ErrorNote error={err} testid={`${testid}-error`} />
      {!hosted && <button type="button" onClick={payHere} disabled={busy} className="civr-btn civr-btn-primary" data-testid={`${testid}-pay-here`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}Pay here</button>}
      {hosted && <button type="button" onClick={go} disabled={busy} className="civr-btn civr-btn-primary" data-testid={`${testid}-continue`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}Continue to secure checkout</button>}
      {!hosted && <button type="button" onClick={() => setHosted(true)} className="text-xs underline text-[var(--c-muted)] ml-3" data-testid={`${testid}-use-hosted`}>Use Mollie’s payment page instead</button>}
      {onClose && <button type="button" onClick={onClose} className="civr-btn civr-btn-ghost ml-2" data-testid={`${testid}-close`}>Cancel</button>}
    </div>
  );
}

export function MollieWaiting({ status, onRetry, testid, newTab = true }) {
  if (DONE.includes(status)) return <p className="flex items-center gap-2 text-sm text-[#34d399]" data-testid={`${testid}-paid`}><CheckCircle2 className="w-4 h-4" />Payment received — added to your wallet.</p>;
  if (BAD.includes(status)) return <div className="flex flex-wrap items-center gap-3 text-sm text-[#fbbf24]" data-testid={`${testid}-failed`}><XCircle className="w-4 h-4" />{status === 'error' ? 'The payment could not be started. Nothing was charged.' : `Payment ${status}. Nothing was charged.`}<button type="button" onClick={onRetry} className="underline font-semibold" data-testid={`${testid}-retry`}>Try again</button></div>;
  return <p className="flex items-center gap-2 text-sm text-[var(--c-muted)]" data-testid={`${testid}-waiting`}><Loader2 className="w-4 h-4 animate-spin" />{newTab ? 'Finish the payment in the new tab — this continues by itself.' : 'Checking your payment with Mollie…'}</p>;
}

// Inline "Pay with card / PayPal" for any wallet-priced item: tops up what's missing, then runs onReady().
export function MolliePay({ price, onReady, testid = 'mollie-pay', primary = false, startOpen = false }) {
  const { data: w } = useApi('/wallet');
  const balance = w?.balance || 0, min = w?.minTopup || 10;
  const amount = Math.max(min, Math.ceil(Math.max(0, price - balance)) || Math.ceil(price));
  const opts = useMollie(w ? amount : 0);
  const [open, setOpen] = useState(startOpen);
  const [ref, setRef] = useState(null);
  const [inApp, setInApp] = useState(false);
  const status = useMollieStatus(ref, onReady);
  if (!opts?.enabled || !opts.currencies.length) return null;
  if (ref && !inApp) return <div className="civr-card p-4" data-testid={testid}><MollieWaiting status={status} onRetry={() => setRef(null)} testid={testid} /></div>;
  if (ref && ['paid', 'canceled', 'expired', 'failed'].includes(status)) return <div className="civr-card p-4" data-testid={testid}><MollieWaiting status={status} onRetry={() => { setRef(null); setInApp(false); }} testid={testid} /></div>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={`civr-btn ${primary ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`${testid}-open`}><CreditCard className="w-4 h-4" />{balance > 0 && balance < price ? `Pay the ${money(amount)} rest by card / PayPal` : 'Pay by card / PayPal'}</button>;
  return <div className="civr-card p-4 w-full" data-testid={testid}><MollieForm opts={opts} amountUsd={amount} onStarted={(r) => { setInApp(!!r.inApp); setRef(r.ref); }} onClose={startOpen ? null : () => setOpen(false)} testid={`${testid}-form`} /></div>;
}
