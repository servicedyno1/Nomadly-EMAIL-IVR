import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneIncoming, PhoneOutgoing, Sparkles } from 'lucide-react';
import { Reveal } from './kit';
import { cp } from '../../paths';

const CHAT = [
  ['you', 'We’re a dental clinic. Call last month’s no-shows and rebook them.'],
  ['emily', 'Done — Ava from Bright Smile will call 48 patients from +1 (415) 555-0100, weekdays 10am–6pm, and hand anyone who wants a person to your front desk.'],
  ['emily', 'Want to hear Ava first? I’ll ring your phone — the test call is free.'],
];

function EmilyChat() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-[0_30px_60px_-40px_rgba(15,23,42,.35)]" data-testid="landing-ai-emily-chat">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
        <span className="w-9 h-9 rounded-full bg-[#1d6fd8] text-white grid place-items-center"><Sparkles className="w-4 h-4" aria-hidden="true" /></span>
        <div><div className="font-semibold text-slate-950 text-sm">Emily</div><div className="text-xs text-slate-500">Your setup assistant · every plan</div></div>
      </div>
      <ul className="space-y-3 pt-4">
        {CHAT.map(([who, text], i) => (
          <Reveal as="li" key={text} delay={i * 220} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${who === 'you' ? 'ml-auto bg-slate-900 text-white rounded-br-md' : 'bg-[#edf4ff] text-slate-800 rounded-bl-md'}`} data-testid={`landing-ai-chat-${i}`}>{text}</Reveal>
        ))}
      </ul>
    </div>
  );
}

function Way({ Icon, label, title, text, price, testid }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6" data-testid={testid}>
      <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl bg-[#edf4ff] grid place-items-center"><Icon className="w-5 h-5 text-[#1d6fd8]" aria-hidden="true" /></span><span className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500">{label}</span></div>
      <div className="font-semibold text-slate-950 mt-4">{title}</div>
      <p className="text-sm text-slate-600 mt-2">{text}</p>
      {price && <div className="text-sm font-semibold text-slate-900 mt-4" data-testid={`${testid}-price`}>{price}</div>}
    </div>
  );
}

// One AI, both directions — set up by chatting with Emily.
export function AiSection({ catalog }) {
  const r = catalog?.rates || {};
  return (
    <section id="ai" className="bg-white scroll-mt-16 border-t border-slate-100" data-testid="landing-ai-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-24 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <div>
          <Reveal>
            <div className="text-xs font-semibold uppercase tracking-[.14em] text-[#1d6fd8]">New · AI conversations</div>
            <h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950 mt-3">Tell Emily what you need. She sets it up.</h2>
            <p className="text-slate-600 mt-4 max-w-xl">No forms to learn. Describe it in a sentence — Emily builds the keypad menu, the call or the whole campaign, and you press save.</p>
          </Reveal>
          <div className="grid sm:grid-cols-2 gap-4 mt-8">
            <Way Icon={PhoneIncoming} label="Incoming" title="AI receptionist" text="Picks up 24/7, answers questions, books visits and takes messages — in 20 languages." price="Every plan" testid="landing-ai-receptionist" />
            <Way Icon={PhoneOutgoing} label="Outgoing" title="AI conversation campaigns" text="Calls your list, talks with each lead and hands the interested ones to you. Hear it on your own phone first." price={r.aiAgentPerMin != null ? `${usd(r.aiAgentPerMin)}/min · Pro and up` : 'Pro and up'} testid="landing-ai-campaigns" />
          </div>
          <Link to={cp('/signup')} className="inline-flex items-center gap-2 text-sm font-semibold text-[#1d6fd8] mt-8 min-h-[44px]" data-testid="landing-ai-cta">Try Emily free<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
        </div>
        <EmilyChat />
      </div>
    </section>
  );
}
