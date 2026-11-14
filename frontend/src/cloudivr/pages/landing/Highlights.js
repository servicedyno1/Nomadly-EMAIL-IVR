import React from 'react';
import { Reveal } from './kit';
import { Sparkle, Circled } from './Doodles';

const PROMISES = [
  ['Live in minutes', 'Numbers, IVR and SIP set up for you', 'text-lime-300'],
  ['Verified caller ID', 'On Business: softphone, browser and campaigns', 'text-pink-400'],
  ['No contract', 'Month to month, pay with crypto or wallet', 'text-sky-400'],
  ['Real humans', 'Support on Telegram and live chat', 'text-[#64acff]'],
];

// Dark band with four bold coloured promises.
export function PromiseStrip() {
  return (
    <section className="bg-white py-10 sm:py-12" data-testid="promise-strip">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <Reveal className="civr-l-ondark relative overflow-hidden rounded-3xl bg-[#07060f] px-6 py-10 ring-1 ring-white/10 sm:px-10 lg:py-12">
          <h2 className="sr-only">What you get with CloudIVR</h2>
          <Sparkle className="right-6 top-5 w-5 h-5 text-lime-300" />
          <Sparkle className="bottom-5 left-[46%] w-3 h-3 text-pink-400" delay={-1.4} />
          <ul className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-white/10">
            {PROMISES.map(([t, s, c], i) => (
              <li key={t} className="lg:px-8 lg:first:pl-0 lg:last:pr-0" data-testid={`promise-${i}`}>
                <p className={`text-3xl xl:text-4xl font-extrabold leading-tight tracking-tight ${c}`}>{t}</p>
                <p className="mt-2 text-sm text-slate-300">{s}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

const PILLS = ['Keypad menu (IVR)', 'Call forwarding', 'SIP softphone logins', 'Browser phone', 'Voicemail + transcripts', 'Call recording', 'Bulk IVR campaigns', 'AI voice agent', 'Fax', 'Ring groups', 'Text Triggers', 'Live call map', 'Crypto payments'];
const LOOK = [
  'border-lime-400 bg-lime-300 text-lime-950',
  'border-pink-300 bg-pink-200 text-pink-950 -rotate-2',
  'border-sky-400 bg-white text-sky-800',
  'border-slate-200 bg-white text-slate-800 rotate-1',
  'border-[#1d6fd8]/40 bg-[#e0edff] text-[#0f4396]',
];

// "Everything you need, and more": tilted colourful feature tags.
export function FeaturePills() {
  return (
    <section className="relative overflow-hidden bg-white py-20 md:py-24 border-t civr-l-rule" data-testid="feature-pills">
      <Sparkle className="right-[14%] top-16 w-5 h-5 text-sky-400" />
      <Sparkle className="bottom-16 left-[12%] w-4 h-4 text-pink-400" delay={-1.6} />
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <div className="civr-l-eyebrow">Included</div>
          <h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950 mt-3" data-testid="feature-pills-title">Everything you need, <Circled>and more</Circled></h2>
          <p className="text-slate-600 mt-4">One account, all the tools below. The plan table shows which plan unlocks each one.</p>
        </Reveal>
        <ul className="mx-auto mt-10 flex max-w-5xl flex-wrap justify-center gap-3" data-testid="feature-pills-list">
          {PILLS.map((p, i) => (
            <Reveal as="li" key={p} delay={Math.min(i, 10) * 40} data-testid={`feature-pill-${i}`}>
              <span className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 py-2 text-sm sm:text-base font-semibold shadow-sm transition-[translate,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-md ${LOOK[i % LOOK.length]}`}>{p}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
