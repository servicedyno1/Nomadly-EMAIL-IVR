import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Globe2, PhoneCall, Wallet, Languages, ChevronLeft, ChevronRight, Hash, Workflow, Megaphone, Zap, Headphones, Server, Bot, Captions, MessageSquareText, ArrowRight, Star } from 'lucide-react';
import { Reveal, Slide } from './kit';
import { goTo, hrefOf } from './menu';
import { useStart } from './PricingFaq';
import { PROOF } from './ownerProof';

const ART = (n) => `${process.env.PUBLIC_URL || ''}/cloudivr/art/${n}.webp`;

// Only facts that are true today; owner-supplied proof (PROOF) appears when filled in.
export function TrustStrip({ catalog }) {
  const n = catalog?.countries?.length || 17;
  const facts = [[Globe2, `${n} countries`, 'Local, mobile and toll-free numbers'], [PhoneCall, 'Free test call', 'Hear it on your own phone, no card'], [Wallet, 'Crypto & wallet', 'Pay with 8 coins or your balance'], [Languages, 'EN · ES · FR', 'App and voice in three languages']];
  return (
    <section className="py-12 md:py-16 border-b civr-l-rule" data-testid="trust-strip">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-4">
          {PROOF.customers ? <p className="text-lg font-semibold" data-testid="proof-customers">{`Join ${PROOF.customers} businesses that run their phones on CloudIVR`}</p> : <p className="text-lg font-semibold" data-testid="trust-title">Everything a business phone line needs, ready in minutes</p>}
          {PROOF.rating && <span className="v2-chip mt-3" data-testid="proof-rating"><Star className="w-4 h-4 fill-current" />{`${PROOF.rating.score} on ${PROOF.rating.site}`}</span>}
        </div>
        <div className="lg:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-5">
          {facts.map(([I, t, s], i) => (
            <div key={t} data-testid={`trust-fact-${i}`}><I className="w-5 h-5 v2-link" /><div className="font-semibold mt-2">{t}</div><div className="text-sm v2-muted mt-0.5">{s}</div></div>
          ))}
        </div>
        {PROOF.logos?.length > 0 && <div className="lg:col-span-12 flex flex-wrap gap-8 items-center opacity-80" data-testid="proof-logos">{PROOF.logos.map(l => <img key={l.name} src={l.src} alt={l.name} className="h-8 w-auto" />)}</div>}
      </div>
    </section>
  );
}

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

const CHANNELS = [[Hash, 'Phone numbers', 'Local, mobile and toll-free numbers in many countries.', '#coverage'], [Workflow, 'IVR menus', 'Press 1 for sales, 2 for support.', 'ivr'], [Megaphone, 'Bulk campaigns', 'Call a whole list and connect the hot leads.', 'campaigns'], [Zap, 'Quick IVR', 'Call up to 10 people with one message.', 'campaigns'], [Headphones, 'Browser phone', 'Make and take calls in any browser tab.', 'phone'], [Server, 'SIP', 'Sign in from a desk phone or softphone.', 'phone'], [Bot, 'AI agents', 'A voice that answers, books and follows up.', 'ai'], [Captions, 'Text-to-voice', 'Type and a natural voice speaks for you.', 'text'], [MessageSquareText, 'Landline to Texting', 'Customers text the office number you already have.', 'hosted']];
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

export function FinalCtaV2() {
  const start = useStart();
  return (
    <section className="py-16 md:py-24" data-testid="final-cta">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
        <Reveal className="v2-hero rounded-[32px] overflow-hidden grid md:grid-cols-2 items-center">
          <div className="p-8 sm:p-12 lg:p-16">
            <h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl">Ready to answer every call?</h2>
            <p className="v2-muted mt-4 text-lg">Free to sign up. Your number can be live in minutes, no contracts.</p>
            <div className="flex flex-col sm:flex-row gap-3 mt-8">
              <Link to={start()} className="civr-l-pill civr-l-pill-ink" data-testid="final-cta-button"><Slide>Sign up free</Slide><ArrowRight className="w-4 h-4" /></Link>
              <Link to={start('texting')} className="civr-l-pill civr-l-pill-outline" data-testid="final-cta-texting-button"><Slide>Start texting</Slide></Link>
            </div>
          </div>
          <div className="v2-art m-4 md:m-6 aspect-[3/2]"><img src={ART('landline')} alt="" loading="lazy" className="w-full h-full object-cover" /></div>
        </Reveal>
      </div>
    </section>
  );
}
