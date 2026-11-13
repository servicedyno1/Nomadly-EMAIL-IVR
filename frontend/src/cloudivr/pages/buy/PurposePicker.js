import React from 'react';
import { Link } from 'react-router-dom';
import { Phone, Server, MessageSquare, Printer, Check, ArrowRight, CircleCheck } from 'lucide-react';
import { money, useApi } from '../../api';
import { cp } from '../../paths';

const startPrice = (catalog, pick) => {
  const list = (catalog?.plans || []).filter(p => p.available !== false && pick(p)).map(p => p.price);
  return list.length ? Math.min(...list) : null;
};

// What each choice is, what it costs and what the account already owns.
export function usePurposeCards(catalog, myNums) {
  const { data: texting } = useApi('/mobile-numbers');
  const { data: fax } = useApi('/fax-numbers');
  const lines = (myNums?.numbers || []).filter(n => n.status === 'active' && !n.isSubNumber);
  const sipLines = lines.filter(n => n.access?.sipCredentials || /pro|business/i.test(n.plan || ''));
  const texts = (texting?.items || []).filter(x => !['failed', 'cancelled', 'released'].includes(x.status));
  const faxes = (fax?.numbers || []).filter(x => x.status !== 'released');
  const own = (n, one, many) => (n ? `You have ${n} ${n === 1 ? one : many}` : null);
  return [
    { id: 'voice', Icon: Phone, title: 'Voice', price: startPrice(catalog, () => true), what: 'A Business Line', points: ['Answer in your browser or forward to your phone', 'Keypad menus, voicemail and AI agents on bigger plans'], owned: own(lines.length, 'Business Line', 'Business Lines') },
    { id: 'sip', Icon: Server, title: 'SIP', price: startPrice(catalog, p => p.access?.sipCredentials), what: 'On a Business Line', points: ['Logins for desk phones and softphone apps', 'Comes with the Pro and Business plans'], owned: own(sipLines.length, 'line with SIP', 'lines with SIP') },
    { id: 'sms', Icon: MessageSquare, title: 'SMS', price: texting?.price || null, what: 'A Texting Number', points: ['A USA carrier number for texts and codes', 'Read and reply in Messages'], owned: own(texts.length, 'Texting Number', 'Texting Numbers'), off: texting && !texting.available && !texts.length },
    { id: 'fax', Icon: Printer, title: 'Fax', price: fax?.price || null, what: 'A fax-only number', points: ['USA or Canada, sends and receives faxes', `${fax?.freePages ?? 50} free pages a month`], owned: own(faxes.length, 'fax number', 'fax numbers'), off: fax && !fax.available && !faxes.length },
  ];
}

function PurposeCard({ c, on, flip }) {
  return (
    <button type="button" onClick={() => flip(c.id)} aria-pressed={on} disabled={c.off} data-testid={`buy-purpose-${c.id}`} data-selected={on ? 'true' : 'false'}
      className={`civr-card relative text-left p-5 flex flex-col transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 ${on ? '!border-[#1d6fd8] ring-2 ring-[#1d6fd8]/20' : ''}`}>
      {on && <span className="absolute top-3 right-3 w-6 h-6 rounded-full bg-[#1d6fd8] text-white grid place-items-center"><Check className="w-3.5 h-3.5" /></span>}
      <span className="w-11 h-11 rounded-xl bg-[#1d6fd8]/10 grid place-items-center"><c.Icon className="w-5 h-5 text-[#1d6fd8]" /></span>
      <span className="mt-4 text-lg font-semibold">{c.title}</span>
      <span className="text-xs uppercase tracking-wider text-[#a1a1aa]">{c.what}</span>
      <span className="mt-3 text-sm" data-testid={`buy-purpose-${c.id}-price`}>{c.off ? 'Not available right now' : c.price ? <>from <b className="text-xl">{money(c.price)}</b>/month</> : '\u00a0'}</span>
      <ul className="mt-3 space-y-1.5 text-sm text-[#a1a1aa] flex-1">{c.points.map(p => <li key={p} className="flex gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-current shrink-0" />{p}</li>)}</ul>
      {c.owned && <span className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-600" data-testid={`buy-purpose-${c.id}-owned`}><CircleCheck className="w-3.5 h-3.5" />{c.owned}</span>}
      <span className={`mt-4 h-10 rounded-full text-sm font-semibold grid place-items-center ${on ? 'bg-[#1d6fd8] text-white' : 'border border-current/20 text-[#1d6fd8]'}`}>{on ? 'Selected' : 'Choose'}</span>
    </button>
  );
}

// One question: what is the number for? Several can be picked; each gets its own section below.
export function PurposePicker({ cards, value, onChange }) {
  const flip = (id) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <section className="mb-10 civr-rise" data-testid="buy-purpose-picker">
      <h2 className="text-lg font-semibold">What do you need the number for?</h2>
      <p className="text-sm text-[#a1a1aa] mt-1 mb-4">Pick one or more. Voice and SIP share one Business Line. SMS and Fax each get their own number.</p>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{cards.map(c => <PurposeCard key={c.id} c={c} on={value.includes(c.id)} flip={flip} />)}</div>
    </section>
  );
}

// Numbered heading that introduces the section for one chosen purpose.
export function PurposeSection({ n, title, sub, testid, children }) {
  return (
    <section className="mb-10 civr-rise" data-testid={testid}>
      <div className="flex items-start gap-3 mb-4 pb-3 border-b border-current/10">
        <span className="w-7 h-7 rounded-full bg-[#1d6fd8] text-white text-sm font-semibold grid place-items-center shrink-0">{n}</span>
        <div><h2 className="text-lg font-semibold">{title}</h2>{sub && <p className="text-sm text-[#a1a1aa] mt-0.5">{sub}</p>}</div>
      </div>
      {children}
    </section>
  );
}

// SMS purpose → the Texting Number (its own order page), or texting on a number you already have.
export function SmsPurposeCard() {
  const { data } = useApi('/mobile-numbers');
  const has = data?.items?.some(x => x.status !== 'failed' && x.status !== 'cancelled');
  return (
    <div className="civr-card p-5 flex flex-wrap items-center gap-4" data-testid="buy-sms-card">
      <div className="flex-1 min-w-[240px]">
        <div className="font-semibold">{has ? 'Get another Texting Number' : 'Order a Texting Number'}</div>
        <div className="text-sm text-[#a1a1aa] mt-0.5">{`You enter a USA ZIP code, pay${data?.price ? ` ${money(data.price)}/month` : ''} from your wallet, and the number is usually ready within minutes.`}</div>
        <div className="text-sm text-[#a1a1aa] mt-2" data-testid="buy-texting-link">Have a landline or office number elsewhere? <Link to={cp('/app/texting?add=1')} className="text-[#1d6fd8] underline underline-offset-2" data-testid="buy-texting-link-button">Add texting to it</Link></div>
      </div>
      {data && !data.available && !has
        ? <span className="text-sm text-[#a1a1aa]" data-testid="buy-sms-unavailable">Not available right now</span>
        : <Link to={cp('/app/texting-number')} className="civr-btn civr-btn-primary" data-testid="buy-sms-order">{has ? 'Order another' : 'Order a Texting Number'}<ArrowRight className="w-4 h-4" /></Link>}
    </div>
  );
}
