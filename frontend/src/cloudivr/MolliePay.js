import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Loader2, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { api, useApi, money, ApiError, holdNextOrder, captureNextOrder, cancelCapture } from './api';
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
export function useMollieStatus(ref, onPaid, withHeld = false) {
  const [status, setStatus] = useState(ref ? 'open' : null);
  const [held, setHeld] = useState(false);
  const [order, setOrder] = useState(null);
  const fired = useRef(false);
  useEffect(() => {
    if (!ref) return undefined;
    let stop = false;
    const tick = async () => { try { const r = await api(`/wallet/mollie/${ref}`); if (!stop) { setHeld(!!r.held); setOrder(r.order || null); setStatus(r.status); } } catch (_) { /* keep polling */ } };
    tick(); const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [ref]);
  useEffect(() => { if (DONE.includes(status) && !fired.current) { fired.current = true; onPaid?.(held); } }, [status, onPaid, held]);
  return withHeld ? { status, held, order } : status;
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

// Every method the Mollie profile offers, across currencies (card first). Bank methods like iDEAL only exist in euros.
export const mollieMethods = (opts) => {
  const seen = new Map();
  (opts?.currencies || []).forEach(c => c.methods.forEach(m => { if (!seen.has(m.id)) seen.set(m.id, m); }));
  return [...seen.values()].sort((x, y) => (y.id === 'creditcard') - (x.id === 'creditcard'));
};
export const mollieMethodNames = (opts) => mollieMethods(opts).map(m => m.description).join(', ');

// The picker: method first, then a currency that method supports. Card pays inside the page; the rest go to Mollie's page.
export function MollieForm({ opts, amountUsd, sameTab, onStarted, onClose, getOrder, testid }) {
  const all = mollieMethods(opts);
  const [method, setMethod] = useState(all[0]?.id || '');
  const [cur, setCur] = useState(opts.currencies[0]?.currency);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [session, setSession] = useState(null);
  const [hosted, setHosted] = useState(false);
  const mth = all.some(m => m.id === method) ? method : all[0]?.id || '';
  const usable = opts.currencies.filter(x => x.methods.some(m => m.id === mth));
  const c = usable.find(x => x.currency === cur) || usable[0] || opts.currencies[0];
  const card = mth === 'creditcard', name = all.find(m => m.id === mth)?.description || 'Mollie';
  const back = `${window.location.origin}${cp('/app/wallet')}`;
  const go = async () => {
    setBusy(true); setErr(null);
    const tab = sameTab ? null : window.open('', '_blank');
    try {
      const order = await getOrder?.();
      const r = await api('/wallet/mollie/pay', { method: 'POST', body: { amountUsd, currency: c.currency, method: mth || null, returnUrl: back, ...(order ? { order } : {}) } });
      if (tab) { tab.location.href = r.checkoutUrl; onStarted?.(r); } else window.location.assign(r.checkoutUrl);
    } catch (e) { tab?.close(); setErr(e); } finally { setBusy(false); }
  };
  const payHere = async () => {
    setBusy(true); setErr(null);
    try {
      const order = await getOrder?.();
      const r = await api('/wallet/mollie/session', { method: 'POST', body: { amountUsd, currency: c.currency, returnUrl: back, ...(order ? { order } : {}) } });
      setSession(r); onStarted?.({ ...r, inApp: true });
    } catch (e) { setHosted(true); setErr(e); } finally { setBusy(false); }
  };
  if (session) return <div data-testid={testid}><p className="text-sm mb-3" data-testid={`${testid}-inapp-amount`}>{`Paying ${fmtCur(session.currency, session.amount)} · ${money(amountUsd)} goes to your wallet`}</p><MollieInApp session={session} testid={testid} /></div>;
  const inPage = card && !hosted;
  return (
    <div className="space-y-3" data-testid={testid}>
      {opts.mode === 'test' && <span className="civr-pill !text-xs" data-testid={`${testid}-test-badge`}>Test mode — no real money moves</span>}
      <div><span className="civr-label">Pay with</span><div className="mt-1"><Chips items={all.map(m => ({ key: m.id, ...m }))} value={mth} onChange={setMethod} testid={`${testid}-method`} render={(m) => <>{m.image && <img src={m.image} alt="" className="h-4 w-auto" />}{m.description}</>} /></div></div>
      {card && <p className="text-xs text-[var(--c-muted)]" data-testid={`${testid}-wallets-note`}>Apple Pay and Google Pay show at the next step on devices that support them.</p>}
      <label className="block max-w-xs"><span className="civr-label">Pay in</span><select className="civr-input font-mono mt-1" value={c.currency} onChange={(e) => setCur(e.target.value)} disabled={usable.length < 2} data-testid={`${testid}-currency`}>{usable.map(x => <option key={x.currency} value={x.currency}>{`${x.currency} · ${fmtCur(x.currency, x.amount)}`}</option>)}</select></label>
      <p className="text-xs text-[var(--c-muted)]" data-testid={`${testid}-note`}>{`You pay ${fmtCur(c.currency, c.amount)} · ${money(amountUsd)} goes to your wallet${c.currency !== 'USD' ? ' (today’s exchange rate)' : ''}.${!card && usable.length === 1 ? ` ${name} is paid in ${c.currency}.` : ''}`}</p>
      <ErrorNote error={err} testid={`${testid}-error`} />
      {inPage && <button type="button" onClick={payHere} disabled={busy} className="civr-btn civr-btn-primary" data-testid={`${testid}-pay-here`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}Pay here</button>}
      {!inPage && <button type="button" onClick={go} disabled={busy} className="civr-btn civr-btn-primary" data-testid={`${testid}-continue`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}{`Continue with ${name}`}</button>}
      {inPage && <button type="button" onClick={() => setHosted(true)} className="text-xs underline text-[var(--c-muted)] ml-3" data-testid={`${testid}-use-hosted`}>Use Mollie’s payment page instead</button>}
      {onClose && <button type="button" onClick={onClose} className="civr-btn civr-btn-ghost ml-2" data-testid={`${testid}-close`}>Cancel</button>}
    </div>
  );
}

export function MollieWaiting({ status, held, order, onRetry, testid, newTab = true }) {
  if (DONE.includes(status) && order?.state === 'done') return <p className="flex items-center gap-2 text-sm text-[#34d399]" data-testid={`${testid}-order-done`}><CheckCircle2 className="w-4 h-4" />Payment received — your order is complete.</p>;
  if (DONE.includes(status) && order?.state === 'failed') return <p className="flex items-center gap-2 text-sm text-[#fbbf24]" data-testid={`${testid}-order-failed`}><XCircle className="w-4 h-4" />{`Payment received, but the order could not be completed${order.message ? `: ${order.message}` : ''}. The money is in your wallet — please place the order again.`}</p>;
  if (DONE.includes(status) && order && !held && ['pending', 'running'].includes(order.state)) return <p className="flex items-center gap-2 text-sm text-[var(--c-muted)]" data-testid={`${testid}-order-running`}><Loader2 className="w-4 h-4 animate-spin" />Payment received — completing your order…</p>;
  if (DONE.includes(status) && held) return <div className="flex flex-wrap items-center gap-3 text-sm text-[#fbbf24]" data-testid={`${testid}-held`}><CheckCircle2 className="w-4 h-4" />Payment received — on hold for a one-time ID check. Your order is saved and completes automatically once your ID is approved.<Link to={cp('/app/wallet')} className="underline font-semibold" data-testid={`${testid}-verify-id`}>Verify my ID</Link></div>;
  if (DONE.includes(status)) return <p className="flex items-center gap-2 text-sm text-[#34d399]" data-testid={`${testid}-paid`}><CheckCircle2 className="w-4 h-4" />Payment received — added to your wallet.</p>;
  if (BAD.includes(status)) return <div className="flex flex-wrap items-center gap-3 text-sm text-[#fbbf24]" data-testid={`${testid}-failed`}><XCircle className="w-4 h-4" />{status === 'error' ? 'The payment could not be started. Nothing was charged.' : `Payment ${status}. Nothing was charged.`}<button type="button" onClick={onRetry} className="underline font-semibold" data-testid={`${testid}-retry`}>Try again</button></div>;
  return <p className="flex items-center gap-2 text-sm text-[var(--c-muted)]" data-testid={`${testid}-waiting`}><Loader2 className="w-4 h-4 animate-spin" />{newTab ? 'Finish the payment in the new tab — this continues by itself.' : 'Checking your payment with Mollie…'}</p>;
}

// Inline "Pay with card / bank" for any wallet-priced item: the wallet balance pays its part, Mollie tops up the rest,
// then onReady() pays from the wallet. If the card payment is held for the ID check, the order is saved and runs on approval.
export function MolliePay({ price, onReady, testid = 'mollie-pay', primary = false, startOpen = false }) {
  const { data: w } = useApi('/wallet');
  const balance = w?.balance || 0, min = w?.minTopup || 10;
  const amount = Math.max(min, Math.ceil(Math.max(0, price - balance)) || Math.ceil(price));
  const part = Math.max(0, Math.round((price - amount) * 100) / 100);
  const opts = useMollie(w ? amount : 0);
  const [open, setOpen] = useState(startOpen);
  const [ref, setRef] = useState(null);
  const [inApp, setInApp] = useState(false);
  // The checkout's order request, caught before payment and sent with it (runs on the server once paid).
  const order = useRef(null);
  const getOrder = useCallback(async () => {
    if (order.current) return order.current.send;
    if (!onReady) return null;
    const got = captureNextOrder();
    onReady();
    const o = await Promise.race([got, new Promise(ok => setTimeout(() => ok(null), 1500))]);
    if (!o) { cancelCapture(); return null; }
    order.current = { settle: o.settle, send: { method: o.method, path: o.path, body: o.body, walletUsd: part } };
    return order.current.send;
  }, [onReady, part]);
  const paid = useCallback((held) => { if (order.current) return; if (held) holdNextOrder(ref, part); onReady?.(); }, [ref, part, onReady]);
  const { status, held, order: result } = useMollieStatus(ref, paid, true);
  useEffect(() => {
    const o = order.current;
    if (!o || !ref) return;
    const end = (fn) => { order.current = null; fn(); };
    if (['canceled', 'expired', 'failed'].includes(status)) end(() => o.settle.rej(new ApiError(402, { error: 'payment_not_completed', message: 'The payment was not completed. Nothing was bought.' })));
    else if (result?.state === 'done') end(() => o.settle.res(result.data || {}));
    else if (result?.state === 'failed') end(() => o.settle.rej(new ApiError(result.status || 500, { ...(result.data || {}), message: result.message || 'Your payment arrived, but the order could not be completed. The money is in your wallet — please try again.' })));
    else if (result?.state === 'queued') end(() => o.settle.rej(new ApiError(202, { error: 'queued', message: 'Payment received. Your order is saved and goes through automatically as soon as your ID check is approved.' })));
  }, [status, result, ref]);
  if (!opts?.enabled || !opts.currencies.length) return null;
  const done = (retry) => <div className="civr-card p-4" data-testid={testid}><MollieWaiting status={status} held={held} order={result} onRetry={retry} testid={testid} /></div>;
  if (ref && !inApp) return done(() => setRef(null));
  if (ref && ['paid', 'canceled', 'expired', 'failed'].includes(status)) return done(() => { setRef(null); setInApp(false); });
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={`civr-btn ${primary ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`${testid}-open`}><CreditCard className="w-4 h-4" />{part > 0 ? `Use ${money(part)} wallet + pay ${money(amount)} by card or bank` : 'Pay by card or bank'}</button>;
  return (
    <div className="civr-card p-4 w-full" data-testid={testid}>
      {part > 0 && <p className="text-sm mb-3" data-testid={`${testid}-split-note`}>{`${money(part)} from your wallet + ${money(amount)} by card or bank.`}</p>}
      {part === 0 && balance > 0 && amount > price - balance + 0.009 && <p className="text-xs text-[var(--c-muted)] mb-3" data-testid={`${testid}-min-note`}>{`Card payments start at ${money(min)} — anything left over stays in your wallet.`}</p>}
      <MollieForm opts={opts} amountUsd={amount} getOrder={getOrder} onStarted={(r) => { setInApp(!!r.inApp); setRef(r.ref); }} onClose={startOpen ? null : () => setOpen(false)} testid={`${testid}-form`} />
    </div>
  );
}
