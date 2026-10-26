import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, X, PhoneOff, KeyRound, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { usePrivacy } from '../../privacy';

const FINAL = ['accepted', 'declined', 'hung_up', 'timeout', 'ended'];
const LABEL = {
  calling: 'Calling…', playing: 'They answered · playing your message', waiting_code: 'Waiting for them to type the code', code: 'Code received · they are on hold',
  accepted: 'You accepted the code', declined: 'You declined · call ended', hung_up: 'You hung up', timeout: 'No answer from you in time · call ended', ended: 'Call ended',
};
const tone = (s) => (s === 'code' ? 'civr-pill-warn' : s === 'accepted' ? 'civr-pill-ok' : FINAL.includes(s) ? '' : 'civr-pill-on');

// Live state of a code-collection call, polled while it is going (404 → gone).
function useOtpCall(ccid) {
  const [st, setSt] = useState(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let stop = false, t;
    const tick = async () => {
      try { const d = await api(`/calls/otp/${encodeURIComponent(ccid)}`); if (stop) return; setSt(d); if (FINAL.includes(d.state)) return; } catch (e) { if (e.status === 404) { setGone(true); return; } }
      if (!stop) t = setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [ccid]);
  return { st, setSt, gone };
}

function useLeft(until) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!until) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [until]);
  if (!until) return null;
  const s = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Decide({ st, ccid, onState, t }) {
  const [busy, setBusy] = useState('');
  const left = useLeft(st.holdEndsAt);
  const triesLeft = st.maxAttempts - st.attempt;
  const act = async (action) => {
    setBusy(action);
    try { onState(await api(`/calls/otp/${encodeURIComponent(ccid)}`, { method: 'POST', body: { action } })); toast.success(action === 'accept' ? 'Code accepted' : action === 'decline' ? (triesLeft > 0 ? 'Declined — asking for the code again' : 'Declined — call ended') : 'Call ended'); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const spin = (a) => busy === a && <Loader2 className="w-4 h-4 animate-spin" />;
  return (
    <div className="space-y-3">
      <div className="text-xs text-[#a1a1aa]" data-testid={`${t}-attempt`}>{`Try ${st.attempt} of ${st.maxAttempts}`}{left && <> · <span className="font-mono text-[#fbbf24]">{left}</span> left to answer</>}</div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => act('accept')} className="civr-btn civr-btn-primary civr-btn-sm" data-testid={`${t}-accept`}>{spin('accept') || <Check className="w-4 h-4" />}{st.connectTo ? 'Accept & connect' : 'Accept code'}</button>
        <button type="button" disabled={!!busy} onClick={() => act('decline')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${t}-decline`}>{spin('decline') || <X className="w-4 h-4" />}{triesLeft > 0 ? `Decline · ask again (${triesLeft} left)` : 'Decline · end call'}</button>
        <button type="button" disabled={!!busy} onClick={() => act('hangup')} className="civr-btn civr-btn-ghost civr-btn-sm !text-[#fb7185]" data-testid={`${t}-hangup`}>{spin('hangup') || <PhoneOff className="w-4 h-4" />}Hang up</button>
      </div>
    </div>
  );
}

// Accept / Decline a collected code — on the Quick IVR page and in the Inbox (bot: Confirm / Reject / Hang up).
export function OtpLive({ ccid, testid = 'otp-live', compact = false }) {
  const { st, setSt, gone } = useOtpCall(ccid);
  const pv = usePrivacy();
  if (gone || (!st && compact)) return null;
  if (!st) return <div className="civr-card p-4 text-sm text-[#a1a1aa]" data-testid={testid}><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Connecting…</div>;
  const showCode = st.code && (st.state === 'code' || st.state === 'accepted');
  return (
    <div className={`${compact ? 'relative z-10 mt-3 rounded-xl border border-[#2a2a2a] p-3' : 'civr-card p-4'} space-y-3 ${st.state === 'code' ? '!border-[#fbbf24]/50' : ''}`} data-testid={testid} data-state={st.state}>
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="w-4 h-4 text-[#818cf8]" />
        <span className="font-mono text-sm" data-testid={`${testid}-to`}>{pv.phone(st.to)}</span>
        <span className={`civr-pill ${tone(st.state)}`} data-testid={`${testid}-state`}>{LABEL[st.state] || st.state}</span>
        {st.preview && <span className="civr-pill" data-testid={`${testid}-preview`}>Preview</span>}
      </div>
      {showCode && <div className="font-mono text-3xl tracking-[.3em]" data-testid={`${testid}-code`} data-no-translate>{pv.text(st.code, '••••••')}</div>}
      {st.state === 'waiting_code' && st.attempt > 1 && <div className="text-xs text-[#a1a1aa]">They are typing the code again.</div>}
      {st.state === 'code' && <Decide st={st} ccid={ccid} onState={setSt} t={testid} />}
      {st.state === 'accepted' && <div className="text-xs text-[#a1a1aa]" data-testid={`${testid}-after`}>{st.connectTo ? `They hear your confirmation, then we connect them to ${pv.phone(st.connectTo)}.` : 'They hear your confirmation and the call ends.'}</div>}
    </div>
  );
}

// Short "how it works" for the code mode (Quick IVR page and the free call).
export function OtpHowTo() {
  return <p className="text-sm text-[#a1a1aa]" data-testid="otp-how-to">They press a key, type the code and wait on hold. The code pops up right here and in your Inbox: <span className="text-[#f4f4f5]">Accept</span> to confirm (and connect them if you add a number below), <span className="text-[#f4f4f5]">Decline</span> to ask again, or hang up. You have 90 seconds to answer.</p>;
}
