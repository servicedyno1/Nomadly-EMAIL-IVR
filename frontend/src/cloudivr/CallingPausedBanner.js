import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PhoneOff, X } from 'lucide-react';
import { api } from './api';
import { cp } from './paths';

const HIDE_KEY = 'civr:calling-paused-hidden';
const today = () => new Date().toISOString().slice(0, 10);

// Red strip shown while outgoing calls are paused for a low wallet (dashboard + browser phone).
export function CallingPausedBanner({ compact = false, testid = 'calling-paused-banner' }) {
  const [st, setSt] = useState(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDE_KEY) === today());
  useEffect(() => {
    let on = true;
    const load = () => api('/wallet/calling').then(d => on && setSt(d)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { on = false; clearInterval(t); };
  }, []);
  if (hidden || !st?.locked || !st.hasNumber) return null;
  const hide = () => { localStorage.setItem(HIDE_KEY, today()); setHidden(true); };
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border border-[#fb7185]/40 bg-[#fb7185]/10 ${compact ? 'p-3 mb-3 text-xs' : 'p-4 mb-6 text-sm'}`} data-testid={testid}>
      <PhoneOff className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-[#fb7185] shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[#e11d48]" data-testid={`${testid}-title`}>Outgoing calls are paused</div>
        <div className="text-[var(--c-muted)] mt-0.5" data-testid={`${testid}-text`}>Your wallet has ${st.balance.toFixed(2)}. Top up to at least ${st.unlockAt} to call again. Incoming calls still work.</div>
        <Link to={cp('/app/wallet')} className={`civr-btn civr-btn-primary ${compact ? 'civr-btn-sm mt-2' : 'civr-btn-sm mt-3'}`} data-testid={`${testid}-topup`}>Top up</Link>
      </div>
      <button onClick={hide} className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center rounded-full text-[var(--c-muted)] hover:text-white hover:bg-white/5" aria-label="Hide for today" title="Hide for today" data-testid={`${testid}-hide`}><X className="w-4 h-4" /></button>
    </div>
  );
}
