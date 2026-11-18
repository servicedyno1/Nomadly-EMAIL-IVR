import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import { Reveal } from './kit';
import { cp } from '../../paths';
import { AUDIENCES } from '../for/audiences';

// Real app screen shown for each audience (public/cloudivr/shots).
const SHOT = { nomads: 'numbers', founders: 'ivr', 'small-business': 'overview', teams: 'live', sales: 'campaigns' };
const src = (f, v) => `${process.env.PUBLIC_URL || ''}/cloudivr/shots/${f}-${v}.webp`;

// Who it's for, as tabs: the copy and the screen change in place; "See how" opens the audience page.
export function UseCases() {
  const [i, setI] = useState(0);
  const a = AUDIENCES[i];
  const shot = SHOT[a.slug] || 'overview';
  return (
    <section id="who" className="lx-soft scroll-mt-16" data-testid="who-for-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-28">
        <Reveal className="max-w-3xl"><div className="civr-l-eyebrow">Who it’s for</div><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl text-slate-950 mt-4">Set up the way you work.</h2></Reveal>
        <div role="tablist" aria-label="Who it’s for" className="flex gap-2 mt-10 overflow-x-auto civr-no-scrollbar -mx-6 px-6 md:mx-0 md:px-0" data-testid="who-for-grid">
          {AUDIENCES.map((x, k) => <button key={x.slug} type="button" role="tab" aria-selected={k === i} onClick={() => setI(k)} className="lx-tabbtn shrink-0" data-testid={`who-for-${x.slug}`}><x.icon className="w-4 h-4" aria-hidden="true" />{x.short}</button>)}
        </div>
        <div key={a.slug} className="civr-tab-panel grid lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] gap-10 lg:gap-14 items-center mt-10" role="tabpanel" data-testid={`who-for-panel-${a.slug}`}>
          <div>
            <h3 className="text-2xl sm:text-3xl font-bold text-slate-950">{a.title.join('')}</h3>
            <p className="text-base text-slate-600 mt-4 leading-relaxed">{a.sub}</p>
            <ul className="mt-8 space-y-5">
              {a.features.slice(0, 3).map(([I, t, s]) => <li key={t} className="flex gap-4"><span className="w-10 h-10 rounded-xl bg-[#edf4ff] grid place-items-center shrink-0"><I className="w-5 h-5 text-[#1d6fd8]" aria-hidden="true" /></span><span><span className="block font-semibold text-slate-950">{t}</span><span className="block text-sm text-slate-600 mt-0.5">{s}</span></span></li>)}
            </ul>
            <Link to={cp(`/for/${a.slug}`)} className="group inline-flex items-center gap-2 text-sm font-semibold text-[#1d6fd8] mt-8 min-h-[44px]" data-testid={`who-for-link-${a.slug}`}>See how {a.short.toLowerCase()} set it up<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></Link>
          </div>
          <div className="civr-l-frame" data-testid="who-for-frame">
            <div className="civr-l-frame-bar" aria-hidden="true"><span className="flex gap-1.5"><i /><i /><i /></span><span className="civr-l-frame-url"><Lock className="w-3 h-3" />cloudivr.net/app</span></div>
            <picture>
              <source media="(max-width: 767px)" srcSet={src(shot, 'phone')} />
              <img src={src(shot, 'desktop')} alt={`CloudIVR ${shot} screen`} width="1440" height="900" loading="lazy" decoding="async" className="block w-full aspect-[4/5] md:aspect-[16/10] object-cover object-top" data-testid={`who-for-shot-${shot}`} />
            </picture>
          </div>
        </div>
      </div>
    </section>
  );
}
