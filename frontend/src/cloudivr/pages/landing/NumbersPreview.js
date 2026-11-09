import React from 'react';
import { Check, Hash, Workflow, KeyRound, Rocket, Phone, Smartphone, Megaphone, LayoutGrid } from 'lucide-react';
import { useInView, useStep } from './kit';
import { Sparkle } from './Doodles';

const ROWS = [
  [Phone, '+1 (888) 555-0142', 'Toll-free · Keypad menu on', 'Active'],
  [Hash, '+1 (415) 555-0199', 'Local · SIP softphone', 'Registered'],
  [Megaphone, 'Spring follow-up', 'Bulk IVR campaign · 1,240 calls', 'Running'],
  [Smartphone, 'USA eSIM', 'On your phone · Real carrier line', 'Active'],
];
const STEPS = [[Hash, 'Number', 'bought'], [Workflow, 'IVR', 'menu set'], [KeyRound, 'SIP', 'login ready'], [Rocket, 'Live', 'taking calls']];

function Pipeline({ step }) {
  return (
    <figure className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-xl shadow-slate-300/50" data-testid="preview-pipeline">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map(([I, t, s], k) => {
          const done = k <= step;
          return (
            <li key={t} className="flex min-w-0 flex-col sm:flex-row items-center gap-1 sm:gap-2 text-center sm:text-left" data-testid={`preview-step-${k}`} data-state={done ? 'done' : 'todo'}>
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${done ? 'border-emerald-500/30 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>{done ? <Check className="w-4 h-4" /> : <I className="w-4 h-4" />}</span>
              <span className="min-w-0"><span className="block text-xs sm:text-sm font-semibold text-slate-950">{t}</span><span className="hidden sm:block truncate text-[11px] text-slate-500">{s}</span></span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-gradient-to-r from-[#1d6fd8] to-emerald-500 transition-[width] duration-700 ease-out" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
      <figcaption className="mt-2 text-xs text-slate-500">One order, set up for you. Follow each step in your dashboard.</figcaption>
    </figure>
  );
}

// Sample "My numbers" panel under the hero, with a setup pipeline that fills in when it scrolls into view.
export function NumbersPreview() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, 5, 1100);
  return (
    <figure ref={ref} aria-label="Preview of the CloudIVR dashboard" className="relative mx-auto mt-14 max-w-4xl pb-2 lg:mt-16 px-1" data-testid="numbers-preview">
      <svg aria-hidden="true" viewBox="0 0 1200 420" preserveAspectRatio="none" className="pointer-events-none absolute -inset-x-[8%] top-[18%] h-[78%] w-[116%]" fill="none">
        <path d="M-30 330C160 120 340 420 560 250S930 20 1230 150" strokeWidth="34" strokeLinecap="round" stroke="#d9f99d" />
        <path d="M-30 330C160 120 340 420 560 250S930 20 1230 150" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 14" stroke="rgba(63,98,18,.4)" />
      </svg>
      <div aria-hidden="true" className="pointer-events-none absolute -left-44 top-4 hidden w-40 text-right xl:block">
        <span className="block -rotate-6 text-sm font-semibold italic text-lime-700">Everything in one place</span>
        <svg viewBox="0 0 120 90" className="ml-auto mt-1 h-16 w-20 rotate-[20deg] text-lime-600" fill="none"><path d="M6 14C40 2 78 10 74 38C71 58 44 60 48 42C52 24 92 30 104 70" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /><path d="M92 64L104 72L108 58" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <Sparkle className="-right-3 -top-4 z-10 w-6 h-6 text-pink-400" />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-2xl shadow-slate-300/50">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
          <span className="flex gap-1.5" aria-hidden="true"><i className="h-2.5 w-2.5 rounded-full bg-pink-400" /><i className="h-2.5 w-2.5 rounded-full bg-lime-400" /><i className="h-2.5 w-2.5 rounded-full bg-[#64acff]" /></span>
          <LayoutGrid className="w-4 h-4 text-[#1d6fd8]" aria-hidden="true" /><span className="text-sm font-bold text-slate-950">My numbers</span>
          <span className="ml-auto hidden gap-1 sm:flex" aria-hidden="true">{['All', 'Numbers', 'Campaigns', 'eSIM'].map((t, k) => <span key={t} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${k ? 'text-slate-500' : 'bg-[#1d6fd8] text-white'}`}>{t}</span>)}</span>
        </div>
        <ul>
          {ROWS.map(([I, name, sub, status], k) => (
            <li key={name} className="flex items-center gap-3 border-t border-slate-100 first:border-t-0 px-4 py-3" data-testid={`preview-row-${k}`}>
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#1d6fd8]"><I className="w-4 h-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-mono text-sm font-semibold text-slate-950" data-no-translate>{name}</span><span className="block truncate text-xs text-slate-500">{sub}</span></span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/15"><i className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />{status}</span>
            </li>
          ))}
        </ul>
        <div className="hidden h-12 lg:block" aria-hidden="true" />
      </div>
      <div className="relative mx-auto mt-4 max-w-2xl lg:-mt-12"><Pipeline step={Math.min(step, STEPS.length - 1)} /></div>
    </figure>
  );
}
