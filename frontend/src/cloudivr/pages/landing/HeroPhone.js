import React, { useEffect, useState } from 'react';
import { PhoneIncoming, MessageSquareText, Bot, Star } from 'lucide-react';
import { useApi } from '../../api';
import { Reveal } from './kit';

const SCENES = [
  ['call', PhoneIncoming, 'Incoming call', '+1 415 555 0182', 'Keypad menu answered · “Press 1 for sales”'],
  ['text', MessageSquareText, 'New text', 'Maria · +1 312 555 0119', '“Can I book for Friday at 3?”'],
  ['ai', Bot, 'AI agent replied', 'Booked · Friday 3:00 PM', '“You’re all set, Maria — see you Friday!”'],
];

// Hero phone: a call, a text, then the AI agent's reply, on a loop (static for reduced motion).
export function HeroPhone() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setI(x => (x + 1) % SCENES.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative mx-auto mt-14 w-[260px] sm:w-[280px]" aria-label="A call, a text and an AI reply on a phone" role="img" data-testid="hero-phone">
      <div className="rounded-[40px] border-[6px] border-[#2a2f36] bg-[#13171c] p-3 shadow-[0_40px_80px_-30px_rgba(0,0,0,.9)]">
        <div className="mx-auto w-24 h-5 rounded-full bg-[#23272d]" />
        <div className="h-[300px] mt-4 flex flex-col gap-3">
          <div className="text-center text-[11px] text-[#8593a8]">CloudIVR · now</div>
          {SCENES.map(([id, Icon, title, who, body], k) => (
            <div key={id} className={`rounded-2xl border p-3 text-left transition-all duration-500 ${k <= i ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'} ${k === i ? 'border-[#64acff] bg-[#64acff]/10' : 'border-[#343a42] bg-[#23272d]'}`} data-testid={`hero-phone-${id}`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-white"><Icon className={`w-4 h-4 ${['text-[#daff7c]', 'text-[#ffa3bb]', 'text-[#64acff]'][k]}`} />{title}</div>
              <div className="text-[11px] text-[#b4bfce] mt-1">{who}</div>
              <div className="text-[12px] text-white mt-1 leading-snug">{body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Real customer reviews (4–5 stars). Hidden until at least one exists — never placeholder quotes.
export function Reviews() {
  const { data } = useApi('/public/reviews');
  const list = data?.reviews || [];
  if (!list.length) return null;
  return (
    <section className="civr-l-cream py-24 border-t civr-l-rule" data-testid="reviews-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl">What customers say</h2></Reveal>
        <div className="grid md:grid-cols-3 gap-5 mt-10">
          {list.slice(0, 6).map((r, i) => (
            <Reveal key={`${r.name}-${i}`} delay={i * 70} className={`civr-np-card civr-np-${['blue', 'green', 'pink'][i % 3]}`} data-testid={`review-card-${i}`}>
              <div className="flex gap-0.5 civr-np-accent" aria-label={`${r.rating} out of 5 stars`}>{Array.from({ length: r.rating }).map((_, k) => <Star key={k} className="w-4 h-4 fill-current" />)}</div>
              <p className="text-[17px] mt-4 leading-relaxed text-slate-900">“{r.text}”</p>
              <div className="text-sm text-slate-500 mt-5">{r.name}{r.role ? ` · ${r.role}` : ''}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
