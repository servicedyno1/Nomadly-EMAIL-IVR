import React, { useState } from 'react';
import { toast } from 'sonner';
import { Compass, AlertTriangle, PhoneIncoming, Loader2 } from 'lucide-react';
import { api, enc } from '../../api';
import { usePrivacy } from '../../privacy';

const SKIP = { ivr: 'Keypad menu', sip_ring: 'Softphone / SIP ring', voicemail: 'Voicemail' };

// Shown on the Keypad menu / AI voice agent tabs while the other one answers this number.
export const OneAnswerNote = ({ children, testid }) => <div className="text-sm text-[#fbbf24] flex gap-2" data-testid={testid}><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{children}</div>;

function headline(r, ph) {
  switch (r.primary) {
    case 'ai_agent': return 'Your AI voice agent answers every call. If your wallet runs low, calls follow your other settings.';
    case 'forward_always': return `All calls forward to ${ph(r.forwardTo)}.`;
    case 'forward_busy': return `Calls ring here first and forward to ${ph(r.forwardTo)} when busy.`;
    case 'forward_no_answer': return `Calls ring here first and forward to ${ph(r.forwardTo)} when not answered.`;
    case 'ivr': return 'Callers hear your keypad menu first.';
    case 'sip_ring': return 'Calls ring your softphone / browser phone.';
    case 'voicemail': return 'Callers go straight to voicemail.';
    default: return 'Nothing is set up — callers hear “this number is unavailable”.';
  }
}

// "What callers get now", the settings skipped because another answers first, and a one-tap fix.
export function RouteSummary({ num, reload }) {
  const pv = usePrivacy();
  const [busy, setBusy] = useState('');
  const r = num.routeSummary || { primary: 'missed', skipped: [] };
  const fwd = num.features.callForwarding;
  const setFwd = async (mode, label) => {
    setBusy(mode);
    try { await api(`/numbers/${enc(num.phoneNumber)}/forwarding`, { method: 'PATCH', body: { mode, forwardTo: fwd.forwardTo, ringTimeout: fwd.ringTimeout, holdMusic: fwd.holdMusic } }); toast.success(label); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="civr-card p-6 lg:col-span-2 space-y-4" data-testid="route-summary">
      <div className="flex items-center gap-2 font-display text-2xl font-bold"><Compass className="w-5 h-5 text-[#34d399]" />What callers get now</div>
      <p className="text-sm text-[#f4f4f5]" data-testid="route-summary-primary">{headline(r, pv.phone)}</p>
      {r.brokenIvr && <div className="text-sm text-[#fbbf24] flex gap-2" data-testid="route-summary-broken-ivr"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />Your keypad menu is on but has no keys yet — add options in the Keypad menu tab or turn it off.</div>}
      {r.skipped?.length > 0 && (
        <div className="space-y-3" data-testid="route-summary-skipped">
          <div className="flex flex-wrap gap-1.5">{r.skipped.map(s => <span key={s} className="civr-pill civr-pill-warn" data-testid={`route-summary-skipped-${s}`}>{SKIP[s] || s} · skipped</span>)}</div>
          <p className="text-xs text-[#a1a1aa]">These are switched on but never run, because forwarding answers every call first.</p>
          <div className="flex flex-wrap gap-2">
            <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={!!busy} onClick={() => setFwd('no_answer', 'Now forwarding only when not answered')} data-testid="route-summary-fix-no-answer">{busy === 'no_answer' && <Loader2 className="w-4 h-4 animate-spin" />}Forward only when not answered</button>
            <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={!!busy} onClick={() => setFwd('disabled', 'Forwarding off')} data-testid="route-summary-fix-off">{busy === 'disabled' && <Loader2 className="w-4 h-4 animate-spin" />}Turn forwarding off</button>
          </div>
        </div>
      )}
    </div>
  );
}

// We call the number from our test line; the result lands in the Inbox.
export function TestNumber({ num }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async () => {
    setBusy(true);
    try { const d = await api(`/numbers/${enc(num.phoneNumber)}/test-call`, { method: 'POST' }); setMsg(d.message); toast.success(d.dryRun ? 'Preview — no call placed' : 'Test call on its way'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-3" data-testid="test-number-card">
      <div className="flex items-center gap-2 font-display text-2xl font-bold"><PhoneIncoming className="w-5 h-5 text-[#38bdf8]" />Test my number</div>
      <p className="text-sm text-[#a1a1aa]">We call this number from our test line so you hear exactly what callers get. Up to 5 tests a day.</p>
      <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy || num.status !== 'active'} onClick={go} data-testid="test-number-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneIncoming className="w-4 h-4" />}Call my number</button>
      {msg && <div className="text-xs text-[#e4e4e7]" data-testid="test-number-result">{msg}</div>}
    </div>
  );
}
