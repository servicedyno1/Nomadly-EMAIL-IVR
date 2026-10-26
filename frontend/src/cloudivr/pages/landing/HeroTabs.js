import React, { useEffect, useState } from 'react';
import { Hash, Bot, Megaphone, Inbox, PhoneIncoming, CornerDownRight } from 'lucide-react';
import { useInView, reducedMotion } from './kit';
import { AppMock, IvrMock, AiMock } from './Mockups';
import { SmsMock, VoicemailMock } from './MockupsLive';
import { LiveMock } from './MockupsMore';

const EVENTS = [[PhoneIncoming, 'Incoming call', '+1 415 555 0182'], [CornerDownRight, 'Pressed 1 → Sales', 'forwarded in 0.4 s'], [PhoneIncoming, 'Incoming call', '+44 20 7946 0958'], [CornerDownRight, 'Pressed 3 → Voicemail', 'sent to your inbox']];

// Small event chip on the dashboard shot.
function LiveCallCard() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % EVENTS.length), 2600); return () => clearInterval(t); }, []);
  const [Icon, title, sub] = EVENTS[i];
  return (
    <div className="hidden sm:block absolute -right-2 md:-right-6 -bottom-8 w-60 rounded-xl border border-slate-200 bg-white shadow-[0_16px_40px_-16px_rgba(15,23,42,.35)] p-4 civr-l-float" data-testid="hero-live-ivr-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><span className="civr-l-dot" />Live IVR</div>
      <div key={i} className="flex items-start gap-3 mt-3 civr-rise">
        <span className="w-8 h-8 rounded-lg bg-indigo-50 text-[#4f46e5] grid place-items-center shrink-0"><Icon className="w-4 h-4" /></span>
        <div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{title}</div><div className="text-xs font-mono text-slate-500 mt-0.5 truncate">{sub}</div></div>
      </div>
    </div>
  );
}

const pair = (a, b) => <div className="grid md:grid-cols-2 gap-4 items-start">{a}{b}</div>;
const TABS = [
  ['numbers', 'Numbers', Hash, () => <div className="relative"><AppMock /><LiveCallCard /></div>],
  ['agents', 'IVR & AI agents', Bot, () => pair(<IvrMock />, <AiMock />)],
  ['campaigns', 'Campaigns', Megaphone, () => <LiveMock />],
  ['inbox', 'Inbox', Inbox, () => pair(<SmsMock />, <VoicemailMock />)],
];
const AUTO_MS = 7000;

// cm.com-style product tabs under the hero; they move on by themselves until someone picks one.
export function HeroTabs() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [ref, inView] = useInView({ once: false, threshold: 0.25 });
  const running = auto && inView && !reducedMotion();
  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => setI(x => (x + 1) % TABS.length), AUTO_MS);
    return () => clearTimeout(t);
  }, [i, running]);
  const pick = (k) => { setAuto(false); setI((k + TABS.length) % TABS.length); };
  const keys = (e) => { if (e.key === 'ArrowRight') pick(i + 1); if (e.key === 'ArrowLeft') pick(i - 1); };
  const Scene = TABS[i][3];
  return (
    <div ref={ref} className="relative mt-16 md:mt-24" data-testid="hero-preview">
      <div className="absolute inset-x-0 bottom-0 h-48 md:h-64 bg-white" aria-hidden="true" />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div role="tablist" aria-label="Product preview" onKeyDown={keys} className="flex justify-start sm:justify-center gap-6 sm:gap-10 overflow-x-auto px-2 -mx-2 civr-no-scrollbar" data-testid="hero-tabs">
          {TABS.map(([id, label, Icon], k) => (
            <button key={id} type="button" role="tab" aria-selected={k === i} aria-controls="hero-tab-panel" tabIndex={k === i ? 0 : -1} onClick={() => pick(k)} className="civr-l-tabbtn shrink-0" data-testid={`hero-tab-${id}`}>
              <span className="inline-flex items-center gap-2 whitespace-nowrap"><Icon className="w-4 h-4" />{label}</span>
              <span className="bar" aria-hidden="true"><i key={`${k}-${i}-${running}`} className={running ? 'auto' : ''} style={{ '--d': `${AUTO_MS}ms` }} /></span>
            </button>
          ))}
        </div>
        <div id="hero-tab-panel" role="tabpanel" aria-label={TABS[i][1]} className="mt-8 pb-14 md:pb-20 max-w-5xl mx-auto min-h-[22rem]" data-testid="hero-tab-panel">
          <div key={i} className="civr-l-swap" data-testid={`hero-scene-${TABS[i][0]}`}><Scene /></div>
        </div>
      </div>
    </div>
  );
}
