import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Phone, MessageSquareText, Voicemail, Bot } from 'lucide-react';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Reveal } from './kit';
import { PRODUCTS, goTo, hrefOf } from './menu';

const C = { b: '#64acff', p: '#ffa3bb', l: '#daff7c' };
const P = Object.fromEntries(PRODUCTS.map(p => [p[0], p]));
// Row recipes: product id + colour + filled?, or an empty / arrow pill.
const ROWS = [
  [['numbers', 'b', 0], ['_', 'p', 0, 'wide'], ['ivr', 'b', 1], ['>', 'l', 0, 0], ['ai', 'l', 1], ['campaigns', 'p', 0]],
  [['_', 'l', 1], ['phone', 'p', 0], ['text', 'l', 0], ['>', 'p', 1, 0], ['hosted', 'p', 1], ['_', 'b', 0, 'wide'], ['inbox', 'b', 0]],
];

function Bubble({ cell }) {
  const [id, c, filled, extra] = cell;
  const color = C[c];
  const style = { borderColor: color, background: filled ? color : 'transparent', color: filled ? '#13171c' : (c === 'b' ? color : '#fff') };
  if (id === '_') return <span aria-hidden="true" className={`civr-np-bubble ${extra === 'wide' ? 'civr-np-bubble-wide' : 'civr-np-bubble-empty'}`} style={style} />;
  if (id === '>') return <span aria-hidden="true" className="civr-np-bubble civr-np-bubble-empty" style={style}><ArrowRight className="w-5 h-5" style={{ transform: `rotate(${extra}deg)` }} /></span>;
  const [, , title, , target] = P[id];
  return <a href={hrefOf('', target)} onClick={(e) => goTo(target, e)} className="civr-np-bubble" style={style} data-testid={`bubble-${id}`}>{title}</a>;
}

// "All your phone tools" pill cloud, NOWPayments-style.
export function Bubbles() {
  const { account } = useCivrAuth();
  return (
    <section className="civr-l-cream py-24" data-testid="bubbles-section">
      <div className="max-w-6xl mx-auto px-6 text-center">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-[56px]">One phone line. Every tool.</h2></Reveal>
        <Reveal delay={80}><p className="civr-l-muted text-base md:text-xl mt-4 max-w-2xl mx-auto">Numbers, menus, AI agents, campaigns and texting — all in one account, ready in minutes.</p></Reveal>
        <div className="mt-14 space-y-4 hidden md:block" data-testid="bubbles-cloud">
          {ROWS.map((row, i) => <Reveal key={i} delay={120 + i * 80} className="flex gap-3 justify-center">{row.map((cell, k) => <Bubble key={k} cell={cell} />)}</Reveal>)}
        </div>
        <div className="mt-10 flex flex-wrap gap-3 justify-center md:hidden" data-testid="bubbles-cloud-mobile">
          {PRODUCTS.map(([id], i) => <Bubble key={id} cell={[id, 'bpl'[i % 3], i % 4 === 1]} />)}
        </div>
        <Reveal delay={260} className="flex flex-wrap justify-center gap-3 mt-12">
          <Link to={account ? cp('/app/buy') : cp('/signup')} className="civr-l-pill civr-l-pill-ink" data-testid="bubbles-cta-start">Start now</Link>
          <a href="#features" onClick={(e) => goTo('#features', e)} className="civr-l-pill civr-l-pill-outline" data-testid="bubbles-cta-more">See how it works</a>
        </Reveal>
      </div>
    </section>
  );
}

// Floating outlined circles on both sides of the hero (instead of coins: phone, text, voicemail, AI).
const ORBS = [
  ['left-[4%] top-[18%] w-16 h-16', C.l, Phone, ''], ['left-[11%] top-[46%] w-11 h-11', C.p, MessageSquareText, 'civr-l-float-2'],
  ['left-[2%] top-[66%] w-8 h-8', C.b, null, ''], ['right-[5%] top-[20%] w-14 h-14', C.b, Bot, 'civr-l-float-2'],
  ['right-[12%] top-[50%] w-12 h-12', C.l, Voicemail, ''], ['right-[3%] top-[70%] w-9 h-9', C.p, null, 'civr-l-float-2'],
];
export function HeroDecor() {
  return (
    <div className="absolute inset-0 pointer-events-none hidden lg:block" aria-hidden="true">
      {ORBS.map(([pos, color, Icon, f], i) => (
        <span key={i} className={`civr-np-orb civr-l-float ${f} ${pos}`} style={{ borderColor: color, color }}>{Icon && <Icon className="w-1/2 h-1/2" />}</span>
      ))}
    </div>
  );
}
