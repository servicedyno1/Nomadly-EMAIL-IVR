import React from 'react';
import { PhoneCall, Bot, Smartphone, Plane, ArrowRight, MessageSquareText, Radio } from 'lucide-react';
import { Reveal } from './kit';

// How the services fit together: one number at the centre, everything else plugs into it.
const FLOW = [
  [PhoneCall, 'Get a number', 'USA, Canada or UK with every plan. Business adds the Netherlands, France and Spain. Live in minutes, no ID.'],
  [Radio, 'Answer anywhere', 'Calls ring your mobile, the browser phone or any SIP app. Voicemail and missed-call alerts reach you on Telegram and email.'],
  [Bot, 'Let it work for you', 'A keypad menu routes callers, the AI receptionist answers 24/7 for $0.10 a minute, and Quick IVR or campaigns call your list.'],
  [MessageSquareText, 'Text from the USA', 'A USA Texting Number with unlimited texts sits next to your line. International texting is coming soon.'],
  [Plane, 'Stay online abroad', 'Travel eSIM data in 187 countries from the same wallet, so you can still pick up while you travel.'],
];

export function Ecosystem() {
  return (
    <section className="py-20 md:py-28" id="how-it-fits" data-testid="landing-ecosystem">
      <div className="max-w-6xl mx-auto px-6">
        <Reveal>
          <div className="civr-l-kicker"><span className="civr-l-dot" />How it fits together</div>
          <h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950 mt-4 max-w-2xl">One number, and everything else plugs into it.</h2>
          <p className="text-slate-600 mt-3 max-w-2xl text-base md:text-lg">Start with a line. Add a menu, the AI receptionist, a texting number or travel data when you need them. One wallet pays for all of it, month to month.</p>
        </Reveal>
        <ol className="mt-12 grid md:grid-cols-2 lg:grid-cols-5 gap-4">
          {FLOW.map(([Icon, title, text], i) => (
            <Reveal key={title} delay={i * 70} as="li" className="civr-l-card-cream p-6 relative flex flex-col" data-testid={`landing-ecosystem-step-${i}`}>
              <span className="w-10 h-10 rounded-xl grid place-items-center bg-blue-50 text-blue-600"><Icon className="w-5 h-5" /></span>
              <span className="text-xs font-semibold text-slate-400 mt-5">{`Step ${i + 1}`}</span>
              <div className="font-semibold text-slate-900 mt-1">{title}</div>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">{text}</p>
              {i < FLOW.length - 1 && <ArrowRight className="hidden lg:block absolute -right-3 top-1/2 w-5 h-5 text-slate-300" aria-hidden />}
            </Reveal>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-slate-600" data-testid="landing-ecosystem-esim">
          <Smartphone className="w-4 h-4 text-blue-600" />Want texts and calls on your own phone in the USA? <a href="#esim-card" className="underline underline-offset-2 text-slate-900" data-testid="landing-ecosystem-esim-link">See the USA eSIM</a>
        </div>
      </div>
    </section>
  );
}
