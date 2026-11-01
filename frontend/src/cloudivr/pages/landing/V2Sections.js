import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Hash, Workflow, Megaphone, Zap, Headphones, Server, Bot, Captions, MessageSquareText, ArrowRight, Smartphone } from 'lucide-react';
import { Reveal } from './kit';
import { goTo, hrefOf } from './menu';
import { PROOF } from './ownerProof';

const ART = (n) => `${process.env.PUBLIC_URL || ''}/cloudivr/art/${n}.webp`;

const PILLARS = [
  ['calls', 'Every call answered', 'A keypad menu routes callers in a second, voicemail is transcribed and calls ring your browser, desk phone or mobile.', 'ivr', 'See keypad menus'],
  ['outreach', 'Automate outreach', 'Bulk IVR and Quick IVR call your list, play your message and connect everyone who presses 1 straight to you.', 'campaigns', 'See campaigns'],
  ['ai', 'AI that talks for you', 'An AI voice agent answers around the clock, books visits and takes messages in 20 languages.', 'ai', 'See AI agents'],
];
export function Pillars() {
  return (
    <section className="py-16 md:py-28" data-testid="pillars">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl max-w-3xl">One phone line that answers, calls and talks for you</h2></Reveal>
        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {PILLARS.map(([art, t, s, target, cta], i) => (
            <Reveal key={art} delay={i * 100} className="v2-surface p-4 flex flex-col v2-lift" data-testid={`pillar-${art}`}>
              <div className="v2-art aspect-[4/3]"><img src={ART(art)} alt="" loading="lazy" className="w-full h-full object-cover" /></div>
              <div className="px-3 pt-6 pb-3 flex-1 flex flex-col">
                <h3 className="civr-l-h text-2xl">{t}</h3>
                <p className="v2-muted mt-3 leading-relaxed flex-1">{s}</p>
                <a href={hrefOf('', target)} onClick={(e) => goTo(target, e)} className="v2-link font-semibold mt-5 inline-flex items-center gap-1.5 py-2" data-testid={`pillar-${art}-link`}>{cta}<ArrowRight className="w-4 h-4" /></a>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const CHANNELS = [[Hash, 'Phone numbers', 'Local, mobile and toll-free numbers in many countries.', '#coverage'], [Workflow, 'IVR menus', 'Press 1 for sales, 2 for support.', 'ivr'], [Megaphone, 'Bulk campaigns', 'Call a whole list and connect the hot leads.', 'campaigns'], [Zap, 'Quick IVR', 'Call up to 10 people with one message.', 'campaigns'], [Headphones, 'Browser phone', 'Make and take calls in any browser tab.', 'phone'], [Server, 'SIP', 'Sign in from a desk phone or softphone.', 'phone'], [Bot, 'AI agents', 'A voice that answers, books and follows up.', 'ai'], [Captions, 'Text-to-voice', 'Type and a natural voice speaks for you.', 'text'], [MessageSquareText, 'Landline to Texting', 'Customers text the office number you already have.', 'hosted'], [Smartphone, 'CloudIVR eSIM', 'A US mobile line on your phone, ready instantly.', '#esim']];
export function ChannelSlider() {
  const rail = useRef(null);
  const move = (d) => rail.current?.scrollBy({ left: d * 280, behavior: 'smooth' });
  return (
    <section className="v2-soft py-16 md:py-24" data-testid="channel-slider">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl max-w-2xl">Reach customers on every line</h2></Reveal>
          <div className="hidden sm:flex gap-2">
            <button type="button" onClick={() => move(-1)} className="w-12 h-12 rounded-full border civr-l-rule grid place-items-center hover:bg-[color:var(--np-tint)]" aria-label="Previous" data-testid="channel-prev"><ChevronLeft className="w-5 h-5" /></button>
            <button type="button" onClick={() => move(1)} className="w-12 h-12 rounded-full border civr-l-rule grid place-items-center hover:bg-[color:var(--np-tint)]" aria-label="Next" data-testid="channel-next"><ChevronRight className="w-5 h-5" /></button>
          </div>
        </div>
        <div ref={rail} className="v2-rail mt-10" data-testid="channel-rail">
          {CHANNELS.map(([I, t, s, target], i) => (
            <a key={t} href={hrefOf('', target)} onClick={(e) => goTo(target, e)} className="v2-surface p-6 min-h-[180px] flex flex-col v2-lift" data-testid={`channel-${i}`}>
              <span className="w-11 h-11 rounded-2xl grid place-items-center v2-hero"><I className="w-5 h-5" /></span>
              <span className="font-semibold text-lg mt-5">{t}</span><span className="text-sm v2-muted mt-1.5">{s}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Quotes() {
  if (!PROOF.quotes?.length) return null;
  return (
    <section className="py-16 md:py-24" data-testid="proof-quotes">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 grid md:grid-cols-3 gap-6">
        {PROOF.quotes.slice(0, 3).map((q, i) => (
          <figure key={i} className="v2-surface p-8" data-testid={`proof-quote-${i}`}><blockquote className="text-lg leading-relaxed">{`“${q.text}”`}</blockquote><figcaption className="v2-muted text-sm mt-5">{`${q.name} · ${q.role}, ${q.company}`}</figcaption></figure>
        ))}
      </div>
    </section>
  );
}
