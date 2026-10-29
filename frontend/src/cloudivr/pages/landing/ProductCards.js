import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Reveal } from './kit';
import { PRODUCTS, goTo, hrefOf } from './menu';

// Like a coin card: name + short tag, "Works on" chips, three facts, Learn more.
const CARDS = {
  numbers: ['NUM', ['Browser', 'Telegram bot'], ['Local, mobile and toll-free numbers in many countries.', 'Calls ring in your browser, on a SIP phone or forward anywhere.', 'Keep it monthly — no contracts.']],
  ivr: ['IVR', ['Browser', 'Telegram bot'], ['Press 1, 2, 3 menus with your own recording or an AI voice.', 'Route callers to people, voicemail or other numbers.', 'Change it any time — live in seconds.']],
  ai: ['AI', ['Browser'], ['Answers in natural speech, day and night.', 'Takes messages and books appointments.', 'Can introduce itself as an AI, and hands over on request.']],
  campaigns: ['IVR+', ['Browser', 'Telegram bot'], ['Upload a list and call everyone with one message.', 'Watch progress live; anyone who presses 1 is connected to you.', 'Do-not-call list is honoured automatically.']],
  phone: ['SIP', ['Browser', 'Softphone', 'Desk phone'], ['Call and answer from any browser tab.', 'Sign in from a softphone or desk phone with SIP.', 'Included on every plan.']],
  text: ['TTS', ['Browser'], ['Type and a natural voice speaks for you on a real call.', 'Read what they say as live captions.', 'Great for quiet offices and noisy streets.']],
  hosted: ['SMS', ['Browser'], ['Turn on texting for the landline you already have.', 'Calls stay with your current carrier.', 'Read and reply to every text in the app.']],
  inbox: ['INBOX', ['Browser', 'Telegram bot'], ['Every text and voicemail in one place.', 'Voicemails arrive transcribed.', 'Reply to texts in one tap.']],
};

export function ProductCards() {
  const track = useRef(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = () => { const t = track.current; if (t) setEdge({ start: t.scrollLeft < 8, end: t.scrollLeft + t.clientWidth >= t.scrollWidth - 8 }); };
  useEffect(() => { update(); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }, []);
  const go = (d) => track.current?.scrollBy({ left: d * Math.min(380, track.current.clientWidth), behavior: 'smooth' });
  return (
    <section className="civr-l-cream py-24 border-t civr-l-rule" data-testid="product-cards-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <div className="flex items-end justify-between gap-6">
          <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl">Our most popular tools</h2></Reveal>
          <div className="flex gap-3 shrink-0">
            <button type="button" className="civr-np-arrow" onClick={() => go(-1)} disabled={edge.start} aria-label="Previous" data-testid="product-cards-prev"><ArrowLeft className="w-5 h-5" /></button>
            <button type="button" className="civr-np-arrow" onClick={() => go(1)} disabled={edge.end} aria-label="Next" data-testid="product-cards-next"><ArrowRight className="w-5 h-5" /></button>
          </div>
        </div>
        <div ref={track} onScroll={update} className="civr-np-track mt-10" data-testid="product-cards-track">
          {PRODUCTS.map(([id, Icon, title, , target]) => {
            const [tag, on, facts] = CARDS[id];
            return (
              <article key={id} className="civr-l-card-cream p-6 flex flex-col w-[340px] max-w-[84vw] shrink-0" data-testid={`product-card-${id}`}>
                <div className="flex items-center gap-3">
                  <span className="w-12 h-12 rounded-full bg-slate-100 text-slate-900 grid place-items-center shrink-0"><Icon className="w-5 h-5" /></span>
                  <div className="min-w-0"><div className="text-xl font-bold leading-tight">{title}</div><div className="text-sm text-slate-500 font-semibold tracking-wider">{tag}</div></div>
                </div>
                <div className="mt-5 text-sm text-slate-500">Works on:</div>
                <div className="flex flex-wrap gap-2 mt-2">{on.map(x => <span key={x} className="text-sm px-2.5 py-1 rounded-md bg-slate-100 text-slate-700">{x}</span>)}</div>
                <ul className="mt-6 space-y-3 text-[15px] text-slate-600 flex-1">{facts.map(f => <li key={f} className="pl-4 relative before:content-[''] before:absolute before:left-0 before:top-[9px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-[color:var(--np-lime)]">{f}</li>)}</ul>
                <a href={hrefOf('', target)} onClick={(e) => goTo(target, e)} className="mt-6 min-h-[44px] inline-flex items-center text-[15px] font-semibold underline underline-offset-4 decoration-[color:var(--np-blue)] hover:text-slate-600 self-start" data-testid={`product-card-${id}-more`}>Learn more</a>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
