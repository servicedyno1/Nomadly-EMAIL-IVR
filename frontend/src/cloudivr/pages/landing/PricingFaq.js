import React, { useState } from 'react';
import { AUDIENCES } from '../for/audiences';
import { COPYRIGHT } from '../../company';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUp, ChevronDown, MessageCircle, Send, MessageSquareText, Check } from 'lucide-react';
import { SocialLinks } from './Social';
import { usd, startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Wordmark } from '../../Brand';
import { SectionHead, Slide, andList, Reveal } from './kit';
import { PlanFeatures, RecommendedBadge, PLAN_JOB } from '../../PlanFeatures';
import { PaymentMethods } from './Payments';
import { PlanCompare } from './PlanTable';
import { openCookieSettings } from '../../consent';
import { goTo } from './menu';

// Plan button target: signed-in → Buy with the plan picked, otherwise sign-up keeps it (?plan=pro). Also used by the SIP page.
export const useStart = () => { const { account } = useCivrAuth(); return (plan) => (plan === 'esim' && account ? cp('/app/esim') : plan === 'textnum' && account ? cp('/app/buy?purpose=texting&country=US') : plan === 'texting' && account ? cp('/app/texting?start=texting') : account ? cp(`/app/buy${plan ? `?plan=${plan}` : ''}`) : cp(`/signup${plan ? `?plan=${plan}` : ''}`)); };

export function PlanCard({ p, plans, hot, start, delay }) {
  return (
    <Reveal delay={delay} className={`civr-l-card-cream p-8 flex flex-col ${hot ? '!border-slate-900 ring-1 ring-slate-900 shadow-[0_24px_48px_-28px_rgba(15,23,42,.35)]' : ''}`} data-testid={`civr-plan-card-${p.id}`}>
      <div className="flex items-center justify-between gap-2"><div><div className="text-lg font-semibold text-slate-900">{p.name}</div>{PLAN_JOB[p.id] && <div className="text-sm text-slate-500" data-testid={`pricing-job-${p.id}`}>{PLAN_JOB[p.id]}</div>}</div>{p.recommended && <RecommendedBadge tone="landing" testid={`pricing-recommended-${p.id}`} />}</div>
      <div className="civr-l-h text-5xl text-slate-900 mt-6" data-testid={`pricing-price-${p.id}`}>{usd(p.price)}<span className="text-base font-medium tracking-normal text-slate-500">/mo</span></div>
      <div className="mt-6 pt-6 border-t civr-l-rule flex-1"><PlanFeatures plan={p} plans={plans} tone="cream" testid={`pricing-feature-${p.id}`} /></div>
      <Link to={start(p.id)} className={`civr-l-btn mt-8 w-full !px-3 ${hot ? '' : 'civr-l-btn-ghost'}`} data-testid={`pricing-choose-${p.id}`}><Slide>Choose {p.name}</Slide></Link>
    </Reveal>
  );
}

// While landline texting is paused, the card sells the USA Texting Number (international texting coming soon).
function TextingNumberCard({ t, start, delay }) {
  const pts = ['Unlimited texts on a USA number', 'Read and reply to every text in the app', 'More countries in the app, pay per text'];
  return (
    <Reveal delay={delay} className="civr-l-card-cream p-8 flex flex-col" data-testid="civr-plan-card-texting">
      <div className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500" data-testid="pricing-texting-eyebrow">Texting Number</div>
      <div className="flex items-center justify-between gap-2 mt-1"><div className="text-lg font-semibold text-slate-900">Texting plan</div><span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-900 grid place-items-center"><MessageSquareText className="w-4 h-4" /></span></div>
      <div className="civr-l-h text-5xl text-slate-900 mt-6" data-testid="pricing-price-texting">{usd(t.numberPrice ?? 50)}<span className="text-base font-medium tracking-normal text-slate-500">/month</span></div>
      <div className="text-sm text-slate-500 mt-2" data-testid="pricing-allowance-texting">USA: unlimited texts, no per-text fees</div>
      <ul className="mt-6 pt-6 border-t civr-l-rule flex-1 space-y-2.5 text-sm text-slate-700">{pts.map(x => <li key={x} className="flex gap-2"><Check className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />{x}</li>)}</ul>
      <Link to={start('textnum')} className="civr-l-btn civr-l-btn-ghost mt-8 w-full" data-testid="pricing-choose-texting"><Slide>Get texting</Slide></Link>
    </Reveal>
  );
}

// The 4th plan: texting on a number the customer already has (calls stay with their carrier).
export function TextingCard({ t, start, delay }) {
  if (t && t.available === false) return <TextingNumberCard t={t} start={start} delay={delay} />;
  const pts = ['Incoming texts are free', 'Keep your number and your calls', 'Read every text in the app', 'USA & Canada landline or toll-free'];
  return (
    <Reveal delay={delay} className="civr-l-card-cream p-8 flex flex-col" data-testid="civr-plan-card-texting">
      <div className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500" data-testid="pricing-texting-eyebrow">Landline to Texting</div>
      <div className="flex items-center justify-between gap-2 mt-1"><div className="text-lg font-semibold text-slate-900">Texting plan</div><span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-900 grid place-items-center"><MessageSquareText className="w-4 h-4" /></span></div>
      <div className="civr-l-h text-5xl text-slate-900 mt-6" data-testid="pricing-price-texting">{usd(t.setup)}<span className="text-base font-medium tracking-normal text-slate-500"> to start</span></div>
      <div className="text-sm text-slate-500 mt-2" data-testid="pricing-allowance-texting">{`first month included, then ${usd(t.monthly)}/month · receive texts on the number you already have`}</div>
      <p className="text-sm text-slate-700 mt-4" data-testid="pricing-texting-explainer">Landline to Texting lets customers text the office number they already call. Calls stay with your carrier.</p>
      <ul className="mt-6 pt-6 border-t civr-l-rule flex-1 space-y-2.5 text-sm text-slate-700">{pts.map(x => <li key={x} className="flex gap-2"><Check className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />{x}</li>)}</ul>
      <Link to={start('texting')} className="civr-l-btn civr-l-btn-ghost mt-8 w-full" data-testid="pricing-choose-texting"><Slide>Start texting</Slide></Link>
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
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mt-12 items-stretch">{plans.map((p, i) => <PlanCard key={p.id} p={p} plans={plans} hot={hasRec ? p.recommended : i === 1} start={start} delay={i * 120} />)}{catalog?.texting && <TextingCard t={catalog.texting} start={start} delay={plans.length * 120} />}</div>
        {r && (
          <p className="text-sm text-slate-500 mt-8 max-w-3xl" data-testid="pricing-extra-usage">
            {`Outgoing calls, forwarding and AI conversations are paid from your wallet. Extra numbers cost from ${usd(catalog?.extraNumber?.price || 25)}/month each and share the plan's features.`}
          </p>
        )}
        <PlanCompare catalog={catalog} start={start} />
        <PaymentMethods catalog={catalog} className="mt-12 pt-8 border-t civr-l-rule" testid="pricing-payment-methods" />
      </div>
    </section>
  );
}

// Also used by the in-app Help centre.
export function faqItems(c) {
  const from = startPrice(c);
  const on = (k, d) => andList((c?.plans || []).filter(p => p.access?.[k]).map(p => p.name)) || d;
  const ivr = on('ivr', 'Pro and Business'), out = on('ivrOutbound', 'Pro and Business');
  const ex = c?.extraNumber;
  return [
    ['What does each plan include?', `Every plan comes with Emily, who sets things up with you by chatting. Basic gets you a business number: call forwarding, voicemail, the browser phone, SIP logins for desk phones and softphones, and the AI receptionist (per minute). Plus helps you answer like a business: the keypad menu, ring groups, call recording and AI call summaries. Pro reaches out to your customers: Quick IVR calls, recorded-message campaigns, AI conversation campaigns (an AI talks with each lead), verifying your customers identity via OTP, scheduling, saved presets and one saved voice. Business adds full control: call from any number, redial, your own messages for codes, Text Triggers, text calls, encrypted calls and priority support.`],
    ['How does texting work?', 'We sell three kinds of number. A calling number is for calls, and texting can be switched on as an optional add-on where the number supports it. A calls + texting number does both, priced like a calling number (free with the plan in the USA, Canada and UK, plus a country charge elsewhere) and you pay per text sent. USA texting starts once your business texting registration ($49 once) is approved. For a USA number on your own phone, or texting only in your browser, see USA eSIM. A fax number only sends and receives faxes.'],
    ['Is the USA calls + texting number or the eSIM VoIP?', 'No. Both are real mobile numbers on a USA carrier, not VoIP, with two-way texts. The eSIM runs on your phone; the calls + texting number lives in CloudIVR, and you read and send its texts in Messages in any browser.'],
    ['Can I receive texts, not just send them?', 'Yes. Both have two-way SMS, inbound and outbound. The eSIM sends and receives texts on your phone. The calls + texting number sends and receives them in CloudIVR Messages, including verification codes.'],
    ['Does it work with my bank?', 'It’s a real carrier number, and most banks and apps accept it for sign-ups and verification codes. Each service sets its own rules, so we can’t promise every one will.'],
    ['What is a fax number?', 'A number that only sends and receives faxes, online — in the USA, Canada, UK and 26 more countries. It never takes calls or texts. For calls pick a Calls number; for texts, a Calls + texting number.'],
    ['How much does fax cost?', 'A fax number is $50 a month and includes 25 free pages a month (sent and received). After that, each page is $0.05 from your wallet, charged only when a fax is delivered or received. Some countries need your name and address, others an ID or company document, plus a quick e-signature; the carrier approves those within a few days, with a full refund if it says no.'],
    ['Can I pick my fax number before I sign up?', 'Yes. Search by country and area code on this page, pick your number, then create your free account and pay from your wallet. If an area code has no fax numbers, we show nearby ones.'],
    ['How do I send and receive faxes?', 'Upload a PDF or photo in CloudIVR and send it to one number or up to 500 at once, with an optional cover page. Faxes sent to your number arrive as PDFs in CloudIVR and by email.'],
    ['Can I choose my USA calls + texting number?', 'You pick a USA ZIP code and we ask the carrier for a number near it. It’s a preference: the area code and the exact number can’t be chosen.'],
    ['When do I get my USA number or eSIM?', 'After your payment is confirmed. It’s usually ready within minutes, and sometimes takes longer. The eSIM QR code is shown in the app and emailed to the address you enter; the calls + texting number appears under My numbers.'],
    ['Can the USA calls + texting number make calls?', 'Yes, outgoing calls from the browser phone, paid from your wallet. The number is also a free verified caller ID for your other CloudIVR calls.'],
    ['What happens if I don’t renew my USA number or eSIM?', 'The USA calls + texting number renews at $50 a month and the eSIM at its plan price, from your wallet. If your wallet is short, the line pauses until you top up and tap Renew. If you turn auto-renew off, the line ends after the paid month. Cancelling ends it straight away with no refund for the current month, and the number can’t be recovered.'],
    ['Can I replace the number?', 'Yes, for $25. The carrier assigns the new number; you can’t choose it. If the carrier refuses, or doesn’t assign one within 24 hours, the $25 goes back to your wallet.'],
    ['Can I try it before I pay?', 'Yes, twice. Without an account: confirm your email with a 6-digit code and take one free test call of up to 60 seconds — we ring your phone with a demo menu, or you call from your browser. After you sign up: place one free Quick IVR call from our number — it plays your script to anyone you choose, then connects them to you when they press 1 or collects a code you accept or decline.'],
    ['Is the account really free?', `Yes. Creating an account costs nothing. You only pay when you buy a number${from ? ` (from ${from}/month)` : ''}, plus any extra usage.`],
    ['How do I pay?', c?.cardPayments ? `From your CloudIVR wallet. Top up from ${usd(c?.minTopup || 10)} by card or crypto, and renewals and calls are paid from it.` : `From your CloudIVR wallet. Top up from ${usd(c?.minTopup || 10)} and renewals and calls are paid from it. Top-ups are by crypto today; card payments are coming soon.`],
    ['What’s the difference between the keypad menu and Quick or Bulk IVR?', `They work in opposite directions. The keypad menu answers people who call your number: they hear your greeting and press a key to reach the right person, a message or voicemail (${ivr}). Quick IVR and Bulk IVR call people for you: they hear your message, then press a key to reach you, type a code or pick an option — Quick IVR for up to 10 numbers at once, Bulk IVR campaigns for a whole list (${out}).`],
    ['What’s the difference between the keypad menu and the AI receptionist?', `The keypad menu plays your greeting and callers press a key to reach the right person, message or voicemail — it uses your plan minutes. The AI receptionist holds a real conversation with callers instead: it answers questions, books appointments and takes messages, paid from your wallet. Each number uses one or the other. The same AI can also call your leads in an AI conversation campaign.`],
    ['What if I go over my minutes?', 'Extra usage is paid from your wallet at a small rate. Our support chat can tell you the exact rates any time.'],
    ['Are outgoing calls included in my minutes?', 'No. Plan minutes cover incoming calls you answer. Outgoing calls — browser phone, softphone, Quick IVR, campaigns and AI conversations — and forwarded calls are billed per minute from your wallet.'],
    ...(ex ? [['Can I put several numbers on one plan?', `Yes. Add extra numbers to a main number from ${usd(ex.price)}/month each — up to ${ex.limits.starter} on Basic, ${ex.limits.standard} on Plus, ${ex.limits.pro} on Pro and ${ex.limits.business} on Business. They share its plan and get the same features.`]] : []),
    ['Can I cancel?', 'Yes. Plans are month to month. Auto-renew is on by default so your number never lapses — turn it off in the number’s Billing tab and it simply won’t renew, or delete the number any time.'],
    ['What happens if the AI can’t help?', 'It never pretends to be human and never asks for card numbers, passwords or one-time codes. When a caller wants a person, the agent transfers the call to the number you set — or, if you haven’t set one, offers to take a message with a name, callback number and the message, which lands in your inbox. On a keypad menu, callers can always reach voicemail. Anyone who asks not to be called again is removed from the list and the call ends politely.'],
    ['Do you scrub numbers or enforce quiet hours?', 'Your do-not-call list is enforced on every campaign — recorded message and AI conversation, web and Telegram bot: numbers on it are never dialed and never billed. We don’t check public Do-Not-Call registries for you and we don’t enforce quiet hours automatically: you schedule each campaign, set a daily call limit and repeat it daily or weekly, and you’re responsible for calling only people who have agreed to hear from you, at reasonable hours where they live.'],
    ['Is this the same account as the Telegram bot?', 'No. CloudIVR web accounts are separate from Telegram bot accounts, so sign up here with your email.'],
  ];
}

const FAQ_FIRST = 6;
// The landing page leads with what first-time visitors ask most; the Help centre keeps the full order.
const FIRST_QS = ['How does texting work?', 'What does each plan include?', 'How much does fax cost?', 'Can I try it before I pay?', 'How do I pay?', 'Can I cancel?'];
const byPriority = (items) => [...FIRST_QS.map(q => items.find(x => x[0] === q)).filter(Boolean), ...items.filter(x => !FIRST_QS.includes(x[0]))];
export function Faq({ catalog }) {
  const [all, setAll] = useState(false);
  const items = byPriority(faqItems(catalog));
  return (
    <section id="faq" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="faq-section">
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-20 md:py-24">
        <Reveal><div className="civr-l-eyebrow">FAQ</div><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950 mt-3">Questions, answered</h2></Reveal>
        <div className="mt-10 divide-y civr-l-rule border-y civr-l-rule" data-testid="faq-list">
          {items.slice(0, all ? items.length : FAQ_FIRST).map(([q, a], i) => (
            <details key={q} className="civr-faq-item" data-testid={`faq-item-${i}`}>
              <summary className="flex items-center justify-between gap-4 cursor-pointer py-5 min-h-[56px] text-base font-semibold text-slate-950" data-testid={`faq-question-${i}`}>{q}<ChevronDown className="civr-faq-chevron w-5 h-5 shrink-0 text-[#1d6fd8]" aria-hidden="true" /></summary>
              <p className="pb-6 text-base leading-relaxed text-slate-600" data-testid={`faq-answer-${i}`}>{a}</p>
            </details>
          ))}
        </div>
        {items.length > FAQ_FIRST && <button type="button" onClick={() => setAll(v => !v)} aria-expanded={all} className="mt-6 inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-[#1d6fd8]" data-testid="faq-show-all">{all ? 'Show fewer questions' : `Show all ${items.length} questions`}<ChevronDown className={`w-4 h-4 transition-transform ${all ? 'rotate-180' : ''}`} aria-hidden="true" /></button>}
      </div>
    </section>
  );
}

export function FinalCta({ catalog }) {
  const start = useStart();
  const from = startPrice(catalog);
  return (
    <section className="civr-l-cream pb-20 md:pb-24" data-testid="final-cta">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <Reveal className="civr-l-ondark relative overflow-hidden rounded-3xl bg-[#07060f] ring-1 ring-white/10 px-8 py-16 md:px-16 md:py-20 text-center">
          <div className="relative">
            <h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl text-white max-w-3xl mx-auto">Your business number, live in minutes.</h2>
            <p className="text-base mt-5 text-slate-300">Free to sign up{from ? ` · from ${from}/month` : ''} · no contract</p>
            <div className="flex justify-center mt-9">
              <Link to={start()} className="civr-l-pill civr-l-pill-ink" data-testid="final-cta-button"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FOOTER_KINDS = [['ivr', 'Calls', 'calls'], ['mobile', 'Calls + texting', 'texting'], ['fax', 'Fax only', 'fax'], ['esim', 'USA eSIM', 'esim']];
// Opens the pricing tab for a kind of number; off the landing page the link carries it as #pricing-<tab>.
const openKind = (tab, e) => { if (!document.getElementById('pricing')) return; e.preventDefault(); window.dispatchEvent(new CustomEvent('civr-pricing-tab', { detail: tab })); };
const fLink = 'text-sm text-slate-600 hover:text-slate-950 transition-colors min-h-[44px] flex items-center text-left';

function FooterCol({ title, children, testid }) {
  return <div data-testid={testid}><div className="text-xs font-semibold uppercase tracking-[.14em] text-slate-900 mb-4">{title}</div><div className="flex flex-col">{children}</div></div>;
}

// Mega footer (cm.com style). Product links open the matching platform tab; on other pages they go back to the landing page.
export function Footer({ catalog }) {
  const base = cp();
  const start = useStart();
  const { account } = useCivrAuth();
  return (
    <footer className="bg-slate-50 text-slate-900 border-t border-slate-200" data-testid="landing-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 pt-16 pb-10">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="font-display text-2xl font-extrabold flex items-center gap-2" data-testid="landing-footer-logo"><Wordmark accent="#059669" iconClass="w-8 h-8" /></div>
            <p className="text-sm text-slate-600 mt-4 max-w-xs">Business numbers for calls, texts and fax, with menus, SIP and an AI receptionist — all in your browser.</p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link to={start()} className="civr-l-pill civr-l-pill-ink civr-l-pill-sm min-h-[44px]" data-testid="footer-cta-signup">Get your number</Link>
              {account ? <Link to={cp('/app')} className="civr-l-pill civr-l-pill-outline civr-l-pill-sm min-h-[44px]" data-testid="footer-link-dashboard">Open dashboard</Link> : <Link to={cp('/login')} className="civr-l-pill civr-l-pill-outline civr-l-pill-sm min-h-[44px]" data-testid="footer-link-signin">Sign in</Link>}
            </div>
            <SocialLinks />
          </div>
          <div className="lg:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-8">
            <FooterCol title="Numbers" testid="footer-col-product">
              {FOOTER_KINDS.map(([tab, l, id]) => <a key={id} href={`${base}#pricing-${tab}`} onClick={(e) => openKind(tab, e)} className={fLink} data-testid={`footer-product-${id}`}>{l}</a>)}
            </FooterCol>
            <FooterCol title="Who it’s for" testid="footer-col-audiences">
              {AUDIENCES.map(a => <Link key={a.slug} to={cp(`/for/${a.slug}`)} className={fLink} data-testid={`footer-for-${a.slug}`}>{a.short}</Link>)}
            </FooterCol>
            <FooterCol title="CloudIVR" testid="footer-col-company">
              {[['#how', 'How it works', 'how'], ['#try', 'Free test call', 'try'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']].map(([h, l, id]) => <a key={id} href={`${base}${h}`} onClick={(e) => { if (document.querySelector('[data-testid="landing-page"]')) goTo(h, e); }} className={fLink} data-testid={`footer-link-${id}`}>{l}</a>)}
              <Link to={cp('/sip')} className={fLink} data-testid="footer-link-sip">SIP & softphones</Link>
            </FooterCol>
            <FooterCol title="Support & legal" testid="footer-col-support">
              {catalog?.supportLink && <a href={catalog.supportLink} target="_blank" rel="noopener noreferrer" className={`${fLink} flex items-center gap-2`} data-testid="footer-support-link"><MessageCircle className="w-4 h-4" />Support on Telegram</a>}
              {catalog?.channelLink && <a href={catalog.channelLink} target="_blank" rel="noopener noreferrer" className={`${fLink} flex items-center gap-2`} data-testid="footer-channel-link"><Send className="w-4 h-4" />Telegram channel</a>}
              <Link to={cp('/terms')} className={fLink} data-testid="footer-link-terms">Terms of Service</Link>
              <Link to={cp('/terms#privacy')} className={fLink} data-testid="footer-link-privacy">Privacy</Link>
              <Link to={cp('/terms#legal-notice')} className={fLink} data-testid="footer-link-legal-notice">Legal notice</Link>
              <button type="button" onClick={openCookieSettings} className={fLink} data-testid="footer-link-cookies">Cookie settings</button>
            </FooterCol>
          </div>
        </div>
        <div className="mt-14 pt-8 border-t border-slate-200 flex flex-col md:flex-row md:items-end gap-6 justify-between">
          <PaymentMethods catalog={catalog} label="We accept" testid="footer-payment-methods" />
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-slate-900 hover:text-[color:var(--np-blue)] min-h-[44px] md:order-last" data-testid="footer-back-to-top"><ArrowUp className="w-4 h-4" />Back to top</button>
          <div className="text-xs text-slate-500 md:whitespace-nowrap" data-testid="footer-copyright">{COPYRIGHT()}</div>
        </div>
      </div>
    </footer>
  );
}
