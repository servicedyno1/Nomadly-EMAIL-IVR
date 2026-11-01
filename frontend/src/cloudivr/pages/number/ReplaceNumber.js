import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Repeat, Loader2, Search, Info } from 'lucide-react';
import { api, enc, day } from '../../api';
import { ask } from '../../confirm';
import { cp } from '../../paths';
import { ErrorNote } from '../../ui';
import { WalletPay } from '../../WalletPay';

const PRICE = 25;
const MOVES = ['Plan and renewal date', 'Keypad menu (IVR) and AI agent', 'Forwarding, hours and ring group', 'Voicemail and greeting', 'Caller ID and SIP login', 'Extra lines on this plan'];

function Replaced({ num }) {
  return (
    <div className="civr-card p-6 space-y-2" data-testid="replace-done-card">
      <div className="font-display text-2xl font-bold flex items-center gap-2"><Repeat className="w-5 h-5" />Replaced</div>
      <p className="text-sm">This number was replaced by <Link to={cp(`/app/numbers/${enc(num.replacedBy)}`)} className="font-mono underline" data-no-translate data-testid="replace-new-link">{num.replacedBy}</Link>.</p>
      <p className="text-sm text-[var(--c-muted)]" data-testid="replace-keeps-until">{`It keeps receiving calls and texts until ${day(num.releaseAt)}, then it’s released.`}</p>
    </div>
  );
}

function Results({ list, pick, setPick }) {
  if (!list) return null;
  if (!list.length) return <p className="text-sm text-[var(--c-muted)]" data-testid="replace-no-results">No numbers found. Try another area code.</p>;
  return (
    <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="New number" data-testid="replace-results">
      {list.map(n => (
        <button key={n.phoneNumber} type="button" role="radio" aria-checked={pick === n.phoneNumber} onClick={() => setPick(n.phoneNumber)} className={`text-left rounded-xl border px-3 py-2 transition-colors ${pick === n.phoneNumber ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)]' : 'border-[var(--c-border)] hover:border-[var(--c-border-hover)]'}`} data-testid={`replace-pick-${n.phoneNumber}`}>
          <span className="font-mono block" data-no-translate>{n.phoneNumber}</span>
          <span className="text-xs text-[var(--c-muted)]">{n.region || '—'}{n.capabilities?.sms ? ' · Texts' : ''}{n.capabilities?.mms ? ' · Pictures' : ''}</span>
        </button>
      ))}
    </div>
  );
}

export function ReplaceNumber({ num, refreshSummary }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const box = useRef(null);
  useEffect(() => { if (params.get('replace')) box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [params]);
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState('');
  const [list, setList] = useState(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  if (num.replacedBy) return <Replaced num={num} />;
  if (num.status !== 'active') return null;
  const local = ['US', 'CA'].includes(num.country) && num.type === 'local';
  const search = async () => { setBusy('search'); setErr(null); setPick(''); try { setList((await api(`/numbers/search?country=${num.country}&type=${num.type}${local && area.length === 3 ? `&areaCode=${area}` : ''}`)).numbers); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const go = async () => {
    setBusy('pay'); setErr(null);
    try {
      const d = await api(`/numbers/${enc(num.phoneNumber)}/replace`, { method: 'POST', body: { phoneNumber: pick } });
      toast.success(`New number ${d.number.phoneNumber} is live. ${num.phoneNumber} keeps working until ${day(d.releaseAt)}.`);
      refreshSummary(); navigate(cp(`/app/numbers/${enc(d.number.phoneNumber)}`));
    } catch (e) { setErr(e); } finally { setBusy(''); }
  };
  return (
    <div ref={box} className="civr-card p-6 space-y-4 scroll-mt-24" data-testid="replace-card">
      <div className="font-display text-2xl font-bold flex items-center gap-2"><Repeat className="w-5 h-5" />Replace number</div>
      {num.replaces && <p className="text-xs text-[var(--c-muted)]" data-testid="replace-was">{`Replaced ${num.replaces}.`}</p>}
      {!open ? <>
        <p className="text-sm text-[var(--c-muted)]">{`Get a different ${num.countryName || num.country} number for $${PRICE}. Everything moves over and the old number keeps working for 7 days.`}</p>
        <button type="button" onClick={() => { setOpen(true); search(); }} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="replace-open">Replace number</button>
      </> : <>
        {local && <div className="flex items-end gap-2">
          <label className="text-sm"><span className="block text-xs text-[var(--c-muted)] mb-1">Area code (optional)</span><input className="civr-input font-mono w-28" inputMode="numeric" maxLength={3} value={area} onChange={e => setArea(e.target.value.replace(/\D/g, ''))} placeholder="415" data-testid="replace-area-input" /></label>
          <button type="button" onClick={search} disabled={busy === 'search'} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="replace-search">{busy === 'search' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Search</button>
        </div>}
        {busy === 'search' && !list ? <Loader2 className="w-5 h-5 animate-spin" /> : <Results list={list} pick={pick} setPick={setPick} />}
        {pick && <div className="rounded-xl border border-[var(--c-border)] p-4 space-y-3 text-sm" data-testid="replace-summary">
          <div className="flex justify-between"><span>{num.phoneNumber} → <span className="font-mono" data-no-translate>{pick}</span></span><span className="font-semibold">${PRICE}</span></div>
          <div><div className="text-xs text-[var(--c-muted)] mb-1">Moves to the new number</div><ul className="grid sm:grid-cols-2 gap-x-4 list-disc pl-5">{MOVES.map(m => <li key={m}>{m}</li>)}</ul></div>
          <p className="flex gap-2 text-xs text-[var(--c-muted)]"><Info className="w-4 h-4 shrink-0" />{`${num.phoneNumber} keeps receiving calls and texts for 7 days (marked “Old number” in Messages), then it’s released. Your renewal date stays ${day(num.expiresAt)}.`}</p>
          <WalletPay price={PRICE} onWallet={async () => { if (await ask(`Replace ${num.phoneNumber} with ${pick} for $${PRICE} from your wallet?`, { ok: `Pay $${PRICE}`, title: 'Replace this number?' })) go(); }} onCrypto={go} busy={busy === 'pay'} disabled={!!busy && busy !== 'pay'} testid="replace-paybox" walletTestid="replace-pay" cryptoTestid="replace-crypto">
            <button type="button" onClick={() => { setOpen(false); setList(null); setPick(''); }} className="civr-btn civr-btn-ghost" data-testid="replace-cancel">Cancel</button>
          </WalletPay>
        </div>}
        <ErrorNote error={err} testid="replace-error" />
      </>}
    </div>
  );
}
