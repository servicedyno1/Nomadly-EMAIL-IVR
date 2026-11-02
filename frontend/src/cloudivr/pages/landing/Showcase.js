import React, { useState } from 'react';
import { MessageSquareText, Hash, Smartphone, LayoutGrid, LayoutDashboard } from 'lucide-react';
import { Reveal } from './kit';

const SHOT = (n, v) => `${process.env.PUBLIC_URL || ''}/cloudivr/shots/${n}-${v}.webp`;
const SHOTS = [
  ['messages', MessageSquareText, 'Messages', 'Codes and texts arrive in one inbox, in any browser.'],
  ['numbers', Hash, 'My numbers', 'Your US mobile number, renewal and replacement in one place.'],
  ['esim', Smartphone, 'eSIM', 'The QR code to install your eSIM, plus plan and renewal.'],
  ['ivr', LayoutGrid, 'Keypad menu', 'Callers press a key to reach a person, a message or a text.'],
  ['overview', LayoutDashboard, 'Overview', 'Wallet, numbers and recent activity at a glance.'],
];

// Real light-mode screenshots of the app (sample data); phones get the phone-sized capture.
export function Showcase() {
  const [on, setOn] = useState(SHOTS[0][0]);
  const cur = SHOTS.find(s => s[0] === on);
  return (
    <section id="app" className="py-14 md:py-20 bg-[color:var(--np-bg-soft)] scroll-mt-16" data-testid="showcase">
      <div className="max-w-6xl mx-auto px-5 sm:px-6">
        <Reveal>
          <div className="civr-l-kicker">Inside the app</div>
          <h2 className="civr-l-h text-3xl sm:text-4xl mt-4 text-slate-950 max-w-2xl">This is what you get after you order</h2>
        </Reveal>
        <div className="flex gap-2 mt-7 overflow-x-auto pb-1 -mx-5 px-5 sm:mx-0 sm:px-0" role="tablist" aria-label="App screens">
          {SHOTS.map(([id, I, label]) => (
            <button key={id} type="button" role="tab" aria-selected={on === id} onClick={() => setOn(id)} className={`shrink-0 inline-flex items-center gap-2 rounded-full px-4 min-h-[44px] text-sm font-semibold border transition-colors ${on === id ? 'bg-slate-950 text-white border-slate-950' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`} data-testid={`showcase-tab-${id}`}><I className="w-4 h-4" />{label}</button>
          ))}
        </div>
        <p className="text-sm text-slate-600 mt-4" data-testid="showcase-caption">{cur[3]}</p>
        <Reveal key={on} className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_-30px_rgba(15,23,42,.35)] overflow-hidden max-w-[420px] md:max-w-none mx-auto" data-testid={`showcase-shot-${on}`}>
          <picture>
            <source media="(max-width: 767px)" srcSet={SHOT(on, 'phone')} />
            <img src={SHOT(on, 'desktop')} alt={`CloudIVR ${cur[2]} screen`} loading="lazy" decoding="async" className="w-full h-auto block" width="1440" height="900" />
          </picture>
        </Reveal>
        <p className="text-xs text-slate-500 mt-3">Screens from the CloudIVR app with sample numbers and names.</p>
      </div>
    </section>
  );
}
