import React from 'react';
import { PhoneIncoming, CalendarCheck, Workflow, Voicemail, Languages } from 'lucide-react';
import { useInView, useStep, reducedMotion, Wave } from './kit';

const LINES = [
  ['ai', 'Thanks for calling Northwind Dental. How can I help?'],
  ['me', 'Can I get a cleaning next Tuesday afternoon?'],
  ['ai', 'Tuesday at 2:30 is free. I’ve booked it for you.'],
];
const CHIPS = [
  [Workflow, 'Press 1 for sales', 'top-10 -left-2 xl:-left-10', '0s'],
  [Voicemail, 'Voicemail, written out', 'bottom-24 -left-4 xl:-left-14', '1.2s'],
  [Languages, '20 languages', 'top-28 -right-2 xl:-right-8', '2.1s'],
];

// Example call that plays itself: the phone rings, the AI receptionist answers, the visit is booked.
export function HeroDemo() {
  const [ref, inView] = useInView({ once: false, threshold: 0.2 });
  const step = useStep(inView, 6, 2300);
  const phase = reducedMotion() ? 5 : step;
  return (
    <div ref={ref} className="lx-stage civr-rise civr-d3" data-testid="hero-demo">
      <div className="lx-phone" aria-label="Example call answered by an AI receptionist" role="img">
        <span className="lx-notch" aria-hidden="true" />
        <div className="lx-screen" data-testid="hero-demo-screen">
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-[.16em] text-white/60" data-testid="hero-demo-status">{phase === 0 ? 'Incoming call' : 'AI receptionist · on call'}</div>
            <div className="font-mono text-base mt-2 text-white" data-no-translate>+1 (415) 555-0134</div>
            {phase > 0 && <div className="mt-3 flex justify-center text-emerald-300"><Wave on={phase < 4} /></div>}
          </div>
          {phase === 0
            ? <div className="lx-ringwrap"><span className="lx-ring" /><span className="lx-ring d2" /><PhoneIncoming className="w-8 h-8" aria-hidden="true" /></div>
            : <ul className="mt-6 space-y-3">{LINES.slice(0, phase).map(([who, text]) => <li key={text} className={`lx-bubble lx-pop ${who}`}>{text}</li>)}</ul>}
          {phase >= 4 && (
            <div className="lx-pop mt-auto rounded-2xl bg-emerald-400/15 border border-emerald-300/30 px-4 py-3 flex items-center gap-3" data-testid="hero-demo-booked">
              <CalendarCheck className="w-5 h-5 text-emerald-300 shrink-0" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">Booked · Tue 2:30 PM</span>
            </div>
          )}
        </div>
      </div>
      {CHIPS.map(([I, t, pos, d]) => <span key={t} className={`lx-chip lx-float-chip ${pos}`} style={{ animationDelay: d }} aria-hidden="true"><I className="w-4 h-4 text-[#1d6fd8]" />{t}</span>)}
    </div>
  );
}
