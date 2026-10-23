import React from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, ChevronDown, MessageCircle } from 'lucide-react';
import { usd, money, startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { SectionHead, coinList, instantCountries, andList } from './Sections';

const useStart = () => { const { account } = useCivrAuth(); return (plan) => (account ? cp(`/app/buy${plan ? `?plan=${plan}` : ''}`) : cp(`/signup${plan ? `?plan=${plan}` : ''}`)); };

export function Pricing({ catalog }) {
  const start = useStart();
  const plans = catalog?.plans || [];
  const r = catalog?.rates;
  return (
    <section id="pricing" className="max-w-7xl mx-auto px-6 md:px-8 py-24 scroll-mt-16">
      <SectionHead label="Pricing" title="Monthly per number. Cancel any time." sub="Free to sign up. Each number is paid from your crypto wallet and renews monthly." />
      <div className="grid md:grid-cols-3 gap-6">
        {plans.map((p, i) => (
          <div key={p.id} className={`civr-card p-8 flex flex-col ${i === 1 ? 'civr-trace' : ''}`} data-testid={`pricing-plan-${p.id}`}>
            <div className="flex items-center justify-between"><div className="font-display text-3xl font-bold">{p.name}</div>{i === 1 && <span className="civr-pill civr-pill-on">Recommended</span>}</div>
            <div className="font-mono text-4xl mt-4" data-testid={`pricing-price-${p.id}`}>{usd(p.price)}<span className="text-sm text-[#9a9a9a]">/mo</span></div>
            <div className="text-sm text-[#ddd] mt-2" data-testid={`pricing-allowance-${p.id}`}>{p.minutes} minutes · {p.sms} SMS included each month</div>
            <ul className="mt-6 flex flex-col gap-2 text-sm text-[#bbb] flex-1">
              {p.features.map(f => <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-[#34d399] mt-0.5 shrink-0" />{f}</li>)}
            </ul>
            <Link to={start(p.id)} className={`civr-btn mt-8 ${i === 1 ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`pricing-choose-${p.id}`}>Choose {p.name}</Link>
          </div>
        ))}
      </div>
      {r && (
        <p className="text-sm text-[#a1a1aa] mt-8 max-w-3xl" data-testid="pricing-extra-usage">
          Extra usage is paid from your wallet: minutes over your plan {money(r.overagePerMin)}/min · SMS over your plan {money(r.overagePerSms)} each · calls forwarded to a phone {money(r.forwardingPerMin)}/min. Outbound IVR calls show their price before you start.
        </p>
      )}
    </section>
  );
}

function faqItems(c) {
  const from = startPrice(c);
  const r = c?.rates;
  const ivr = andList((c?.plans || []).filter(p => p.access?.ivr).map(p => p.name)) || 'Business';
  return [
    ['Is the account really free?', `Yes. Creating an account costs nothing. You only pay when you buy a number${from ? ` (from ${from}/month)` : ''}, plus any extra usage.`],
    ['How do I pay?', `Top up your wallet with ${coinList(c) || 'crypto'} — minimum ${usd(c?.minTopup || 10)}. Your balance updates once the network confirms the payment. Numbers, renewals and calls are paid from the wallet.`],
    ['Which plan has the IVR auto-attendant?', `The ${ivr} plan. Pro includes Quick IVR calls and Bulk IVR campaigns; Starter covers call forwarding and SMS.`],
    ['Do I need ID to get a number?', `Not for ${instantCountries(c) || 'US and Canada'}. Other countries need a short ID check the carrier requires — you fill it in on the site right after paying, and the number goes live once the carrier has your details.`],
    ['What if I go over my minutes or SMS?', r ? `Extra minutes cost ${money(r.overagePerMin)} each and extra SMS ${money(r.overagePerSms)} each, paid from your wallet.` : 'Extra usage is paid from your wallet at a small per-minute and per-SMS rate.'],
    ['Can I cancel?', 'Yes. Plans are month to month. Turn off auto-renew on a number and it won’t renew, or delete it from its Billing tab.'],
    ['Is this the same account as the Telegram bot?', 'No. CloudIVR web accounts are separate from Telegram bot accounts, so sign up here with your email.'],
  ];
}

export function Faq({ catalog }) {
  return (
    <section id="faq" className="max-w-7xl mx-auto px-6 md:px-8 py-24 grid lg:grid-cols-12 gap-12 scroll-mt-16">
      <div className="lg:col-span-4"><SectionHead label="FAQ" title="Questions before you buy" /></div>
      <div className="lg:col-span-8 flex flex-col gap-2" data-testid="faq-list">
        {faqItems(catalog).map(([q, a], i) => (
          <details key={q} className="civr-card" data-testid={`faq-item-${i}`}>
            <summary className="flex items-center justify-between gap-4 cursor-pointer px-6 py-4 min-h-[56px] font-semibold" data-testid={`faq-question-${i}`}>{q}<ChevronDown className="civr-faq-chevron w-4 h-4 shrink-0 text-[#a1a1aa]" /></summary>
            <p className="px-6 pb-6 text-sm text-[#a1a1aa]" data-testid={`faq-answer-${i}`}>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCta({ catalog }) {
  const start = useStart();
  const from = startPrice(catalog);
  return (
    <section className="max-w-7xl mx-auto px-6 md:px-8 pb-24">
      <div className="civr-card civr-trace relative overflow-hidden p-8 md:p-16 flex flex-col md:flex-row md:items-center gap-8" data-testid="final-cta">
        <div className="civr-grain" />
        <div className="flex-1 relative">
          <h2 className="font-display text-4xl sm:text-5xl font-extrabold leading-[0.95] max-w-2xl">Your number could be answering calls in a few minutes.</h2>
          <p className="text-base text-[#a1a1aa] mt-4">Free to sign up{from ? ` · Numbers from ${from}/month` : ''} · No contracts</p>
        </div>
        <Link to={start()} className="civr-btn civr-btn-primary !h-12 !px-8 !text-base relative" data-testid="final-cta-button">Get your number <ArrowRight className="w-4 h-4" /></Link>
      </div>
    </section>
  );
}

export function Footer({ catalog }) {
  const links = [['#how', 'How it works', 'how'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']];
  const link = 'text-sm text-[#a1a1aa] hover:text-[#34d399] py-3';
  return (
    <footer className="border-t border-[#1a1a1a]" data-testid="landing-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-12 flex flex-col md:flex-row md:items-center gap-6">
        <div className="mr-auto">
          <div className="font-display text-2xl font-extrabold">CLOUD<span className="text-[#34d399]">IVR</span></div>
          <div className="text-xs text-[#9a9a9a] mt-2" data-testid="footer-copyright">© {new Date().getFullYear()} CloudIVR · Virtual numbers, IVR and SIP</div>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6">
          {links.map(([href, label, id]) => <a key={id} href={href} className={link} data-testid={`footer-link-${id}`}>{label}</a>)}
          <Link to={cp('/login')} className={link} data-testid="footer-link-signin">Sign in</Link>
          {catalog?.supportLink && <a href={catalog.supportLink} target="_blank" rel="noopener noreferrer" className={`${link} flex items-center gap-2`} data-testid="footer-support-link"><MessageCircle className="w-4 h-4" />Support on Telegram</a>}
        </nav>
      </div>
    </footer>
  );
}
