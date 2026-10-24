import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { api, enc } from './api';

// SDK errors can carry carrier wording — show our own text instead.
const friendly = (e) => {
  const detail = `${e?.error?.message || e?.message || ''}`;
  const code = e?.error?.code ?? e?.code;
  if (code === -32001 || /login incorrect|auth|forbidden|unauthor|credential/i.test(detail)) return 'The line’s SIP login was rejected. Create new SIP credentials in the number’s SIP tab, then connect again.';
  return 'Could not connect the browser phone. Check your internet connection and microphone permission, then try again.';
};
const NOT_LIVE = 'This line isn’t live on the network yet (preview numbers are simulated), so the browser phone can’t register.';

const RtcCtx = createContext(null);
export const useRtc = () => useContext(RtcCtx);

// One browser SIP line for the whole app, so a ringing call can be answered from any page.
export function RtcProvider({ children }) {
  const client = useRef(null);
  const line = useRef('');
  const [status, setStatus] = useState('idle');
  const [call, setCall] = useState(null);
  const [msg, setMsg] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => () => client.current?.disconnect(), []);

  // quiet = automatic connect: a line that isn't live stays "Offline" instead of showing an error.
  const connect = useCallback(async (p, { quiet = false } = {}) => {
    setMsg(''); setStatus('connecting'); setPhone(p); line.current = p;
    try {
      const c = await api(`/numbers/${enc(p)}/sip`);
      if (!c.live) { setStatus(quiet ? 'idle' : 'error'); setMsg(NOT_LIVE); return; }
      client.current?.disconnect();
      const rtc = new TelnyxRTC({ login: c.username, password: c.password });
      rtc.remoteElement = 'civr-remote-audio';
      rtc.on('telnyx.ready', () => setStatus('ready'));
      rtc.on('telnyx.error', (e) => { setStatus('error'); setMsg(friendly(e)); });
      rtc.on('telnyx.socket.close', () => setStatus(s => (s === 'ready' ? 'idle' : s)));
      rtc.on('telnyx.notification', (n) => {
        if (n.type !== 'callUpdate') return;
        const inbound = n.call.direction === 'inbound';
        const peer = inbound ? n.call.options?.remoteCallerNumber : n.call.options?.destinationNumber;
        setCall(['hangup', 'destroy'].includes(n.call.state) ? null : { ref: n.call, state: n.call.state, inbound, peer });
      });
      rtc.connect();
      client.current = rtc;
    } catch (e) { setStatus(quiet ? 'idle' : 'error'); setMsg(e.status ? e.message : friendly(e)); }
  }, []);

  // Numbers with "Ring me in the browser" on keep the browser phone online while the app is open.
  const autoConnect = useCallback(async () => {
    const d = await api('/numbers').catch(() => null);
    const n = d?.numbers?.find(x => x.status === 'active' && x.features?.browserRing?.enabled && x.access?.sipCredentials && x.sipUsername);
    if (n && line.current !== n.phoneNumber) connect(n.phoneNumber, { quiet: true });
  }, [connect]);
  useEffect(() => { autoConnect(); }, [autoConnect]);

  const dial = (dest, from) => client.current?.newCall({ destinationNumber: dest, callerNumber: from, audio: true, video: false });
  return (
    <RtcCtx.Provider value={{ status, call, msg, phone, connect, dial, autoConnect }}>
      <audio id="civr-remote-audio" autoPlay />
      {children}
    </RtcCtx.Provider>
  );
}
