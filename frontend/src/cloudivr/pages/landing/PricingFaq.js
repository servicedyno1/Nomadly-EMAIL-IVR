import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus, MessageCircle, Send } from 'lucide-react';
import { usd, money, startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Wordmark } from '../../Brand';
import { SectionHead, Slide, coinList, andList, Reveal } from './kit';
import { PlanFeatures, RecommendedBadge } from '../../PlanFeatures';
import { PaymentMethods } from './Payments';
import { PlanCompare, UsageRates } from './PlanTable';
import { openCookieSettings } from '../../consent';
import { PRODUCTS, USE_CASES, goTo, hrefOf } from './menu';

// Plan button target: signed-in → Buy with the plan picked, otherwise sign-up keeps it (?plan=pro). Also used by the SIP page.
export const useStart = () => { const { account } = useCivrAuth(); return (plan) => (account ? cp(`/app/buy${plan ? `?plan=${plan}` : ''}`) : cp(`/signup${plan ? `?plan=${plan}` : ''}`)); };

function PlanCard({ p, plans, hot, start, delay }) {
  return (
    <Reveal delay={delay} className={`civr-l-card-cream p-8 flex flex-col ${hot ? '!border-slate-900 ring-1 ring-slate-900 shadow-[0_24px_48px_-28px_rgba(15,23,42,.35)]' : ''}`} data-testid={`civr-plan-card-${p.id}`}>
      <div className="flex items-center justify-between gap-2"><div className="text-lg font-semibold text-slate-900">{p.name}</div>{p.recommended && <RecommendedBadge tone="landing" testid={`pricing-recommended-${p.id}`} />}</div>
      <div className="civr-l-h text-5xl text-slate-900 mt-6" data-testid={`pricing-price-${p.id}`}>{usd(p.price)}<span className="text-base font-medium tracking-normal text-slate-500">/mo</span></div>
      <div className="text-sm text-slate-500 mt-2" data-testid={`pricing-allowance-${p.id}`}>{`${p.minutes} incoming minutes · ${p.sms} SMS included each month`}</div>
      <div className="mt-6 pt-6 border-t civr-l-rule flex-1"><PlanFeatures plan={p} plans={plans} tone="cream" testid={`pricing-feature-${p.id}`} /></div>
      <Link to={start(p.id)} className={`civr-l-btn mt-8 w-full ${hot ? '' : 'civr-l-btn-ghost'}`} data-testid={`pricing-choose-${p.id}`}><Slide>Choose {p.name}</Slide></Link>
    </Reveal>
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
        <SectionHead label="Pricing" title="Simple pricing. Serious firepower." sub="Free to sign up. One monthly price per number, no contracts. Each plan builds on the one before it — auto-renew keeps your number yours, and you can switch it off any time." />
        <div className="grid md:grid-cols-3 gap-4 mt-12 items-stretch">{plans.map((p, i) => <PlanCard key={p.id} p={p} plans={plans} hot={hasRec ? p.recommended : i === 1} start={start} delay={i * 120} />)}</div>
        {r && (
          <p className="text-sm text-slate-500 mt-8 max-w-3xl" data-testid="pricing-extra-usage">
            {`Extra usage is paid from your wallet: incoming minutes over your plan ${money(r.overagePerMin)}/min, SMS over your plan ${money(r.overagePerSms)} each, calls forwarded to a phone ${money(r.forwardingPerMin)}/min. Outgoing calls — browser phone, softphone, IVR and AI agent calls — are billed per minute from your wallet and show their price before you start. Extra numbers cost from ${usd(catalog?.extraNumber?.price || 25)}/month each and share the plan's minutes and SMS.`}
          </p>
        )}
        <PlanCompare catalog={catalog} start={start} />
        <UsageRates catalog={catalog} />
        <PaymentMethods catalog={catalog} className="mt-12 pt-8 border-t civr-l-rule" testid="pricing-payment-methods" />
      </div>
    </section>
  );
}

// Also used by the in-app Help centre.
export function faqItems(c) {
  const from = startPrice(c);
  const r = c?.rates;
  const on = (k, d) => andList((c?.plans || []).filter(p => p.access?.[k]).map(p => p.name)) || d;
  const ivr = on('ivr', 'Pro and Business'), out = on('ivrOutbound', 'Pro and Business');
  const ex = c?.extraNumber;
  return [
    ['Can I try it before I pay?', 'Yes, twice. Without an account: confirm your email with a 6-digit code and take one free test call of up to 60 seconds — we ring your phone with a demo menu, or you call from your browser. After you sign up: place one free Quick IVR call from our number — it plays your script to anyone you choose, then connects them to you when they press 1 or collects a code you accept or decline.'],
    ['Is the account really free?', `Yes. Creating an account costs nothing. You only pay when you buy a number${from ? ` (from ${from}/month)` : ''}, plus any extra usage.`],
    ['How do I pay?', `With crypto (${coinList(c) || 'BTC, ETH, USDT and more'}) or from your CloudIVR wallet (top-ups from ${usd(c?.minTopup || 10)}). Renewals and calls are paid from the wallet. Card payments are coming soon — until they are switched on, cards show as “coming soon” here and at checkout.`],
    ['What does each plan include?', `Starter gives you a number with call forwarding, the SMS inbox and the browser phone — make and take calls in any browser tab. Pro adds the keypad menu, voicemail, SIP logins for desk phones and softphone apps, call recording, ring groups, Quick IVR calls, Bulk IVR campaigns and code collection. Business adds AI voice agents, text calls, Text Triggers, Quick IVR scheduling and saved presets, redial, your own accept / decline messages for codes, one saved voice for every call and priority support.`],
    ['What’s the difference between the keypad menu and Quick or Bulk IVR?', `They work in opposite directions. The keypad menu answers people who call your number: they hear your greeting and press a key to reach the right person, a message or voicemail (${ivr}). Quick IVR and Bulk IVR call people for you: they hear your message, then press a key to reach you, type a code or pick an option — Quick IVR for up to 10 numbers at once, Bulk IVR campaigns for a whole list (${out}).`],
    ['What’s the difference between the keypad menu and an AI voice agent?', `The keypad menu plays your greeting and callers press a key to reach the right person, message or voicemail — it uses your plan minutes. An AI voice agent talks with callers instead: it answers questions, books appointments and takes messages, billed ${money(r?.aiAgentPerMin ?? 0.2)}/min from your wallet. Each number uses one or the other.`],
    ['What if I go over my minutes or SMS?', r ? `Extra incoming minutes cost ${money(r.overagePerMin)} each and extra SMS ${money(r.overagePerSms)} each, paid from your wallet.` : 'Extra usage is paid from your wallet at a small per-minute and per-SMS rate.'],
    ['Are outgoing calls included in my minutes?', 'No. Plan minutes cover incoming calls you answer. Outgoing calls — browser phone, softphone, Quick IVR, campaigns and AI agent calls — and forwarded calls are billed per minute from your wallet, and the price shows before you call.'],
    ...(ex ? [['Can I put several numbers on one plan?', `Yes. Add extra numbers to a main number from ${usd(ex.price)}/month each — up to ${ex.limits.starter} on Starter, ${ex.limits.pro} on Pro and ${ex.limits.business} on Business. They share its minutes and SMS and get the same features.`]] : []),
    ['Can I cancel?', 'Yes. Plans are month to month. Auto-renew is on by default so your number never lapses — turn it off in the number’s Billing tab and it simply won’t renew, or delete the number any time.'],
    ['What happens if the AI agent can’t help?', 'It never pretends to be human and never asks for card numbers, passwords or one-time codes. When a caller wants a person, the agent transfers the call to the number you set — or, if you haven’t set one, offers to take a message with a name, callback number and the message, which lands in your inbox. On a keypad menu, callers can always reach voicemail. Anyone who asks not to be called again is removed from the list and the call ends politely.'],
    ['Do you scrub numbers or enforce quiet hours?', 'Your do-not-call list is enforced on every campaign — Bulk IVR and AI agent, web and Telegram bot: numbers on it are never dialed and never billed. We don’t check public Do-Not-Call registries for you and we don’t enforce quiet hours automatically: you schedule each campaign, set a daily call limit and repeat it daily or weekly, and you’re responsible for calling only people who have agreed to hear from you, at reasonable hours where they live.'],
    ['Is this the same account as the Telegram bot?', 'No. CloudIVR web accounts are separate from Telegram bot accounts, so sign up here with your email.'],
  ];
}

export function Faq({ catalog }) {
  return (
    <section id="faq" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="faq-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24 grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4"><SectionHead label="FAQ" title="Got questions? Good." /></div>
        <div className="lg:col-span-8 border-t civr-l-rule" data-testid="faq-list">
          {faqItems(catalog).map(([q, a], i) => (
            <Reveal as="details" key={q} delay={Math.min(i, 6) * 60} className="border-b civr-l-rule group" data-testid={`faq-item-${i}`}>
              <summary className="flex items-center justify-between gap-4 cursor-pointer py-6 min-h-[56px] text-base md:text-lg font-semibold text-slate-900 hover:text-slate-600 transition-colors" data-testid={`faq-question-${i}`}>{q}<Plus className="civr-faq-chevron w-5 h-5 shrink-0 text-slate-400" /></summary>
              <p className="pb-6 text-sm text-slate-600 max-w-2xl" data-testid={`faq-answer-${i}`}>{a}</p>
            </Reveal>
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
    <section className="civr-l-cream py-24" data-testid="final-cta">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <Reveal className="relative overflow-hidden rounded-[28px] border civr-l-rule bg-slate-50 px-8 py-16 md:px-16 md:py-20 text-center">
          <div className="relative">
            <div className="civr-l-eyebrow">Ready when you are</div>
            <h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl text-slate-950 max-w-3xl mx-auto mt-4">Stop missing calls. <span className="text-slate-400">Start closing them.</span></h2>
            <p className="text-base mt-5 text-slate-600">Your number can be answering — and calling — in minutes. Free to sign up{from ? ` · Numbers from ${from}/month` : ''} · No contracts</p>
            <div className="flex flex-wrap justify-center gap-3 mt-9">
              <Link to={start()} className="civr-l-pill civr-l-pill-ink" data-testid="final-cta-button"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
              <a href="#try" className="civr-l-pill civr-l-pill-outline" data-testid="final-cta-try-button"><Slide>Try a free call</Slide></a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const fLink = 'text-sm text-slate-600 hover:text-slate-950 transition-colors py-1.5 text-left';

function FooterCol({ title, children, testid }) {
  return <div data-testid={testid}><div className="text-xs font-semibold uppercase tracking-[.14em] text-slate-900 mb-4">{title}</div><div className="flex flex-col">{children}</div></div>;
}

// Mega footer (cm.com style). Product links open the matching platform tab; on other pages they go back to the landing page.
export function Footer({ catalog }) {
  const base = cp();
  const menuLinks = (items, id) => items.map(([k, , t, , target]) => <a key={k} href={hrefOf(base, target)} onClick={(e) => goTo(target, e)} className={fLink} data-testid={`footer-${id}-${k}`}>{t}</a>);
  return (
    <footer className="bg-slate-50 text-slate-900 border-t border-slate-200" data-testid="landing-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 pt-16 pb-10">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="font-display text-2xl font-extrabold flex items-center gap-2" data-testid="landing-footer-logo"><Wordmark accent="#059669" iconClass="w-8 h-8" /></div>
            <p className="text-sm text-slate-600 mt-4 max-w-xs">Virtual numbers, inbound & outbound IVR, SIP and AI voice agents — run from your browser.</p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link to={cp('/signup')} className="civr-l-pill civr-l-pill-ink civr-l-pill-sm" data-testid="footer-cta-signup">Get your number</Link>
              <Link to={cp('/login')} className="civr-l-pill civr-l-pill-outline civr-l-pill-sm" data-testid="footer-link-signin">Sign in</Link>
            </div>
          </div>
          <div className="lg:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-8">
            <FooterCol title="Product" testid="footer-col-product">{menuLinks(PRODUCTS, 'product')}</FooterCol>
            <FooterCol title="Use cases" testid="footer-col-usecases">{menuLinks(USE_CASES, 'usecase')}</FooterCol>
            <FooterCol title="CloudIVR" testid="footer-col-company">
              {[['#coverage', 'Coverage', 'coverage'], ['#try', 'Free test call', 'try'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']].map(([h, l, id]) => <a key={id} href={`${base}${h}`} onClick={(e) => goTo(h, e)} className={fLink} data-testid={`footer-link-${id}`}>{l}</a>)}
              <Link to={cp('/sip')} className={fLink} data-testid="footer-link-sip">SIP & softphones</Link>
            </FooterCol>
            <FooterCol title="Support & legal" testid="footer-col-support">
              {catalog?.supportLink && <a href={catalog.supportLink} target="_blank" rel="noopener noreferrer" className={`${fLink} flex items-center gap-2`} data-testid="footer-support-link"><MessageCircle className="w-4 h-4" />Support on Telegram</a>}
              {catalog?.channelLink && <a href={catalog.channelLink} target="_blank" rel="noopener noreferrer" className={`${fLink} flex items-center gap-2`} data-testid="footer-channel-link"><Send className="w-4 h-4" />Telegram channel</a>}
              <Link to={cp('/terms')} className={fLink} data-testid="footer-link-terms">Terms of Service</Link>
              <button type="button" onClick={openCookieSettings} className={fLink} data-testid="footer-link-cookies">Cookie settings</button>
            </FooterCol>
          </div>
        </div>
        <div className="mt-14 pt-8 border-t border-slate-200 flex flex-col md:flex-row md:items-end gap-6 justify-between">
          <PaymentMethods catalog={catalog} label="We accept" testid="footer-payment-methods" />
          <div className="text-xs text-slate-500" data-testid="footer-copyright">© {new Date().getFullYear()} CloudIVR · Virtual numbers, inbound & outbound IVR, SIP and AI voice agents</div>
        </div>
      </div>
    </footer>
  );
}
