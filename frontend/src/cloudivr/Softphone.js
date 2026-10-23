import React, { useEffect, useRef, useState } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { X, Phone, PhoneOff, Delete, Loader2 } from 'lucide-react';
import { api, enc } from './api';
import { Link } from 'react-router-dom';
import { cp } from './paths';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const STATUS = { idle: 'Offline', connecting: 'Connecting…', ready: 'Online', error: 'Not connected' };
// SDK errors can carry carrier wording — show our own text instead.
const friendly = (e) => {
  const detail = `${e?.error?.message || e?.message || ''}`;
  const code = e?.error?.code ?? e?.code;
  if (code === -32001 || /login incorrect|auth|forbidden|unauthor|credential/i.test(detail)) return 'The line’s SIP login was rejected. Create new SIP credentials in the number’s SIP tab, then connect again.';
  return 'Could not connect the browser phone. Check your internet connection and microphone permission, then try again.';
};

// Registers the selected number's SIP line in the browser and places/answers calls.
function useRtc() {
  const client = useRef(null);
  const [status, setStatus] = useState('idle');
  const [call, setCall] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => () => client.current?.disconnect(), []);
  const connect = async (phone) => {
    setMsg(''); setStatus('connecting');
    try {
      const c = await api(`/numbers/${enc(phone)}/sip`);
      if (!c.live) { setStatus('error'); setMsg('This line isn’t live on the network yet (preview numbers are simulated), so the browser phone can’t register.'); return; }
      client.current?.disconnect();
      const rtc = new TelnyxRTC({ login: c.username, password: c.password });
      rtc.remoteElement = 'civr-remote-audio';
      rtc.on('telnyx.ready', () => setStatus('ready'));
      rtc.on('telnyx.error', (e) => { setStatus('error'); setMsg(friendly(e)); });
      rtc.on('telnyx.socket.close', () => setStatus(s => (s === 'ready' ? 'idle' : s)));
      rtc.on('telnyx.notification', (n) => {
        if (n.type !== 'callUpdate') return;
        setCall(['hangup', 'destroy'].includes(n.call.state) ? null : { ref: n.call, state: n.call.state, inbound: n.call.direction === 'inbound' });
      });
      rtc.connect();
      client.current = rtc;
    } catch (e) { setStatus('error'); setMsg(e.status ? e.message : friendly(e)); }
  };
  const dial = (dest, from) => client.current?.newCall({ destinationNumber: dest, callerNumber: from, audio: true, video: false });
  return { status, call, msg, connect, dial };
}

export default function Softphone({ open, onClose }) {
  const [nums, setNums] = useState([]);
  const [sel, setSel] = useState('');
  const [dest, setDest] = useState('');
  const { status, call, msg, connect, dial } = useRtc();
  useEffect(() => {
    if (!open) return;
    api('/numbers').then(d => { const l = d.numbers.filter(n => n.status === 'active' && n.access.sipCredentials); setNums(l); setSel(s => s || l[0]?.phoneNumber || ''); }).catch(() => {});
  }, [open]);
  const press = (k) => (call ? call.ref.dtmf(k) : setDest(d => d + k));

  return (
    <div className={`fixed bottom-24 lg:bottom-4 right-4 left-4 sm:left-auto z-50 sm:w-[320px] civr-card p-6 shadow-2xl transition-[opacity,transform] duration-200 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`} data-testid="softphone-panel">
      <audio id="civr-remote-audio" autoPlay />
      <div className="flex items-center justify-between mb-4"><span className="font-display text-xl font-bold">Browser phone</span><button onClick={onClose} className="p-1 text-[#888] hover:text-white" data-testid="softphone-close-button" aria-label="Close"><X className="w-4 h-4" /></button></div>
      {!nums.length ? (
        <div data-testid="softphone-no-numbers">
          <p className="text-sm text-[#888]">Calling from the browser needs an active number on the Pro plan or higher.</p>
          <Link to={cp('/app/numbers')} onClick={onClose} className="civr-btn civr-btn-ghost civr-btn-sm mt-4" data-testid="softphone-upgrade-link">Upgrade a number</Link>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <select className="civr-input !h-9 font-mono text-xs" value={sel} onChange={e => setSel(e.target.value)} data-testid="softphone-number-select">{nums.map(n => <option key={n.phoneNumber}>{n.phoneNumber}</option>)}</select>
            <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={status === 'connecting'} onClick={() => connect(sel)} data-testid="softphone-connect-button">{status === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> : status === 'ready' ? 'Online' : 'Connect'}</button>
          </div>
          <div className="text-xs mb-3" data-testid="softphone-status"><span className={status === 'ready' ? 'text-[#34d399]' : status === 'error' ? 'text-[#fb7185]' : 'text-[#888]'}>{call ? `Call ${call.state}` : STATUS[status]}</span>{msg && <span className="block text-[#888] mt-1">{msg}</span>}</div>
          <div className="flex items-center gap-2 mb-3"><input className="civr-input font-mono" value={dest} onChange={e => setDest(e.target.value)} placeholder="+14155550100" data-testid="softphone-destination-input" /><button onClick={() => setDest(d => d.slice(0, -1))} className="p-2 text-[#888]" data-testid="softphone-backspace-button" aria-label="Delete digit"><Delete className="w-4 h-4" /></button></div>
          <div className="grid grid-cols-3 gap-2 mb-4">{KEYS.map(k => <button key={k} className="civr-key" onClick={() => press(k)} data-testid={`softphone-key-${k === '*' ? 'star' : k === '#' ? 'hash' : k}`}>{k}</button>)}</div>
          {call ? (
            <div className="flex gap-2">
              {call.inbound && call.state === 'ringing' && <button className="civr-btn civr-btn-primary flex-1" onClick={() => call.ref.answer()} data-testid="softphone-answer-button"><Phone className="w-4 h-4" />Answer</button>}
              <button className="civr-btn civr-btn-danger flex-1" onClick={() => call.ref.hangup()} data-testid="softphone-hangup-button"><PhoneOff className="w-4 h-4" />Hang up</button>
            </div>
          ) : <button className="civr-btn civr-btn-primary w-full" disabled={status !== 'ready' || !dest} onClick={() => dial(dest, sel)} data-testid="softphone-call-button"><Phone className="w-4 h-4" />Call</button>}
        </>
      )}
    </div>
  );
}
