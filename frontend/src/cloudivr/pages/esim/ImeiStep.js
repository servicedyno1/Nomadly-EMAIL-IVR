import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api';

export const imeiOk = (v) => { const s = String(v).replace(/\D/g, ''); if (s.length !== 15) return false; let sum = 0; for (let i = 0; i < 15; i++) { let n = +s[14 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; };
const dueText = (at) => (at ? ` by ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ' within 7 days');

// Paid eSIM waiting for the phone's IMEI: the eSIM is created as soon as it is sent.
export function ImeiStep({ id, dueAt, onSent, light, autoFocus }) {
  const [imei, setImei] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const box = useRef(null);
  useEffect(() => { if (autoFocus) { box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); box.current?.querySelector('input')?.focus(); } }, [autoFocus]);
  const digits = imei.replace(/\D/g, '');
  const bad = digits.length === 15 && !imeiOk(digits);
  const send = async () => { setBusy(true); setErr(null); try { await api(`/esim/${id}/imei`, { method: 'POST', body: { imei: digits } }); toast.success('Got it. Creating your eSIM — usually ready in minutes'); onSent?.(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const input = light ? 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-[color:var(--np-blue)]' : 'civr-input font-mono';
  const muted = light ? 'text-slate-500' : 'text-[var(--c-muted,#a1a1aa)]';
  return (
    <div ref={box} className={`space-y-3 rounded-xl p-4 ${light ? 'border border-amber-300 bg-amber-50' : 'border border-[#fbbf24]/40 bg-[#fbbf24]/5'}`} data-testid={`esim-imei-step-${id}`}>
      <div className={`font-semibold ${light ? 'text-slate-900' : ''}`}>Last step: your phone’s IMEI</div>
      <p className={`text-sm ${muted}`}>Dial <span className="font-mono">*#06#</span> on the phone that will use the eSIM. Use the first IMEI if it shows two. {`Send it${dueText(dueAt)}, or the payment goes back to your wallet.`}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input className={input} inputMode="numeric" maxLength={17} value={imei} onChange={e => setImei(e.target.value)} placeholder="15 digits" aria-label="Your phone’s IMEI" data-testid={`esim-imei-input-${id}`} />
        <button type="button" onClick={send} disabled={busy || !imeiOk(digits)} className={`${light ? 'civr-l-btn min-h-[48px] px-5' : 'civr-btn civr-btn-primary'} inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-50`} data-testid={`esim-imei-submit-${id}`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Create my eSIM</button>
      </div>
      {bad && <p className="text-sm text-[#fb7185]" data-testid={`esim-imei-invalid-${id}`}>That isn’t a valid IMEI. Check the 15 digits again.</p>}
      {err && <p role="alert" className="text-sm text-[#fb7185]" data-testid={`esim-imei-error-${id}`}>{err.message || String(err)}</p>}
    </div>
  );
}
