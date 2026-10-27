import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Workflow, Megaphone, Bot, PhoneForwarded, Voicemail, Headphones, MessageSquare, Captions, ArrowRight, PhoneCall } from 'lucide-react';
import { SectionHead, Reveal, Slide } from './kit';
import { Badge } from './Sections';
import { useStart } from './PricingFaq';
import { IvrMock, OutboundMock, AiMock } from './Mockups';
import { ForwardingMock, VoicemailMock, SmsMock, BrowserPhoneMock, TextCallMock } from './MockupsLive';

const ITEMS = [
  ['ivr', Workflow, 'Inbound', 'Keypad menu (IVR)', 'Route every caller in under a second', 'Sound like a big company from day one. Callers hear your greeting and press 1 for sales, 2 for support or 3 for voicemail — routed in under a second. Start from a template, use a natural AI voice or your own recording, and see which keys people press. Uses your plan minutes.', 'ivr', IvrMock],
  ['campaigns', Megaphone, 'Outbound', 'Quick IVR & Bulk IVR campaigns', 'Call a whole list and watch it live', 'Put your outreach on autopilot. We call your list, play your script, then connect everyone who presses 1, collect a code you accept or decline, or route each key. Watch every campaign live — who is ringing, who is talking and which areas answer most — repeat it every day or week and cap the calls per day. Your first Quick IVR call is on us.', 'ivrOutbound', OutboundMock],
  ['ai', Bot, 'Inbound & outbound', 'AI voice agents', 'Talks, books and passes hot calls to you', 'Your best rep on every line, 24/7. It talks naturally in 20 languages — answers questions, books appointments, takes messages and passes hot calls to you. Point it at your leads and it calls them too. Billed per minute from your wallet.', 'aiAgent', AiMock],
  ['forwarding', PhoneForwarded, 'Inbound', 'Call forwarding', 'Ring any phone, with up to 4 backups', 'Never miss a deal. Ring any phone worldwide — always, when you’re busy or when you don’t pick up — with up to 4 backup numbers. Billed per minute from your wallet.', 'callForwarding', ForwardingMock],
  ['voicemail', Voicemail, 'Inbound', 'Voicemail', 'Every message transcribed', 'Greetings in several languages or your own audio. Every message lands in your inbox and email, transcribed so you can read it in seconds.', 'voicemail', VoicemailMock],
  ['phone', Headphones, 'Anywhere', 'Browser phone', 'Calls from any tab, nothing to install', 'Make and take calls from any browser tab on every plan — nothing to install. On Pro and up, also sign in from a SIP softphone or desk phone. Your office goes wherever you go.', 'browserPhone', BrowserPhoneMock],
  ['sms', MessageSquare, 'Messaging', 'SMS inbox', 'Read and reply to every text', 'Read and reply to every text in one inbox. Push them to email or your own system with webhooks on Pro and up.', null, SmsMock],
  ['text', Captions, 'Accessibility', 'Text calls', 'Type to talk, read what they say', 'Built for deaf and hard-of-hearing callers: you type, and a natural voice speaks each sentence the moment you finish it; they talk, and you read their words live. Soft typing sounds keep the line from going quiet.', 'textRelay', TextCallMock],
];
const IDS = ITEMS.map(x => x[0]);

// cm.com "The platform" pattern: pick a feature on the left, see it working on the right.
export function Platform({ catalog }) {
  const start = useStart();
  const [sel, setSel] = useState(() => { const h = window.location.hash.replace('#features-', ''); return IDS.includes(h) ? h : 'ivr'; });
  useEffect(() => {
    const on = (e) => { if (IDS.includes(e.detail)) setSel(e.detail); };
    window.addEventListener('civr-platform-tab', on);
    const h = window.location.hash.replace('#features-', '');
    if (IDS.includes(h)) setTimeout(() => document.getElementById('features')?.scrollIntoView({ block: 'start' }), 300);
    return () => window.removeEventListener('civr-platform-tab', on);
  }, []);
  const [, Icon, kicker, title, , text, k, Mock] = ITEMS.find(x => x[0] === sel);
  const keys = (e) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { e.preventDefault(); setSel(IDS[(IDS.indexOf(sel) + d + IDS.length) % IDS.length]); }
  };
  return (
    <section id="features" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="features-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="The platform" title="Inbound, outbound and AI. One number runs it all." sub="Answer every caller, call every lead and keep every text and voicemail in one inbox. Pick a feature to see it working — each one shows the plan that unlocks it." />
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 mt-12 items-start">
          <Reveal className="lg:col-span-4 min-w-0">
            <div role="tablist" aria-orientation="vertical" aria-label="Features" onKeyDown={keys} className="flex lg:flex-col gap-2 overflow-x-auto -mx-6 px-6 lg:mx-0 lg:px-0 pb-2 lg:pb-0 civr-no-scrollbar" data-testid="platform-tabs">
              {ITEMS.map(([id, I, kk, t, short]) => (
                <button key={id} type="button" role="tab" aria-selected={sel === id} aria-controls="platform-panel" tabIndex={sel === id ? 0 : -1} onClick={() => setSel(id)} className="civr-l-ptab" data-testid={`platform-tab-${id}`}>
                  <span className="civr-l-ptab-icon"><I className="w-4 h-4" /></span>
                  <span className="min-w-0 text-left"><span className="block text-sm font-semibold whitespace-nowrap lg:whitespace-normal">{t}</span><span className="hidden lg:block text-xs text-slate-500 mt-0.5">{short}</span></span>
                </button>
              ))}
            </div>
          </Reveal>
          <div id="platform-panel" role="tabpanel" aria-label={title} className="lg:col-span-8 min-w-0" data-testid="platform-panel">
            <div key={sel} className="civr-l-swap civr-l-card-cream p-6 md:p-8 overflow-hidden">
              <div className="flex items-start justify-between gap-4">
                <span className="w-11 h-11 rounded-xl bg-slate-100 text-slate-900 grid place-items-center"><Icon className="w-5 h-5" /></span>
                <Badge plans={catalog?.plans} k={k} />
              </div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-6" data-testid="platform-panel-kicker">{kicker}</div>
              <h3 className="civr-l-h text-2xl sm:text-3xl text-slate-900 mt-2" data-testid="platform-panel-title">{title}</h3>
              <p className="text-sm md:text-base text-slate-600 mt-3 max-w-2xl">{text}</p>
              <div className="mt-8"><Mock /></div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to={start()} className="civr-l-btn civr-l-btn-sm" data-testid="platform-panel-cta"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
                <a href="#try" className="civr-l-btn civr-l-btn-sm civr-l-btn-ghost" data-testid="platform-panel-try"><PhoneCall className="w-4 h-4" /><Slide>Try a free call</Slide></a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
