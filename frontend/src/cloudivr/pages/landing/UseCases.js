import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, LifeBuoy, Sparkles, Globe2, Coins, Send, MessageSquareText } from 'lucide-react';
import { SectionHead, Reveal } from './kit';
import { goTo, hrefOf } from './menu';
import { cp } from '../../paths';

// Outcome-led tiles: who you are → what you get → the platform tab that does it. Asymmetric bento, cm.com style.
const TILES = [
  ['sales', TrendingUp, 'Sales team calling a list', 'Call 500 leads before lunch — and talk only to the ones who press 1.', 'Bulk IVR plays your pitch, connects the interested, collects codes and shows every call live on a map.', 'campaigns', 'md:col-span-4 ink'],
  ['support', LifeBuoy, 'Support line with a menu', 'Press 1 for sales, 2 for support. Every caller lands with the right person in under a second.', null, 'ivr', 'md:col-span-2'],
  ['founder', Sparkles, 'Solo founder sounding like a company', 'A greeting, a menu and voicemail that reads itself to you — one number, your mobile, no desk.', null, 'voicemail', 'md:col-span-2'],
  ['agency', Globe2, 'Agency managing numbers in several countries', 'A local number in each market, every client in one account.', null, '#coverage', 'md:col-span-2'],
  ['crypto', Coins, 'Crypto-native business paying in USDT', 'Top up a wallet in USDT, BTC or ETH. Every call shows its price before you start it.', null, '#pricing', 'md:col-span-2'],
  ['telegram', Send, 'Telegram user moving to the web', 'Same calling engine as the bot, now with a dashboard, live map, contacts and campaign history. It’s a separate web account — sign up with your email.', null, 'signup', 'md:col-span-3'],
  ['texting', MessageSquareText, 'New · Landline to Texting', 'Text from the landline number your customers already know.', 'We turn on SMS for your existing US or Canada landline — calls keep working as before. $0.05 per text sent or received.', 'signup', 'md:col-span-3 ink'],
];

function Tile({ t, i }) {
  const [id, Icon, who, result, more, target, cls] = t;
  const ink = cls.includes('ink');
  const link = target === 'signup';
  const Cta = link ? Link : 'a';
  const props = link ? { to: cp('/signup') } : { href: hrefOf('', target), onClick: (e) => goTo(target, e) };
  return (
    <Reveal delay={i * 80} className={`civr-l-tile ${cls}`} data-testid={`usecase-${id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${ink ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-900'}`}><Icon className="w-5 h-5" /></span>
          <span className={`text-xs font-semibold uppercase tracking-[.12em] ${ink ? 'text-slate-300' : 'text-slate-500'}`}>{who}</span>
        </div>
        <p className={`civr-l-h text-xl md:text-2xl mt-5 ${ink ? 'text-white' : 'text-slate-900'}`}>{result}</p>
        {more && <p className={`text-sm mt-3 max-w-xl ${ink ? 'text-slate-300' : 'text-slate-600'}`}>{more}</p>}
      </div>
      <Cta {...props} className={`inline-flex items-center gap-2 text-sm font-semibold shrink-0 group ${ink ? 'text-white' : 'text-slate-900'}`} data-testid={`usecase-${id}-link`}>{link ? 'Create your web account' : 'See how it works'}<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></Cta>
    </Reveal>
  );
}

export function UseCases() {
  return (
    <section id="usecases" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="usecases-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="Who it’s for" title="Pick your situation. We’ll show you the feature." sub="Seven ways people run their phone line on CloudIVR — each one points at the part of the platform that does the work." />
        <div className="grid md:grid-cols-6 gap-4 mt-12" data-testid="usecases-grid">{TILES.map((t, i) => <Tile key={t[0]} t={t} i={i} />)}</div>
      </div>
    </section>
  );
}
