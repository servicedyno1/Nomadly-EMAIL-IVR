import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './kit';
import { cp } from '../../paths';
import { AUDIENCES } from '../for/audiences';

// Five audience cards, each opening its own page. `skip` hides the page you are already on.
export function WhoFor({ skip, title = 'Who it’s for', sub = 'Pick the one that sounds like you. Each page shows how people like you set it up.' }) {
  const list = AUDIENCES.filter(a => a.slug !== skip);
  return (
    <section id="who" className="bg-white scroll-mt-16 border-t border-slate-100" data-testid="who-for-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">{title}</h2><p className="text-slate-600 mt-3 max-w-2xl">{sub}</p></Reveal>
        <div className={`grid gap-4 mt-10 sm:grid-cols-2 ${list.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`} data-testid="who-for-grid">
          {list.map((a, i) => (
            <Reveal key={a.slug} delay={i * 60}>
              <Link to={cp(`/for/${a.slug}`)} className="group h-full flex flex-col rounded-2xl border border-slate-200 bg-white p-6 transition-[border-color,box-shadow,transform] duration-200 hover:border-[#1d6fd8] hover:shadow-[0_20px_44px_-30px_rgba(15,23,42,.45)] hover:-translate-y-0.5" data-testid={`who-for-${a.slug}`}>
                <span className="w-10 h-10 rounded-xl bg-[#edf4ff] grid place-items-center"><a.icon className="w-5 h-5 text-[#1d6fd8]" aria-hidden="true" /></span>
                <span className="block font-semibold text-slate-950 mt-5">{a.short}</span>
                <span className="block text-sm text-slate-600 mt-2 flex-1">{a.card}</span>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1d6fd8] mt-5 min-h-[44px]">See how<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
