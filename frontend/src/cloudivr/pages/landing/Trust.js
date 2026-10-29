import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, PhoneOff, Bot, Disc3, Fingerprint, Lock, ArrowRight } from 'lucide-react';
import { SectionHead, Reveal } from './kit';
import { cp } from '../../paths';
import { openCookieSettings } from '../../consent';

// Says only what the platform does today (terms, do-not-call engine, AI agent rules). Not legal advice.
const POINTS = [
  [ShieldCheck, 'Consent is yours to hold', 'Automated, pre-recorded and AI calls need the consent the law requires. Before any campaign runs you confirm you have it — and that you may contact everyone on your list. It’s in our terms, and we enforce them.'],
  [PhoneOff, 'Opt-outs are honoured everywhere', 'Your do-not-call list applies to every campaign — Bulk IVR and AI, web and Telegram bot. Numbers on it are never dialled and never billed. Tell the AI agent “don’t call me again” and it apologises, removes you and ends the call.'],
  [Bot, 'You choose how it introduces itself', 'Turn the “I’m an AI” intro on or off per agent — on by default. Either way it never claims to be human if asked, never asks for card numbers, passwords or one-time codes, and passes callers to a person on request or takes a message. Check the rules where you call.'],
  [Disc3, 'Recording stays your call', 'Some places need everyone on a call to agree before it’s recorded. Recording, voicemail, transcripts and AI summaries are off until you switch them on — and when you do, telling callers is on you. Our terms spell it out.'],
  [Fingerprint, 'Your caller ID is yours', 'Campaigns dial from your own CloudIVR number, never a spoofed one. Code collection is only for verifying your own customers, and accounts that break the rules are stopped — campaigns included.'],
];
const LINKS = [['/terms#use', 'Acceptable use', 'use'], ['/terms#recordings', 'Recordings & AI', 'recordings'], ['/terms#privacy', 'Your data', 'privacy'], ['/terms', 'Terms of Service', 'terms']];

export function Trust() {
  return (
    <section id="trust" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="trust-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <div className="grid lg:grid-cols-12 gap-8 items-end">
          <div className="lg:col-span-8"><SectionHead label="Trust & compliance" title="Built for calling you can stand behind." sub="Outbound campaigns, recordings and AI agents come with rules. Here is what CloudIVR does about them — today, not someday." /></div>
          <Reveal delay={120} className="lg:col-span-4 flex items-center gap-3 text-sm text-slate-600 lg:justify-end" data-testid="trust-data-note"><Lock className="w-4 h-4 text-slate-900 shrink-0" />We don’t sell your data. Logs, recordings and transcripts stay in your account.</Reveal>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-4 mt-12" data-testid="trust-grid">
          {POINTS.map(([Icon, title, text], i) => (
            <Reveal key={title} delay={i * 80} className={`civr-np-card civr-np-${['pink', 'green', 'blue'][i % 3]} p-6 md:p-7 ${i < 3 ? 'lg:col-span-2' : 'lg:col-span-3'} ${i === POINTS.length - 1 && POINTS.length % 2 ? 'md:col-span-2' : ''}`} data-testid={`trust-point-${i}`}>
              <span className="civr-np-accent w-11 h-11 rounded-xl border border-current grid place-items-center"><Icon className="w-5 h-5" /></span>
              <div className="text-2xl font-bold text-slate-900 mt-6 leading-tight">{title}</div>
              <p className="text-[15px] text-slate-600 mt-3 leading-relaxed">{text}</p>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200} className="mt-10 pt-8 border-t civr-l-rule flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="trust-links">
            {LINKS.map(([to, label, id]) => <Link key={id} to={cp(to)} className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-slate-900 hover:text-slate-600 transition-colors group" data-testid={`trust-link-${id}`}>{label}<ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" /></Link>)}
            <button type="button" onClick={openCookieSettings} className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-slate-900 hover:text-slate-600 transition-colors" data-testid="trust-link-cookies">Cookie settings</button>
          </div>
          <p className="text-xs text-slate-500 md:ml-auto md:text-right max-w-md" data-testid="trust-disclaimer">This describes what CloudIVR does today. It is not legal advice — the rules for calling depend on where you and your callers are.</p>
        </Reveal>
      </div>
    </section>
  );
}
