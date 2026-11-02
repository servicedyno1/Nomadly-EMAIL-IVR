import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, PhoneCall, MessageSquareText, Smartphone } from 'lucide-react';
import { Reveal } from './kit';
import { goTo } from './menu';
import { useStart } from './PricingFaq';
import { openEsimCheckout } from './EsimCheckout';

const ART = (n) => `${process.env.PUBLIC_URL || ''}/cloudivr/art/${n}.webp`;

// The three product families: [id, Icon, art, kicker, title, text, facts, primary CTA, secondary CTA].
const FAMILIES = [
  ['calling', PhoneCall, 'calls', 'Calling & IVR', 'Business numbers that answer, call and talk for you',
    'Local, mobile and toll-free numbers in many countries, with keypad menus, Bulk and Quick IVR campaigns, AI voice agents and text-to-voice calls.',
    ['Keypad menus (IVR), voicemail and call forwarding', 'Bulk & Quick IVR campaigns that connect everyone who presses 1', 'Browser phone, SIP softphones and AI voice agents'],
    ['See calling plans', '#pricing'], ['Explore features', 'ivr']],
  ['texting', MessageSquareText, 'landline', 'Texting', 'Landline to Texting',
    'Customers text the office or landline number they already know. Calls stay with your current carrier; every text lands in the CloudIVR app.',
    ['Works with your existing US or Canada number', '$200 to start, then $50/month after the first month', 'Incoming texts are free'],
    ['Start texting', 'texting'], ['How it works', 'hosted']],
  ['mobile', Smartphone, 'outreach', 'Mobile', 'CloudIVR eSIM & USA mobile number',
    'A USA mobile line on the T-Mobile network for your phone, or a USA mobile number for texting in your browser. Both are real carrier numbers, not VoIP.',
    ['eSIM: install with a QR code; data, calls and texts on your phone', 'USA mobile number: texts in CloudIVR Messages, no phone needed', 'Each $75/month, no contract'],
    ['Buy eSIM', 'esim'], ['See eSIM plans', '#esim']],
];

function Primary({ id, label, target }) {
  const start = useStart();
  const cls = 'civr-l-btn civr-l-btn-sm inline-flex items-center gap-2';
  if (target === 'esim') return <button type="button" onClick={() => openEsimCheckout()} className={cls} data-testid={`family-${id}-cta`}>{label}<ArrowRight className="w-4 h-4" /></button>;
  if (target === 'texting') return <Link to={start('texting')} className={cls} data-testid={`family-${id}-cta`}>{label}<ArrowRight className="w-4 h-4" /></Link>;
  return <a href={target} onClick={(e) => goTo(target, e)} className={cls} data-testid={`family-${id}-cta`}>{label}<ArrowRight className="w-4 h-4" /></a>;
}

function Family({ f, i }) {
  const [id, Icon, art, kicker, title, text, facts, [p1, t1], [p2, t2]] = f;
  return (
    <Reveal delay={i * 100} className="v2-surface p-4 flex flex-col v2-lift" id={`family-${id}`} data-testid={`family-${id}`}>
      <div className="v2-art aspect-[16/10]"><img src={ART(art)} alt="" loading="lazy" className="w-full h-full object-cover" /></div>
      <div className="px-3 pt-6 pb-3 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] v2-muted"><Icon className="w-4 h-4" />{kicker}</div>
        <h3 className="civr-l-h text-2xl mt-3">{title}</h3>
        <p className="v2-muted mt-3 leading-relaxed">{text}</p>
        <ul className="mt-5 space-y-2.5 text-[15px] flex-1">{facts.map(x => <li key={x} className="flex gap-2.5"><Check className="w-4 h-4 mt-1 shrink-0 text-emerald-600" /><span>{x}</span></li>)}</ul>
        <div className="flex flex-wrap items-center gap-4 mt-6">
          <Primary id={id} label={p1} target={t1} />
          <a href={t2.startsWith('#') ? t2 : `#features-${t2}`} onClick={(e) => goTo(t2, e)} className="v2-link font-semibold inline-flex items-center gap-1.5 py-2" data-testid={`family-${id}-more`}>{p2}</a>
        </div>
      </div>
    </Reveal>
  );
}

export function Families() {
  return (
    <section id="products" className="py-16 md:py-28 scroll-mt-20" data-testid="families">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl max-w-3xl">Three ways to reach your customers</h2>
          <p className="v2-muted mt-4 max-w-2xl text-lg">Calling & IVR, Texting and Mobile eSIM — one account, one wallet, one app.</p></Reveal>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">{FAMILIES.map((f, i) => <Family key={f[0]} f={f} i={i} />)}</div>
      </div>
    </section>
  );
}
