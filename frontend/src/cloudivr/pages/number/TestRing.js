import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PhoneIncoming, Loader2, Monitor, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, enc } from '../../api';
import { useRtc } from '../../rtc';

const POLL_MS = 3000;
const GIVE_UP_MS = 90000;
const TONE = { ok: 'text-[#34d399]', voicemail: 'text-[#fbbf24]', no_key: 'text-[#fbbf24]', no_answer: 'text-[#fb7185]' };

// Wait (≤8s) for the browser phone to register to this number so the SIP ring reaches this tab.
async function readyBrowser(rtc, phone) {
  if (rtc.phone === phone && rtc.status === 'ready') return true;
  await rtc.connect(phone, { quiet: true });
  return false;
}

const Mode = ({ mode, setMode }) => (
  <div className="flex flex-wrap gap-2" role="radiogroup" data-testid="test-ring-mode">
    {[['mine', Monitor, 'My SIP phone / this browser'], ['other', Smartphone, 'Another phone']].map(([k, Icon, label]) => (
      <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
        className={`civr-btn civr-btn-sm ${mode === k ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`test-ring-mode-${k}`}><Icon className="w-4 h-4" />{label}</button>
    ))}
  </div>
);

const Result = ({ st, note }) => {
  if (st?.state === 'calling') return <div className="text-sm flex items-center gap-2 text-[#38bdf8]" data-testid="test-ring-status"><Loader2 className="w-4 h-4 animate-spin" />Ringing {st.to} — pick up and press 1…</div>;
  if (st?.state === 'done') {
    const Icon = st.code === 'ok' ? CheckCircle2 : AlertTriangle;
    return <div className={`text-sm flex gap-2 ${TONE[st.code] || ''}`} data-testid="test-ring-result"><Icon className="w-4 h-4 shrink-0 mt-0.5" /><span className="whitespace-pre-line">{st.outcome}</span></div>;
  }
  return note ? <div className="text-xs text-[#e4e4e7]" data-testid="test-ring-note">{note}</div> : null;
};

// Free test ring: up to 3 a day, max 1 minute, never billed.
export function TestRing({ num, compact = false }) {
  const rtc = useRtc();
  const [mode, setMode] = useState('mine');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState(null);
  const [note, setNote] = useState('');
  const stop = useRef(null);
  const phone = num.phoneNumber;
  const browserOk = !!(num.access?.browserPhone && num.sipUsername);

  useEffect(() => {
    api(`/numbers/${enc(phone)}/test-call`).then((d) => setSt(d.state === 'calling' ? d : { left: d.left, max: d.max })).catch(() => {});
    return () => clearInterval(stop.current);
  }, [phone]);

  const poll = () => {
    const until = Date.now() + GIVE_UP_MS;
    clearInterval(stop.current);
    stop.current = setInterval(async () => {
      try { const d = await api(`/numbers/${enc(phone)}/test-call`); setSt(d); if (d.state === 'done' || Date.now() > until) clearInterval(stop.current); } catch { clearInterval(stop.current); }
    }, POLL_MS);
  };

  const go = async () => {
    if (mode === 'other' && !to.trim()) return toast.error('Enter the phone number to ring.');
    setBusy(true); setNote('');
    try {
      if (mode === 'mine' && browserOk && !(await readyBrowser(rtc, phone))) setNote('This browser is signing in to your line — it will ring here too.');
      const d = await api(`/numbers/${enc(phone)}/test-call`, { method: 'POST', body: mode === 'other' ? { to: to.trim() } : {} });
      if (d.dryRun) { setNote(d.message); toast.success('Preview — no call placed'); return; }
      setSt({ state: 'calling', to: d.to || phone }); toast.success('Free test ring on its way'); poll();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const left = st?.left;
  return (
    <div className={`civr-card ${compact ? 'p-5 mt-6' : 'p-6'} space-y-3 text-left`} data-testid="test-ring-card">
      <div className="flex items-center gap-2 font-display text-xl font-bold"><PhoneIncoming className="w-5 h-5 text-[#38bdf8]" />Free test ring</div>
      <p className="text-sm text-[#a1a1aa]">We ring {mode === 'other' ? 'any phone you choose' : browserOk ? 'your SIP phone — or this browser if no SIP phone is signed in' : 'your number'} from our test line. Pick up and press 1. Free, up to 3 a day, 1 minute max.{left != null && <span className="text-[#e4e4e7]" data-testid="test-ring-left"> {left} left today.</span>}</p>
      <Mode mode={mode} setMode={setMode} />
      {mode === 'other' && <input className="civr-input w-full max-w-xs font-mono" placeholder="+14155550100" value={to} onChange={(e) => setTo(e.target.value)} inputMode="tel" aria-label="Phone number to ring" data-testid="test-ring-other-input" />}
      <button className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || num.status !== 'active' || st?.state === 'calling' || left === 0} onClick={go} data-testid="test-ring-button">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneIncoming className="w-4 h-4" />}Ring my phone
      </button>
      <Result st={st} note={note} />
    </div>
  );
}
