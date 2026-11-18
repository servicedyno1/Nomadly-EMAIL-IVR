import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Workflow, Megaphone, MessageSquareText, Printer, Smartphone } from 'lucide-react';
import { Reveal, Wave, useInView, useStep } from './kit';
import { goTo } from './menu';
import { cp } from '../../paths';
import { openEsimCheckout } from './EsimCheckout';

const more = 'inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-[#8ec0ff] hover:text-white transition-colors mt-4';

function Tile({ id, span, Icon, title, text, children, action, delay }) {
  return (
    <Reveal delay={delay} className={`lx-tile ${span}`} data-testid={`feature-tile-${id}`}>
      <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl grid place-items-center bg-white/10"><Icon className="w-5 h-5 text-[#8ec0ff]" aria-hidden="true" /></span><h3 className="text-lg font-semibold text-white">{title}</h3></div>
      <p className="text-sm text-slate-300 mt-3 max-w-md">{text}</p>
      <div className="mt-5 flex-1" aria-hidden="true">{children}</div>
      {action}
    </Reveal>
  );
}

function KeysDemo() {
  const [ref, inView] = useInView({ once: false });
  const lit = ['1', '2', '3'][useStep(inView, 3, 1400)];
  const labels = { 1: 'Sales', 2: 'Support', 3: 'Voicemail' };
  return (
    <div ref={ref} className="lx-demo">
      <div className="text-xs text-slate-300 mb-3">“Press 1 for sales, 2 for support…”</div>
      <div className="grid grid-cols-3 gap-2">{['1', '2', '3', '4', '5', '6'].map(k => <span key={k} className={`lx-key ${lit === k ? 'lit' : ''}`}>{k}</span>)}</div>
      <div className="text-xs font-semibold text-emerald-300 mt-3">Key {lit} → {labels[lit]}</div>
    </div>
  );
}

const QR = '111o11 1o1o1o 11o111 o1o1oo 1o11o1 11o1o1'.replace(/ /g, '').split('');

// The products as tiles, each with a small demo instead of a paragraph.
export function Bento({ fax }) {
  return (
    <section id="features" className="lx-dark scroll-mt-16" data-testid="features-section">
      <div className="lx-glow" aria-hidden="true" /><div className="lx-grain" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-32">
        <Reveal className="max-w-3xl"><div className="civr-l-eyebrow">The product</div><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl mt-4">Everything a phone line should do. On one number.</h2></Reveal>
        <div className="grid lg:grid-cols-6 gap-4 mt-14">
          <Tile id="ai" span="lg:col-span-3" Icon={Bot} title="AI receptionist" text="Picks up day and night, answers questions, books visits and takes messages, in 20 languages."
            action={<a href={`${cp()}#ai`} onClick={(e) => goTo('#ai', e)} className={more} data-testid="feature-tile-ai-link">See how it is set up<ArrowRight className="w-4 h-4" aria-hidden="true" /></a>}>
            <div className="lx-demo space-y-2"><div className="flex items-center gap-2 text-xs text-emerald-300 font-semibold"><Wave on />On a call now</div><div className="lx-bubble me">Do you open on Saturdays?</div><div className="lx-bubble ai">Yes, 9 to 1. Shall I book you in?</div></div>
          </Tile>
          <Tile id="ivr" span="lg:col-span-3" Icon={Workflow} title="Keypad menu" text="Write a greeting, pick a voice and send each key to the right person, message or voicemail." delay={80}
            action={<Link to={cp('/pricing')} className={more} data-testid="feature-tile-ivr-link">Which plans include it<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>}>
            <KeysDemo />
          </Tile>
          <Tile id="campaigns" span="lg:col-span-2" Icon={Megaphone} title="Campaigns" text="Call a whole list with a recorded message or an AI conversation, and watch every call live." delay={120}>
            <div className="lx-demo space-y-4">{[['Ringing', '42%'], ['Talking', '68%'], ['Finished', '90%']].map(([l, w]) => <div key={l}><div className="text-xs text-slate-300 mb-1.5">{l}</div><div className="lx-bar"><i style={{ '--w': w }} /></div></div>)}</div>
          </Tile>
          <Tile id="texting" span="lg:col-span-2" Icon={MessageSquareText} title="Calls + texting" text="Two-way texts and calls on one number, read and answered in your browser." delay={180}
            action={<Link to={cp('/pricing#pricing-mobile')} className={more} data-testid="feature-tile-texting-link">Texting numbers<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>}>
            <div className="lx-demo space-y-2"><div className="lx-bubble ai">Your order is ready for pickup.</div><div className="lx-bubble me">Great, on my way!</div></div>
          </Tile>
          <Tile id="fax" span="lg:col-span-2" Icon={Printer} title="Fax online" text={`Send and receive faxes as PDFs. ${fax?.freePages ?? 25} free pages a month.`} delay={240}
            action={<Link to={cp('/pricing#pricing-fax')} className={more} data-testid="feature-tile-fax-link">Fax numbers<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>}>
            <div className="lx-demo grid place-items-center"><div className="lx-page"><i /><i style={{ width: '60%' }} /><i /><i style={{ width: '45%' }} /><i /><i style={{ width: '70%' }} /></div></div>
          </Tile>
          <Reveal delay={120} className="lx-tile lg:col-span-6 sm:!flex-row sm:items-center gap-6" data-testid="feature-tile-esim">
            <div className="lx-qr shrink-0" aria-hidden="true">{QR.map((c, i) => <i key={i} className={c === 'o' ? 'o' : ''} />)}</div>
            <div className="flex-1"><div className="flex items-center gap-3"><Smartphone className="w-5 h-5 text-[#8ec0ff]" aria-hidden="true" /><h3 className="text-lg font-semibold text-white">USA eSIM</h3></div><p className="text-sm text-slate-300 mt-2 max-w-xl">A USA line on your own phone with unlimited data, calls and texts. Scan a QR code and it is installed.</p></div>
            <button type="button" onClick={() => openEsimCheckout()} className="civr-l-btn civr-l-btn-ghost shrink-0" data-testid="hero-order-esim">Order eSIM<ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
