import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './kit';
import { PRODUCT_GROUPS } from '../../products';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';

const TONES = { blue: 'bg-blue-50 text-blue-600', violet: 'bg-violet-50 text-violet-600', green: 'bg-emerald-50 text-emerald-600', rose: 'bg-rose-50 text-rose-600', teal: 'bg-teal-50 text-teal-600' };

function Card({ it, tone, price, href, delay }) {
  const [id, Icon, title, text, , , soon] = it;
  return (
    <Reveal delay={delay} id={`product-${id}`} className="civr-l-card-cream p-6 flex flex-col scroll-mt-24" data-testid={`landing-product-${id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`w-10 h-10 rounded-xl grid place-items-center ${TONES[tone]}`}><Icon className="w-5 h-5" /></span>
        {soon && <span className="text-xs font-semibold rounded-full border border-slate-200 px-2.5 py-0.5 text-slate-500" data-testid={`landing-product-${id}-soon`}>Coming soon</span>}
      </div>
      <div className="font-semibold text-slate-900 mt-5">{title}</div>
      <p className="text-sm text-slate-600 mt-2 leading-relaxed flex-1">{text}</p>
      <div className="mt-5 pt-4 border-t civr-l-rule flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-900" data-testid={`landing-product-${id}-price`}>{price}</span>
        {!soon && React.createElement(href.startsWith('#') ? 'a' : Link, { [href.startsWith('#') ? 'href' : 'to']: href, className: 'inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:gap-2 transition-[gap]', 'data-testid': `landing-product-${id}-cta` }, href.startsWith('#') ? 'See plans' : 'Get it', <ArrowRight key="a" className="w-4 h-4" />)}
      </div>
    </Reveal>
  );
}

// "Everything we offer": every product and standalone service with its real price.
export function Products({ esimPrice }) {
  const { account } = useCivrAuth();
  const href = (to) => (account ? cp(`/app/${to}`) : cp('/signup'));
  const priceOf = (it) => (it[0] === 'usa-esim' && esimPrice ? `$${esimPrice}/mo` : it[4]);
  return (
    <section className="py-20 md:py-28 border-t civr-l-rule scroll-mt-16" id="products" data-testid="landing-products">
      <div className="max-w-6xl mx-auto px-6">
        <Reveal>
          <div className="civr-l-kicker"><span className="civr-l-dot" />Everything we offer</div>
          <h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950 mt-4 max-w-2xl">Every product, with its price.</h2>
          <p className="text-slate-600 mt-3 max-w-2xl text-base md:text-lg">Start with a calling plan, or buy any of these on its own. One wallet pays for everything, month to month, with no contracts.</p>
        </Reveal>
        <div className="mt-12 space-y-12">
          {PRODUCT_GROUPS.map(([gid, title, tone, items]) => (
            <div key={gid} data-testid={`landing-products-group-${gid}`}>
              <div className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500 mb-4">{title}</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {items.map((it, i) => <Card key={it[0]} it={it} tone={tone} price={priceOf(it)} href={it[0] === 'plan' ? '#pricing' : href(it[5])} delay={i * 60} />)}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-10 max-w-3xl" data-testid="landing-products-note">Calling plans include incoming minutes (Basic 100, Starter 250, Pro 400, Business 600). Extra numbers cost three times our provider’s monthly price, at least $25 a month. Numbers outside the USA are for calls only until international texting launches.</p>
      </div>
    </section>
  );
}
