import React, { useEffect, useState } from 'react';
import { X, Phone, PhoneOff, Delete, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { api } from './api';
import { useRtc } from './rtc';
import { Link } from 'react-router-dom';
import { cp } from './paths';
import { usePrivacy } from './privacy';
import { CallMeFirst, CallNoteBox } from './SoftphoneExtras';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const STATUS = { idle: 'Offline', connecting: 'Connecting…', ready: 'Online', error: 'Not connected' };

export default function Softphone({ open, onClose }) {
  const pv = usePrivacy();
  const [nums, setNums] = useState(null);
  const [sel, setSel] = useState('');
  const [dest, setDest] = useState('');
  const [cmf, setCmf] = useState(false);
  const [myPhone, setMyPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const [last, setLast] = useState(null); // current / last call, for notes
  const { status: rtcStatus, call, msg: rtcMsg, connect, dial, phone: rtcPhone } = useRtc();
  const here = rtcPhone === sel; // the browser line is registered for the selected number
  const status = here ? rtcStatus : 'idle';
  const msg = here ? rtcMsg : '';
  useEffect(() => {
    if (!open) return;
    // Browser calls need SIP; "Call me first" needs outbound IVR — both are Pro and up.
    api('/numbers').then(d => { const l = d.numbers.filter(n => n.status === 'active' && (n.access.sipCredentials || n.access.ivrOutbound)); setNums(l); setSel(s => s || (l.some(n => n.phoneNumber === rtcPhone) ? rtcPhone : l[0]?.phoneNumber) || ''); }).catch(() => {});
    api('/calls/callback').then(d => setMyPhone(p => p || d.myPhone || '')).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (call) setLast({ peer: call.peer, direction: call.inbound ? 'inbound' : 'outbound' }); }, [call]);
  const selNum = nums?.find(n => n.phoneNumber === sel);
  const cmfAllowed = !!selNum?.access?.ivrOutbound;
  const viaMobile = cmf && cmfAllowed;
  const press = (k) => (call ? call.ref.dtmf(k) : setDest(d => d + k));
  const callMeFirst = async () => {
    setBusy(true); setInfo(null);
    try {
      const d = await api('/calls/callback', { method: 'POST', body: { callerId: sel, myPhone, to: dest } });
      setInfo({ ok: true, text: d.dryRun ? d.message : `Ringing your mobile now — answer and press 1 to connect. Both calls bill about $${Number(d.rate).toFixed(2)}/min from your wallet.` });
      toast.success(d.dryRun ? 'Validated (preview — not dialed)' : 'Calling your mobile…');
      setLast({ peer: dest, direction: 'outbound' });
    } catch (e) { setInfo({ ok: false, text: e.message }); toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className={`fixed bottom-24 lg:bottom-4 right-4 left-4 sm:left-auto z-50 sm:w-[340px] max-h-[calc(100dvh-7rem)] lg:max-h-[calc(100dvh-2rem)] overflow-y-auto civr-card p-6 shadow-2xl transition-[opacity,transform] duration-200 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`} data-testid="softphone-panel">
      <div className="flex items-center justify-between mb-4"><span className="font-display text-xl font-bold">Browser phone</span><button onClick={onClose} className="w-11 h-11 -mr-3 flex items-center justify-center rounded-full text-[#a1a1aa] hover:text-white hover:bg-white/5" data-testid="softphone-close-button" aria-label="Close"><X className="w-5 h-5" /></button></div>
      {!nums ? (
        <div className="flex items-center gap-2 text-sm text-[#a1a1aa] py-6" data-testid="softphone-loading"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
      ) : !nums.length ? (
        <div data-testid="softphone-no-numbers">
          <p className="text-sm text-[#a1a1aa]">Calling from the browser needs an active number on the Pro plan or higher.</p>
          <Link to={cp('/app/numbers')} onClick={onClose} className="civr-btn civr-btn-ghost civr-btn-sm mt-4" data-testid="softphone-upgrade-link">Upgrade a number</Link>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <select className="civr-input !h-9 font-mono text-xs" value={sel} onChange={e => { setSel(e.target.value); setInfo(null); }} data-testid="softphone-number-select">{nums.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{pv.phone(n.phoneNumber)}</option>)}</select>
            {!viaMobile && <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={status === 'connecting' || !selNum?.access?.sipCredentials} onClick={() => connect(sel)} data-testid="softphone-connect-button">{status === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> : status === 'ready' ? 'Online' : 'Connect'}</button>}
          </div>
          <CallMeFirst on={cmf} onChange={v => { setCmf(v); setInfo(null); }} myPhone={myPhone} setMyPhone={setMyPhone} allowed={cmfAllowed} />
          <div className="text-xs mb-3" data-testid="softphone-status">
            {viaMobile ? <span className="text-[#a1a1aa]">Rings your mobile first — no browser connection needed.</span> : <span className={status === 'ready' ? 'text-[#34d399]' : status === 'error' ? 'text-[#fb7185]' : 'text-[#a1a1aa]'}>{call ? `Call ${call.state}` : STATUS[status]}</span>}
            {!viaMobile && msg && <span className="block text-[#a1a1aa] mt-1">{msg}</span>}
            {info && <span className={`block mt-1 ${info.ok ? 'text-[#34d399]' : 'text-[#fb7185]'}`} data-testid="softphone-callback-result">{info.text}</span>}
          </div>
          <div className="flex items-center gap-2 mb-3"><input className={`civr-input font-mono ${pv.input}`} inputMode="tel" autoComplete="off" value={dest} onChange={e => setDest(e.target.value)} placeholder="+14155550100" aria-label="Number to call" data-testid="softphone-destination-input" /><button onClick={() => setDest(d => d.slice(0, -1))} className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-[#a1a1aa] hover:text-white hover:bg-white/5" data-testid="softphone-backspace-button" aria-label="Delete digit"><Delete className="w-4 h-4" /></button></div>
          <div className="grid grid-cols-3 gap-2 mb-4">{KEYS.map(k => <button key={k} className="civr-key" onClick={() => press(k)} data-testid={`softphone-key-${k === '*' ? 'star' : k === '#' ? 'hash' : k}`}>{k}</button>)}</div>
          {call ? (
            <div className="flex gap-2">
              {call.inbound && call.state === 'ringing' && <button className="civr-btn civr-btn-primary flex-1" onClick={() => call.ref.answer()} data-testid="softphone-answer-button"><Phone className="w-4 h-4" />Answer</button>}
              <button className="civr-btn civr-btn-danger flex-1" onClick={() => call.ref.hangup()} data-testid="softphone-hangup-button"><PhoneOff className="w-4 h-4" />Hang up</button>
            </div>
          ) : viaMobile ? (
            <button className="civr-btn civr-btn-primary w-full" disabled={busy || !dest || !myPhone} onClick={callMeFirst} data-testid="softphone-call-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}Call via my mobile</button>
          ) : <button className="civr-btn civr-btn-primary w-full" disabled={status !== 'ready' || !dest} onClick={() => dial(dest, sel)} data-testid="softphone-call-button"><Phone className="w-4 h-4" />Call</button>}
          {(call || last) && <CallNoteBox key={`${sel}-${last?.peer || ''}`} phone={sel} peer={call?.peer || last?.peer} direction={call ? (call.inbound ? 'inbound' : 'outbound') : last?.direction} />}
        </>
      )}
    </div>
  );
}
