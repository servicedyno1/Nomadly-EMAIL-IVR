import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { Wave, reducedMotion } from './kit';
import { SAMPLE_DURATION, SAMPLE_SEGMENTS } from './sampleCall';

// "Hear it": a 30-second sample produced with the platform's own voices — IVR greeting, a real key press, the AI
// agent booking a slot, then the handover — with a transcript that follows word by word. No form, no account.
export const SAMPLE_SRC = '/civr/sample/sample-call.mp3';
const WHO = { menu: 'Keypad menu', agent: 'AI agent', caller: 'Caller', human: 'Front desk', tone: 'Key press', ring: 'Handover' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Line({ seg, t, active, lineRef }) {
  const sys = !seg.words;
  const state = active ? 'now' : t >= seg.end ? 'done' : '';
  return (
    <div ref={lineRef} className={`civr-l-line ${state} ${sys ? 'sys' : ''}`} data-testid={`hear-line-${seg.speaker}-${Math.round(seg.start * 10)}`}>
      <span className="who" data-no-translate>{WHO[seg.speaker]}</span>
      <span className="text-sm md:text-[15px] leading-relaxed">
        {sys ? seg.text : seg.words.map((w, i) => <span key={i} className={`w ${t >= w.e ? 'said' : t >= w.s ? 'now' : ''}`}>{w.w}{i < seg.words.length - 1 ? ' ' : ''}</span>)}
      </span>
    </div>
  );
}

export function HearIt({ className = '' }) {
  const audio = useRef(null);
  const box = useRef(null);
  const activeRef = useRef(null);
  const [state, setState] = useState('idle');
  const [t, setT] = useState(0);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  const playing = state === 'playing';

  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = () => { const c = audio.current?.currentTime || 0; setT(x => (Math.abs(x - c) > 0.04 ? c : x)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const activeIdx = SAMPLE_SEGMENTS.findIndex(s => t >= s.start && t < s.end + 0.15);
  useEffect(() => {
    const el = activeRef.current, c = box.current;
    if (!el || !c || activeIdx < 0) return;
    const top = el.offsetTop - c.offsetTop - 12;
    if (Math.abs(c.scrollTop - top) > 4) c.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [activeIdx]);

  const toggle = async () => {
    const a = audio.current;
    if (!a) return;
    setErr(null);
    if (playing) { a.pause(); setState('paused'); return; }
    setOpen(true);
    if (state === 'ended') { a.currentTime = 0; setT(0); }
    try { await a.play(); setState('playing'); } catch (_) { setErr('Playback was blocked — tap play again.'); setState('paused'); }
  };
  const seek = (e) => {
    const a = audio.current;
    if (!a) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    a.currentTime = p * SAMPLE_DURATION; setT(a.currentTime); setOpen(true);
  };
  const nudge = (e) => {
    const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
    const a = audio.current;
    if (!d || !a) return;
    e.preventDefault();
    a.currentTime = Math.min(SAMPLE_DURATION, Math.max(0, a.currentTime + d)); setT(a.currentTime); setOpen(true);
  };
  const Icon = playing ? Pause : state === 'ended' ? RotateCcw : Play;
  return (
    <div className={`civr-l-card-cream text-left ${className}`} data-testid="hear-it">
      <div className="flex items-center gap-4 p-4 md:p-5">
        <button type="button" onClick={toggle} className="civr-l-play" aria-label={playing ? 'Pause the sample call' : 'Play a sample call'} aria-pressed={playing} data-testid="hear-it-play">
          <Icon className={`w-5 h-5 ${Icon === Play ? 'translate-x-[1px]' : ''}`} fill={Icon === Play ? 'currentColor' : 'none'} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-900 text-sm md:text-base" data-testid="hear-it-title">{playing ? 'Playing a sample call' : state === 'ended' ? 'That was 30 seconds of CloudIVR' : 'Hear a 30-second call'}</span>
            <Wave on={playing} className="text-slate-900 hidden sm:inline-flex" />
          </div>
          <p className="text-xs md:text-sm text-slate-500 mt-0.5 truncate" data-testid="hear-it-sub">Keypad menu · key press · AI agent books a slot · handover to a person. Made with CloudIVR’s own voices.</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="civr-l-progress flex-1" style={{ '--p': `${Math.min(100, (t / SAMPLE_DURATION) * 100)}%` }} onClick={seek} onKeyDown={nudge} role="slider" aria-label="Sample call position" aria-valuemin={0} aria-valuemax={Math.round(SAMPLE_DURATION)} aria-valuenow={Math.round(t)} tabIndex={0} data-testid="hear-it-progress"><i /></div>
            <span className="font-mono text-xs text-slate-500 tabular-nums w-[5.5rem] text-right" data-no-translate data-testid="hear-it-time">{mmss(t)} / {mmss(SAMPLE_DURATION)}</span>
          </div>
        </div>
      </div>
      {err && <p className="px-5 pb-3 text-xs text-rose-700" data-testid="hear-it-error">{err}</p>}
      {open && (
        <div ref={box} className="civr-l-transcript border-t civr-l-rule px-4 md:px-5 py-3" aria-live="off" data-testid="hear-it-transcript">
          {SAMPLE_SEGMENTS.map((s, i) => <Line key={s.start} seg={s} t={t} active={i === activeIdx} lineRef={i === activeIdx ? activeRef : null} />)}
        </div>
      )}
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="w-full text-left px-5 py-2.5 border-t civr-l-rule text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors" data-testid="hear-it-show-transcript">Read the transcript</button>
      )}
      <audio ref={audio} src={SAMPLE_SRC} preload="none" onEnded={() => { setState('ended'); setT(SAMPLE_DURATION); }} onPause={() => setState(s => (s === 'playing' ? 'paused' : s))} onPlay={() => setState('playing')} data-testid="hear-it-audio" />
    </div>
  );
}
