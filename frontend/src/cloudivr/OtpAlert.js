import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Clock } from 'lucide-react';
import { cp } from './paths';
import { usePrivacy } from './privacy';
import { useRingNotify, useTitleFlash } from './ringAlerts';
import { Decide } from './pages/quick/Otp';

const keyOf = (o) => `${o.id}:${o.attempt}`;

// Two short rising beeps when a new code arrives (the page already had a tap, so audio is allowed).
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1320, 0.18]].forEach(([f, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + at;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch (_) { /* no audio on this device */ }
}

function OtpBanner({ o, more, onDone, onLater }) {
  const pv = usePrivacy();
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="Code received" className="civr-otp-alert pointer-events-auto mx-auto w-full max-w-4xl rounded-2xl border-2 border-[#fbbf24] bg-[#0e0e16] p-4 sm:p-5 shadow-2xl" data-testid="otp-alert" data-state={o.state}>
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <span className="civr-incoming-ring w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-full bg-[#f59e0b] text-[#0e0e16] grid place-items-center"><KeyRound className="w-6 h-6" /></span>
          <div className="min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest text-[#fbbf24]" data-testid="otp-alert-label">{more > 0 ? `Code received · ${more} more waiting` : 'Code received'}</div>
            <div className="font-mono text-3xl sm:text-4xl font-bold tracking-[.25em] text-white" data-no-translate data-testid="otp-alert-code">{pv.text(o.code, '••••••')}</div>
            <div className="text-xs sm:text-sm text-[#a1a1aa]" data-testid="otp-alert-from">{`From ${pv.phone(o.to)} · they are on hold`}{o.preview && <span className="civr-pill ml-2 align-middle">Preview</span>}</div>
          </div>
        </div>
        <Decide st={o} ccid={o.id} onState={onDone} t="otp-alert" />
      </div>
      <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#a1a1aa]">
        <span>{o.connectTo ? `Accept to confirm the code and connect them to ${pv.phone(o.connectTo)}.` : 'Accept to confirm the code.'}</span>
        <span>Decline asks them to type it again.</span>
        <button type="button" onClick={onLater} className="ml-auto inline-flex items-center gap-1.5 underline text-[#e4e4e7] hover:text-white" data-testid="otp-alert-later-button"><Clock className="w-3.5 h-3.5" />Answer later</button>
        <Link to={cp('/app/quick-call')} onClick={onLater} className="underline text-[#e4e4e7] hover:text-white" data-testid="otp-alert-open-link">Open Quick IVR call</Link>
      </div>
    </div>
  );
}

// Banner on every page while a collected code waits for Accept / Decline (Inbox and Quick IVR page still work too).
export function OtpAlerts({ list }) {
  const pv = usePrivacy();
  const [hidden, setHidden] = useState(() => new Set());
  const seen = useRef(new Set());
  const shown = list.filter(o => !hidden.has(keyOf(o)));
  const keys = shown.map(keyOf).join(',');
  useEffect(() => {
    const fresh = shown.filter(o => !seen.current.has(keyOf(o)));
    fresh.forEach(o => seen.current.add(keyOf(o)));
    if (fresh.length) { chime(); navigator.vibrate?.([120, 60, 120]); }
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  const describe = useCallback((o) => `${pv.phone(o.to)} · ${pv.text(o.code, '••••••')}`, [pv]);
  useRingNotify(shown, describe, 'Code received');
  useTitleFlash(shown.length > 0, 'Code received', '🔑');
  if (!shown.length) return null;
  const o = shown[0];
  const hide = () => setHidden(h => new Set(h).add(keyOf(o)));
  return <OtpBanner key={keyOf(o)} o={o} more={shown.length - 1} onDone={hide} onLater={hide} />;
}
