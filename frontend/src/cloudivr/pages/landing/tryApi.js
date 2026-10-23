import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';

// Free test call client: email-code token (session only), a stable device id, live call status and browser calling.
const TOKEN_KEY = 'civr.tryToken';
const DEVICE_KEY = 'civr.device';

export function deviceId() {
  let d = localStorage.getItem(DEVICE_KEY);
  if (!d) {
    d = (window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^a-z0-9-]/gi, '');
    localStorage.setItem(DEVICE_KEY, d);
  }
  return d;
}
export const savedToken = () => {
  try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); return t && t.exp > Date.now() ? t : null; } catch (_) { return null; }
};
export const saveToken = (token, email) => sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, email, exp: Date.now() + 18 * 60000 }));
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

export const sendCode = (email) => api('/public/try/send-code', { method: 'POST', body: { email, deviceId: deviceId() } });
export const verifyCode = (email, code) => api('/public/try/verify', { method: 'POST', body: { email, code } });
export const startCall = (kind, token, to) => api(`/public/try/${kind === 'browser' ? 'browser' : 'call-me'}`, { method: 'POST', body: { token, to, deviceId: deviceId() } });

// Seconds left once `running` turns true (stays put after it stops).
export function useCountdown(running, max) {
  const [left, setLeft] = useState(max);
  useEffect(() => {
    if (!running) return undefined;
    const start = Date.now();
    const t = setInterval(() => setLeft(Math.max(0, max - Math.floor((Date.now() - start) / 1000))), 250);
    return () => clearInterval(t);
  }, [running, max]);
  return left;
}

// Polls a "we call you" demo until it ends.
export function useCallStatus(id) {
  const [s, setS] = useState(null);
  useEffect(() => {
    let stop = false, t = null;
    const tick = async () => {
      try { const d = await api(`/public/try/calls/${id}`); if (stop) return; setS(d); if (d.phase === 'ended') return; } catch (_) { /* keep polling */ }
      if (!stop) t = setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [id]);
  return s;
}

// Browser call on the one-call test line (simulated in preview).
export function useBrowserCall(call) {
  const [state, setState] = useState('connecting');
  const [msg, setMsg] = useState('');
  const [pressed, setPressed] = useState([]);
  const cur = useRef(null);
  useEffect(() => {
    let off = false, client = null, t = null;
    if (call.dryRun) { t = setTimeout(() => !off && setState('active'), 1800); return () => { off = true; clearTimeout(t); }; }
    import('@telnyx/webrtc').then(({ TelnyxRTC }) => {
      if (off) return;
      client = new TelnyxRTC({ login: call.login, password: call.password });
      client.remoteElement = 'civr-try-remote-audio';
      client.on('telnyx.ready', () => { cur.current = client.newCall({ destinationNumber: call.to, callerNumber: call.callerNumber || undefined, audio: true, video: false }); });
      client.on('telnyx.error', () => { setState('error'); setMsg('Could not connect. Allow microphone access and check your internet, then try again.'); });
      client.on('telnyx.notification', (n) => {
        if (n.type !== 'callUpdate') return;
        const st = n.call.state;
        if (st === 'active') setState('active');
        else if (['hangup', 'destroy'].includes(st)) setState('ended');
        else setState(s => (s === 'active' ? s : 'ringing'));
      });
      client.connect();
    }).catch(() => { setState('error'); setMsg('The browser phone could not load. Try the "we call your phone" option.'); });
    return () => { off = true; try { cur.current?.hangup(); } catch (_) { /* gone */ } client?.disconnect(); };
  }, [call]);
  const hangup = useCallback(() => { try { cur.current?.hangup(); } catch (_) { /* gone */ } setState('ended'); }, []);
  const press = useCallback((k) => { setPressed(p => [...p.slice(-7), k]); try { cur.current?.dtmf(k); } catch (_) { /* not in a call */ } }, []);
  return { state, msg, pressed, hangup, press };
}
