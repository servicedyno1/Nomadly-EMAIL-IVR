import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Workflow, Megaphone, MapPinned, Lock } from 'lucide-react';
import { useInView, reducedMotion } from './kit';

// Real screens from the app (demo account), captured with scripts/capture_landing_shots.js.
const TABS = [
  ['dashboard', 'Dashboard', LayoutDashboard, 'overview', 'app', 'Your numbers, wallet and calls at a glance.'],
  ['ivr', 'Keypad menus', Workflow, 'ivr', 'app/numbers', 'Write a greeting, pick a voice and send each key where it belongs.'],
  ['campaigns', 'Campaigns', Megaphone, 'campaigns', 'app/campaigns', 'Call a whole list and watch every call ring, talk and finish.'],
  ['live', 'Live map', MapPinned, 'map', 'app/live', 'See where today’s calls are, state by state, as they happen.'],
];
const AUTO_MS = 7000;
const src = (f) => `/civr/shots/app-${f}.webp`;

function Frame({ i }) {
  return (
    <div className="civr-l-frame" data-testid="hero-browser-frame">
      <div className="civr-l-frame-bar" aria-hidden="true">
        <span className="flex gap-1.5"><i /><i /><i /></span>
        <span className="civr-l-frame-url" data-testid="hero-browser-url"><Lock className="w-3 h-3" />cloudivr.net/{TABS[i][4]}</span>
      </div>
      <div className="relative aspect-[16/10] bg-[#0a0a0a]">
        {TABS.map(([id, label, , file], k) => (
          <img key={id} src={src(file)} alt={`CloudIVR ${label} screen`} width="2160" height="1350" loading={k ? 'lazy' : 'eager'} decoding="async"
            className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-500 ${k === i ? 'opacity-100' : 'opacity-0'}`} data-testid={`hero-shot-${id}`} />
        ))}
      </div>
    </div>
  );
}

// cm.com-style product tabs: they move on by themselves until someone picks one.
export function HeroTabs() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [ref, inView] = useInView({ once: false, threshold: 0.2 });
  const run = auto && inView && !reducedMotion();
  useEffect(() => {
    if (!run) return undefined;
    const t = setTimeout(() => setI(x => (x + 1) % TABS.length), AUTO_MS);
    return () => clearTimeout(t);
  }, [run, i]);
  const pick = (k) => { setAuto(false); setI((k + TABS.length) % TABS.length); };
  const keys = (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const k = (i + d + TABS.length) % TABS.length;
    pick(k);
    e.currentTarget.querySelectorAll('[role="tab"]')[k]?.focus();
  };
  return (
    <div ref={ref} className="relative mt-16 md:mt-20 pb-20 md:pb-28" data-testid="hero-preview">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div role="tablist" aria-label="Product preview" onKeyDown={keys} className="flex justify-start sm:justify-center gap-6 sm:gap-10 overflow-x-auto px-2 -mx-2 civr-no-scrollbar" data-testid="hero-tabs">
          {TABS.map(([id, label, Icon], k) => (
            <button key={id} type="button" role="tab" aria-selected={k === i} aria-controls="hero-tab-panel" tabIndex={k === i ? 0 : -1} onClick={() => pick(k)} className="civr-l-tabbtn shrink-0" data-testid={`hero-tab-${id}`}>
              <span className="inline-flex items-center gap-2 whitespace-nowrap"><Icon className="w-4 h-4" />{label}</span>
              <span className="bar" aria-hidden="true"><i key={`${i}-${run}`} className={run && k === i ? 'auto' : ''} style={{ '--d': `${AUTO_MS}ms` }} /></span>
            </button>
          ))}
        </div>
        <p key={i} className="text-center text-sm md:text-base text-slate-600 mt-6 civr-l-swap" data-testid="hero-tab-caption">{TABS[i][5]}</p>
        <div id="hero-tab-panel" role="tabpanel" aria-label={TABS[i][1]} className="mt-8 max-w-5xl mx-auto" data-testid="hero-tab-panel">
          <div data-testid={`hero-scene-${TABS[i][0]}`}><Frame i={i} /></div>
        </div>
      </div>
    </div>
  );
}
