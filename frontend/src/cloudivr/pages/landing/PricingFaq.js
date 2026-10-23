import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus, MessageCircle } from 'lucide-react';
import { usd, money, startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { SectionHead, Slide, coinList, andList } from './kit';
import { PlanFeatures, RecommendedBadge } from '../../PlanFeatures';

const useStart = () => { const { account } = useCivrAuth(); return (plan) => (account ? cp(`/app/buy${plan ? `?plan=${plan}` : ''}`) : cp(`/signup${plan ? `?plan=${plan}` : ''}`)); };

function PlanCard({ p, hot, start }) {
  return (
    <div className={`${hot ? 'civr-l-card civr-l-dark' : 'civr-l-card-cream'} civr-l-tilt p-8 flex flex-col`} data-testid={`civr-plan-card-${p.id}`}>
      <div className="flex items-center justify-between"><div className="civr-l-h text-4xl">{p.name}</div>{p.recommended && <RecommendedBadge tone="landing" testid={`pricing-recommended-${p.id}`} />}</div>
      <div className="civr-l-h text-6xl mt-6" data-testid={`pricing-price-${p.id}`}>{usd(p.price)}<span className="text-base font-sans normal-case tracking-normal font-medium opacity-60">/mo</span></div>
      <div className={`text-sm mt-2 ${hot ? 'civr-l-muted' : 'text-black/60'}`} data-testid={`pricing-allowance-${p.id}`}>{p.minutes} minutes · {p.sms} SMS included each month</div>
      <div className="mt-6 flex-1"><PlanFeatures plan={p} tone={hot ? 'dark' : 'cream'} testid={`pricing-feature-${p.id}`} /></div>
      <Link to={start(p.id)} className={`civr-l-btn mt-8 w-full ${hot ? '' : 'civr-l-btn-ink'}`} data-testid={`pricing-choose-${p.id}`}><Slide>Choose {p.name}</Slide></Link>
    </div>
  );
}

export function Pricing({ catalog }) {
  const start = useStart();
  const plans = (catalog?.plans || []).filter(p => p.available !== false);
  const hasRec = plans.some(p => p.recommended);
  const r = catalog?.rates;
  return (
    <section id="pricing" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="pricing-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead n="05" label="Pricing" title="Monthly per number. Cancel any time." sub="Free to sign up. Pay for a number with crypto or from your wallet. Auto-renew keeps it yours — switch it off whenever you like." />
        <div className="grid md:grid-cols-3 gap-4 mt-14">{plans.map((p, i) => <PlanCard key={p.id} p={p} hot={hasRec ? p.recommended : i === 1} start={start} />)}</div>
        {r && (
          <p className="text-sm text-black/60 mt-8 max-w-3xl" data-testid="pricing-extra-usage">
            Extra usage is paid from your wallet: minutes over your plan {money(r.overagePerMin)}/min · SMS over your plan {money(r.overagePerSms)} each · calls forwarded to a phone {money(r.forwardingPerMin)}/min. Outbound IVR calls show their price before you start.
          </p>
        )}
      </div>
    </section>
  );
}

function faqItems(c) {
  const from = startPrice(c);
  const r = c?.rates;
  const ivr = andList((c?.plans || []).filter(p => p.access?.ivr).map(p => p.name)) || 'Business';
  return [
    ['Can I try it before I pay?', 'Yes. Confirm your email with a 6-digit code and take one free test call of up to 60 seconds — we ring your phone with a demo menu, or you call from your browser. No account needed.'],
    ['Is the account really free?', `Yes. Creating an account costs nothing. You only pay when you buy a number${from ? ` (from ${from}/month)` : ''}, plus any extra usage.`],
    ['How do I pay?', `Pay for a number directly with ${coinList(c) || 'crypto'}, or top up your CloudIVR wallet (from ${usd(c?.minTopup || 10)}) and pay from it. Renewals and calls are paid from the wallet.`],
    ['Which plan has the IVR auto-attendant?', `The ${ivr} plan. Pro includes Quick IVR calls and Bulk IVR campaigns; Starter covers call forwarding and SMS.`],
    ['What if I go over my minutes or SMS?', r ? `Extra minutes cost ${money(r.overagePerMin)} each and extra SMS ${money(r.overagePerSms)} each, paid from your wallet.` : 'Extra usage is paid from your wallet at a small per-minute and per-SMS rate.'],
    ['Can I cancel?', 'Yes. Plans are month to month. Auto-renew is on by default so your number never lapses — turn it off in the number’s Billing tab and it simply won’t renew, or delete the number any time.'],
    ['Is this the same account as the Telegram bot?', 'No. CloudIVR web accounts are separate from Telegram bot accounts, so sign up here with your email.'],
  ];
}

export function Faq({ catalog }) {
  return (
    <section id="faq" className="civr-l-dark scroll-mt-16" data-testid="faq-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24 grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4"><SectionHead n="06" label="FAQ" title="Questions before you buy" /></div>
        <div className="lg:col-span-8 border-t civr-l-rule" data-testid="faq-list">
          {faqItems(catalog).map(([q, a], i) => (
            <details key={q} className="border-b civr-l-rule group" data-testid={`faq-item-${i}`}>
              <summary className="flex items-center justify-between gap-4 cursor-pointer py-6 min-h-[56px] text-lg font-semibold hover:text-[#00E3AA] transition-colors" data-testid={`faq-question-${i}`}>{q}<Plus className="civr-faq-chevron w-5 h-5 shrink-0" /></summary>
              <p className="pb-6 text-sm civr-l-muted max-w-2xl" data-testid={`faq-answer-${i}`}>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta({ catalog }) {
  const start = useStart();
  const from = startPrice(catalog);
  return (
    <section className="bg-[#00E3AA] text-[#0A0D0E] relative overflow-hidden" data-testid="final-cta">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-24 flex flex-col md:flex-row md:items-end gap-8">
        <div className="flex-1">
          <h2 className="civr-l-h text-5xl sm:text-6xl lg:text-7xl max-w-3xl">Your number could be answering calls in minutes.</h2>
          <p className="text-base mt-5 font-medium opacity-70">Free to sign up{from ? ` · Numbers from ${from}/month` : ''} · No contracts</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="#try" className="civr-l-btn civr-l-btn-ghost !border-[#0A0D0E] hover:!bg-[#0A0D0E]/10 hover:!text-[#0A0D0E]" data-testid="final-cta-try-button"><Slide>Try a free call</Slide></a>
          <Link to={start()} className="civr-l-btn civr-l-btn-ink" data-testid="final-cta-button"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
        </div>
      </div>
    </section>
  );
}

export function Footer({ catalog }) {
  const links = [['#coverage', 'Coverage', 'coverage'], ['#try', 'Free test call', 'try'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']];
  const link = 'text-sm civr-l-muted hover:text-[#00E3AA] py-3 transition-colors';
  return (
    <footer className="civr-l-dark border-t civr-l-rule" data-testid="landing-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-12 flex flex-col md:flex-row md:items-center gap-6">
        <div className="mr-auto">
          <div className="font-display text-3xl font-extrabold">CLOUD<span className="text-[#00E3AA]">IVR</span></div>
          <div className="text-xs civr-l-muted mt-2" data-testid="footer-copyright">© {new Date().getFullYear()} CloudIVR · Virtual numbers, IVR and SIP</div>
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
