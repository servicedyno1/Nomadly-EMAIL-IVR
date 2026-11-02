import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { X, Loader2, Smartphone, Check, Copy, AlertTriangle, ArrowRight } from 'lucide-react';
import { api, useApi } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { RenewPick } from '../esim/RenewPick';

// Landing-page eSIM checkout: details → account → pay (wallet, or crypto top-up then auto-order) → done.
export const openEsimCheckout = (planId) => window.dispatchEvent(new CustomEvent('civr-esim-checkout', { detail: planId || null }));
export const DRAFT_KEY = 'civr.esimDraft';
export const IN = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--np-blue)]';
export const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const saveDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (_) { /* private mode */ } };
const dropDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* private mode */ } };

export const Label = ({ text, hint, children }) => (
  <label className="block"><span className="block text-sm font-semibold text-slate-900 mb-1.5">{text}</span>{children}{hint && <span className="block text-xs text-slate-500 mt-1.5">{hint}</span>}</label>
);
export const Err = ({ e, testid }) => (e ? <p role="alert" className="text-sm text-rose-600" data-testid={testid}>{e.message || String(e)}</p> : null);
export const Btn = ({ busy, children, ...p }) => <button type="button" className="civr-l-btn w-full inline-flex items-center justify-center gap-2 min-h-[48px] disabled:opacity-50" disabled={busy || p.disabled} {...p}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{children}</button>;

function Details({ plans, d, set, onNext }) {
  const imeiOk = d.imei.replace(/\D/g, '').length === 15, zipOk = !d.zip || d.zip.length === 5, emailOk = EMAIL_OK.test(d.email.trim());
  return (
    <div className="space-y-5" data-testid="esim-co-details">
      {plans.length > 1 && <Label text="Plan"><select className={IN} value={d.planId} onChange={e => set({ planId: e.target.value })} data-testid="esim-co-plan-select">{plans.map(p => <option key={p.planId} value={p.planId}>{`${p.name} · $${p.price}`}</option>)}</select></Label>}
      <Label text="Your phone’s IMEI" hint="Dial *#06# on the phone that will use the eSIM. Use the first IMEI if it shows two."><input className={`${IN} font-mono`} inputMode="numeric" maxLength={17} value={d.imei} onChange={e => set({ imei: e.target.value })} placeholder="15 digits" data-testid="esim-co-imei" /></Label>
      <Label text="ZIP code for your number (optional)" hint="We’ll ask for a number near this USA ZIP code. The exact area code can’t be guaranteed."><input className={`${IN} font-mono max-w-[180px]`} inputMode="numeric" value={d.zip} onChange={e => set({ zip: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="e.g. 10011" data-testid="esim-co-zip" /></Label>
      <Label text="Email for your QR code" hint="We send the eSIM QR code here as soon as it’s ready. It’s also in the app."><input className={IN} type="email" autoComplete="email" value={d.email} onChange={e => set({ email: e.target.value })} placeholder="you@example.com" data-testid="esim-co-qr-email" /></Label>
      <RenewPick on={d.autoRenew !== false} onChange={(v) => set({ autoRenew: v })} price={plans.find(p => p.planId === d.planId)?.price} testid="esim-co-autorenew" className="border-slate-200" />
      <Btn onClick={onNext} disabled={!imeiOk || !zipOk || !emailOk} data-testid="esim-co-next">Continue<ArrowRight className="w-4 h-4" /></Btn>
    </div>
  );
}

export function Account({ onDone, onMfa, intro = 'Create your free CloudIVR account. Your eSIM and its QR code live here.' }) {
  const { setAccount } = useCivrAuth();
  const [mode, setMode] = useState('signup');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api(mode === 'signup' ? '/auth/register' : '/auth/login', { method: 'POST', body: f });
      if (r.twoFactor) { onMfa(); return; }
      setAccount(r.account); onDone(r.account);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go(); }} data-testid="esim-co-account">
      <p className="text-sm text-slate-600">{mode === 'signup' ? intro : 'Sign in to your CloudIVR account.'}</p>
      {mode === 'signup' && <Label text="Name (optional)"><input className={IN} value={f.name} onChange={set('name')} autoComplete="name" data-testid="esim-co-name" /></Label>}
      <Label text="Email"><input className={IN} type="email" required value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@company.com" data-testid="esim-co-email" /></Label>
      <Label text="Password" hint={mode === 'signup' ? 'At least 8 characters.' : null}><input className={IN} type="password" required minLength={mode === 'signup' ? 8 : 1} value={f.password} onChange={set('password')} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} data-testid="esim-co-password" /></Label>
      <Err e={err} testid="esim-co-account-error" />
      <button type="submit" className="civr-l-btn w-full inline-flex items-center justify-center gap-2 min-h-[48px] disabled:opacity-50" disabled={busy || !f.email || !f.password} data-testid="esim-co-account-submit">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{mode === 'signup' ? 'Create account and continue' : 'Sign in and continue'}</button>
      {mode === 'signup' && <p className="text-xs text-slate-500">By creating an account you agree to the <Link to={cp('/terms')} target="_blank" className="underline" data-testid="esim-co-terms">Terms of Service</Link>.</p>}
      <button type="button" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setErr(null); }} className="text-sm font-semibold text-slate-700 underline underline-offset-4 py-2" data-testid="esim-co-switch">{mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
    </form>
  );
}

function Deposit({ dep, what, later }) {
  const copy = () => navigator.clipboard?.writeText(dep.address);
  return (
    <div className="rounded-2xl border border-slate-200 p-4 space-y-3" data-testid="esim-co-deposit">
      {dep.dryRun && <p className="flex items-center gap-2 text-sm text-amber-700" data-testid="esim-co-deposit-preview"><AlertTriangle className="w-4 h-4" />Preview mode — this is not a real address. Do not send funds.</p>}
      <div className="flex gap-4 items-start">
        {!dep.dryRun && <div className="bg-white p-2 border border-slate-200 rounded-xl shrink-0"><QRCode value={dep.address} size={112} /></div>}
        <div className="min-w-0 space-y-2 text-sm">
          <div><span className="text-slate-500">Send exactly</span><div className="font-mono text-lg text-slate-900" data-testid="esim-co-deposit-amount">{dep.amountCrypto ? `${dep.amountCrypto} ${dep.coin}` : `$${dep.amountUsd} in ${dep.coin}`}</div></div>
          <div><span className="text-slate-500">To address</span><div className="flex items-center gap-2"><code className="break-all text-slate-900" data-testid="esim-co-deposit-address">{dep.address}</code>{!dep.dryRun && <button type="button" onClick={copy} className="w-10 h-10 shrink-0 grid place-items-center text-slate-500" aria-label="Copy address" data-testid="esim-co-deposit-copy"><Copy className="w-4 h-4" /></button>}</div></div>
        </div>
      </div>
      <p className="text-xs text-slate-500">Keep this window open. {`We check every 15 seconds and place your ${what} order as soon as the payment confirms.`}</p>
      <p className="text-xs text-slate-500" data-testid="esim-co-deposit-later">{later}</p>
    </div>
  );
}

function TopUp({ w, need, onDep }) {
  const [coin, setCoin] = useState(w.coins[0] || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const amount = Math.max(w.minTopup || 0, Math.ceil(need));
  const go = async () => { setBusy(true); setErr(null); try { onDep(await api('/wallet/topup', { method: 'POST', body: { amountUsd: amount, coin } })); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <div className="space-y-4" data-testid="esim-co-topup">
      <p className="text-sm text-slate-600" data-testid="esim-co-need">{w.balance >= need ? `Send $${amount} in crypto and we’ll place the order as soon as it confirms.` : `Your wallet has $${w.balance.toFixed(2)}. Add $${amount} with crypto and we’ll place the order automatically.`}</p>
      <Label text="Pay with"><select className={IN} value={coin} onChange={e => setCoin(e.target.value)} data-testid="esim-co-coin">{w.coins.map(c => <option key={c} value={c}>{c}</option>)}</select></Label>
      <Err e={err} testid="esim-co-topup-error" />
      <Btn busy={busy} onClick={go} data-testid="esim-co-topup-button">{`Get a $${amount} payment address`}</Btn>
    </div>
  );
}

const ESIM_LATER = 'Closed it after paying? The money stays in your wallet. Open CloudIVR eSIM and your details will be filled in to finish the order.';

// Wallet or crypto top-up, then place() runs automatically once the money lands.
export function Pay({ price, name, place, onPaid, what = 'eSIM', later = ESIM_LATER }) {
  const { data: w, error: wErr, reload } = useApi('/wallet');
  const [dep, setDep] = useState(null);
  const [crypto, setCrypto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const placing = useRef(false);
  const base = useRef(0);
  const order = useCallback(async () => {
    if (placing.current) return;
    placing.current = true; setBusy(true); setErr(null);
    try { await place(); onPaid(); } catch (e) { setErr(e); placing.current = false; } finally { setBusy(false); }
  }, [place, onPaid]);
  useEffect(() => { if (!dep) return undefined; const t = setInterval(reload, 15000); return () => clearInterval(t); }, [dep, reload]);
  const enough = w && w.balance >= price;
  const paidIn = !!(dep && w && w.balance > base.current && enough);
  useEffect(() => { if (paidIn) order(); }, [paidIn, order]);
  const startDep = (x) => { base.current = w.balance; setDep(x); };
  if (!w && wErr) return <div className="space-y-3" data-testid="esim-co-wallet-error"><Err e={wErr} /><Btn onClick={reload} data-testid="esim-co-wallet-retry">Try again</Btn></div>;
  if (!w) return <div className="py-8 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  return (
    <div className="space-y-4" data-testid="esim-co-pay">
      <div className="rounded-2xl bg-slate-50 p-4 flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">{name}</span><span className="font-mono font-semibold text-slate-900" data-testid="esim-co-total">{`$${price}`}</span></div>
      {dep ? <Deposit dep={dep} what={what} later={later} />
        : enough && !crypto ? <><Btn busy={busy} onClick={order} data-testid="esim-co-pay-wallet">{`Pay $${price} from wallet`}</Btn><button type="button" onClick={() => setCrypto(true)} className="w-full text-sm font-semibold text-slate-700 underline underline-offset-4 py-2" data-testid="esim-co-use-crypto">Pay with crypto instead</button></>
        : <TopUp w={w} need={enough ? price : price - w.balance} onDep={startDep} />}
      <Err e={err} testid="esim-co-pay-error" />
    </div>
  );
}

function Done({ onClose }) {
  return (
    <div className="text-center space-y-4 py-4" data-testid="esim-co-done">
      <span className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mx-auto"><Check className="w-7 h-7" /></span>
      <h3 className="civr-l-h text-2xl">Paid — your eSIM is on its way</h3>
      <p className="text-sm text-slate-600">It’s usually ready in minutes. Open CloudIVR eSIM to scan the QR code and install it on your phone.</p>
      <Link to={cp('/app/esim')} onClick={onClose} className="civr-l-btn w-full inline-flex items-center justify-center gap-2 min-h-[48px]" data-testid="esim-co-open">Open CloudIVR eSIM<ArrowRight className="w-4 h-4" /></Link>
    </div>
  );
}

const TITLES = { details: 'Your phone', account: 'Your account', pay: 'Pay', done: 'Done' };

function Checkout({ plans, first, onClose }) {
  const { account } = useCivrAuth();
  const nav = useNavigate();
  const [step, setStep] = useState('details');
  const [d, setD] = useState({ planId: first || plans[0].planId, imei: '', zip: '', email: account?.email || '', autoRenew: true });
  const set = (x) => setD(v => ({ ...v, ...x }));
  const plan = plans.find(p => p.planId === d.planId) || plans[0];
  const box = useRef(null);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); box.current?.querySelector('input,select')?.focus(); return () => window.removeEventListener('keydown', k); }, [onClose, step]);
  const next = () => { if (account) saveDraft({ ...d, account: account.id }); setStep(account ? 'pay' : 'account'); };
  const signedIn = (acc) => { saveDraft({ ...d, account: acc?.id || null }); setStep('pay'); };
  const paid = useCallback(() => { dropDraft(); setStep('done'); }, []);
  const place = useCallback(() => api('/esim', { method: 'POST', body: { planId: plan.planId, imei: d.imei, zipcode: d.zip, email: (d.email || '').trim(), autoRenew: d.autoRenew !== false } }), [plan.planId, d.imei, d.zip, d.email, d.autoRenew]);
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 grid place-items-center p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="esim-checkout">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="esim-co-title" className="bg-white text-slate-900 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 sm:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-slate-500"><Smartphone className="w-4 h-4" />{`CloudIVR eSIM · ${plan.name} · $${plan.price}`}</div><h2 id="esim-co-title" className="civr-l-h text-2xl mt-2" data-testid="esim-co-step">{TITLES[step]}</h2></div>
          <button type="button" onClick={onClose} className="w-11 h-11 grid place-items-center rounded-full hover:bg-slate-100 shrink-0" aria-label="Close" data-testid="esim-co-close"><X className="w-5 h-5" /></button>
        </div>
        {step === 'details' && <Details plans={plans} d={d} set={set} onNext={next} />}
        {step === 'account' && <Account onDone={signedIn} onMfa={() => { saveDraft({ ...d, account: null }); nav(cp('/login?plan=esim')); }} />}
        {step === 'pay' && <Pay price={plan.price} name={plan.name} place={place} onPaid={paid} />}
        {step === 'done' && <Done onClose={onClose} />}
      </div>
    </div>
  );
}

// Mounted once on the landing page; any "Buy eSIM" button opens it via openEsimCheckout().
export function EsimCheckoutHost() {
  const { data, error } = useApi('/public/esim-plans');
  const { account } = useCivrAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(undefined);
  const plans = data?.plans || [];
  const ready = plans.length > 0, failed = !!error || (data && !ready);
  useEffect(() => {
    const f = (e) => (failed ? nav(cp(account ? '/app/esim' : '/signup?plan=esim')) : setOpen(e.detail || null));
    window.addEventListener('civr-esim-checkout', f); return () => window.removeEventListener('civr-esim-checkout', f);
  }, [failed, account, nav]);
  if (open === undefined || !plans.length) return null;
  return <Checkout plans={plans} first={open} onClose={() => setOpen(undefined)} />;
}
