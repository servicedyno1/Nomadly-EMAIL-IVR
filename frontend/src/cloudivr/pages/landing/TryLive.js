import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PhoneOff, RotateCcw, ArrowRight } from 'lucide-react';
import { cp } from '../../paths';
import { Slide } from './kit';
import { useCallStatus, useCountdown, useBrowserCall } from './tryApi';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const keyId = (k) => (k === '*' ? 'star' : k === '#' ? 'hash' : k);
const PHASE = { connecting: 'Connecting…', ringing: 'Ringing…', connected: 'Connected', active: 'Connected', ended: 'Call ended', no_answer: 'No answer', error: 'Not connected' };
const OVER = ['ended', 'no_answer', 'error'];

export function Keypad({ lit = [], labels = {}, onPress }) {
  const last = lit[lit.length - 1];
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="civr-try-keypad">
      {KEYS.map(k => (
        <button key={k} type="button" disabled={!onPress} onClick={() => onPress?.(k)} className={`civr-l-key flex flex-col items-center justify-center ${lit.includes(k) ? 'lit' : ''} ${last === k ? 'civr-pulse' : ''}`} data-testid={`civr-try-key-${keyId(k)}`}>
          {k}{labels[k] && <span className="text-[9px] uppercase tracking-widest opacity-70 font-sans mt-0.5">{labels[k]}</span>}
        </button>
      ))}
    </div>
  );
}

function Ring({ left, max }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="relative w-36 h-36 shrink-0" data-testid="civr-try-timer">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90"><circle cx="60" cy="60" r={r} fill="none" stroke="rgba(254,253,245,.12)" strokeWidth="6" /><circle cx="60" cy="60" r={r} fill="none" stroke="#00E3AA" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / max)} style={{ transition: 'stroke-dashoffset .3s linear' }} /></svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="civr-l-h text-5xl" data-testid="civr-try-seconds-left">{left}</span><span className="text-xs font-mono uppercase tracking-widest civr-l-muted">seconds</span></div>
    </div>
  );
}

function Header({ to, phase, dryRun, testid }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="civr-l-eyebrow !text-xs">Free test call</div><div className="font-mono text-2xl mt-1" data-testid={`${testid}-number`}>{to}</div></div>
      <div className="flex flex-wrap gap-2">
        {dryRun && <span className="text-xs font-mono uppercase tracking-widest px-2.5 py-1 rounded-full border border-[#fbbf24]/50 text-[#fbbf24]" data-testid="civr-try-preview-pill">Preview · simulated</span>}
        <span className={`text-xs font-mono uppercase tracking-widest px-2.5 py-1 rounded-full border flex items-center gap-2 ${OVER.includes(phase) ? 'border-white/20 text-white/60' : 'border-[#00E3AA]/50 text-[#00E3AA]'}`} data-testid={`${testid}-phase`}>{!OVER.includes(phase) && <span className="civr-l-dot" />}{PHASE[phase] || phase}</span>
      </div>
    </div>
  );
}

function Done({ onReset }) {
  return (
    <div className="mt-6 pt-6 border-t civr-l-rule flex flex-col sm:flex-row sm:items-center gap-4" data-testid="civr-try-done">
      <div className="flex-1"><div className="civr-l-h text-3xl">That was CloudIVR.</div><p className="text-sm civr-l-muted mt-1">Get your own number with this menu in a few minutes.</p></div>
      <button type="button" onClick={onReset} className="civr-l-btn civr-l-btn-ghost civr-l-btn-sm" data-testid="civr-try-reset-btn"><RotateCcw className="w-4 h-4" />Back</button>
      <Link to={cp('/signup')} className="civr-l-btn civr-l-btn-sm" data-testid="civr-try-get-number-btn"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
    </div>
  );
}

const CALLME_HINT = { ringing: 'Your phone is ringing — pick up to hear the demo menu.', connected: 'Press 1, 2 or 3 on your phone. Each key you press lights up here.', ended: 'The call has ended.', no_answer: 'Nobody picked up, so this didn’t use your free call. Press Try again when your phone is handy.' };

function NoAnswer({ onReset }) {
  return (
    <div className="mt-6 pt-6 border-t civr-l-rule flex flex-col sm:flex-row sm:items-center gap-4" data-testid="civr-try-no-answer">
      <div className="flex-1"><div className="civr-l-h text-3xl">Missed it?</div><p className="text-sm civr-l-muted mt-1">Your free call is still waiting for you.</p></div>
      <button type="button" onClick={onReset} className="civr-l-btn civr-l-btn-sm" data-testid="civr-try-again-btn"><RotateCcw className="w-4 h-4" /><Slide>Try again</Slide></button>
    </div>
  );
}

export function CallMeLive({ call, onReset }) {
  const s = useCallStatus(call.id);
  const phase = s?.phase || 'ringing';
  const left = useCountdown(phase === 'connected', call.maxSeconds);
  return (
    <div data-testid="civr-callme-live">
      <Header to={call.to} phase={phase} dryRun={call.dryRun} testid="civr-callme-live" />
      <div className="grid sm:grid-cols-[auto,1fr] gap-6 items-center mt-6">
        <Ring left={OVER.includes(phase) ? 0 : left} max={call.maxSeconds} />
        <p className="text-sm civr-l-muted" data-testid="civr-callme-live-hint">{CALLME_HINT[phase]}</p>
      </div>
      <div className="mt-6"><Keypad lit={s?.digits || []} labels={s?.menu || {}} /></div>
      {phase === 'ended' && <Done onReset={onReset} />}
      {phase === 'no_answer' && <NoAnswer onReset={onReset} />}
    </div>
  );
}

export function BrowserLive({ call, onReset }) {
  const b = useBrowserCall(call);
  const left = useCountdown(b.state === 'active', call.maxSeconds);
  const { state, hangup } = b;
  useEffect(() => { if (state === 'active' && left === 0) hangup(); }, [state, left, hangup]);
  const live = !['ended', 'error'].includes(b.state);
  return (
    <div data-testid="civr-browser-live">
      <audio id="civr-try-remote-audio" autoPlay />
      <Header to={call.to} phase={b.state} dryRun={call.dryRun} testid="civr-browser-live" />
      <div className="grid sm:grid-cols-[auto,1fr] gap-6 items-center mt-6">
        <Ring left={b.state === 'ended' ? 0 : left} max={call.maxSeconds} />
        <div className="text-sm civr-l-muted" data-testid="civr-browser-live-hint">{b.msg || (b.state === 'active' ? 'You are live. Talk, or tap keys to send tones.' : b.state === 'ended' ? 'The call has ended.' : 'Allow microphone access if your browser asks.')}</div>
      </div>
      <div className="mt-6"><Keypad lit={b.pressed} onPress={b.state === 'active' ? b.press : null} /></div>
      {live && <button type="button" onClick={b.hangup} className="civr-l-btn w-full mt-4 !bg-[#fb7185] hover:!bg-[#f43f5e] !shadow-none" data-testid="civr-browser-hangup-btn"><PhoneOff className="w-4 h-4" />Hang up</button>}
      {!live && <Done onReset={onReset} />}
    </div>
  );
}
