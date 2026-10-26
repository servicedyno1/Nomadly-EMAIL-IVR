import React from 'react';
import { toast } from 'sonner';
import { Copy, Globe, Headphones, Info, KeyRound, Smartphone, Monitor, Hash, UserPlus, Wallet, Workflow, ArrowRight } from 'lucide-react';
import { SectionHead, Reveal, Slide } from '../landing/kit';
import { SIP_APPS, sipDomain } from './shared';

export function Benefits({ catalog }) {
  const n = catalog?.countries?.length || 17;
  const items = [
    [Headphones, 'Use the app you already like', 'Zoiper, MicroSIP, Linphone or the desk phone on your desk. Enter three details and you’re registered.'],
    [Globe, `Local numbers in ${n} countries`, 'Local, mobile and toll-free numbers your customers recognise — and pick up.'],
    [Workflow, 'A full phone system included', 'Voicemail with transcripts, a keypad menu, call recording, ring groups and an SMS inbox come with every SIP plan.'],
    [Wallet, 'No PBX, no contract', 'Month to month, per number. Incoming calls use your plan minutes; outgoing calls are billed per minute from your wallet.'],
  ];
  return (
    <section id="why" className="civr-l-cream scroll-mt-16" data-testid="sip-benefits">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="Why CloudIVR SIP" title="Keep your phone app. Get a better number behind it." sub="A real number, a simple SIP login and a full phone system — without a PBX to run." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12">
          {items.map(([Icon, t, s], i) => (
            <Reveal key={i} delay={i * 90} className="civr-l-card-cream p-6 md:p-8" data-testid={`sip-benefit-${i}`}>
              <span className="w-10 h-10 rounded-xl bg-indigo-50 text-[#4f46e5] grid place-items-center"><Icon className="w-5 h-5" /></span>
              <div className="text-lg font-semibold text-slate-900 mt-6">{t}</div>
              <p className="text-sm text-slate-600 mt-2">{s}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const APP_ICON = { zoiper: Smartphone, microsip: Monitor, linphone: Smartphone, desk: Headphones };

function ConnectionCard({ domain }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(domain); toast.success('Server copied'); } catch (_) { toast.error('Couldn’t copy — select the address instead.'); }
  };
  const rows = [['Port', '5060 (UDP/TCP) · 5061 (TLS)', 'port'], ['Username', 'On your number’s SIP tab', 'username'], ['Password', 'On your number’s SIP tab', 'password']];
  return (
    <Reveal className="civr-l-dark relative overflow-hidden rounded-3xl p-6 md:p-8 h-fit" data-testid="sip-connection-card">
      <div className="absolute inset-0 civr-l-gridbg opacity-60" />
      <div className="relative">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#a5b4fc]"><KeyRound className="w-4 h-4" />Your connection details</div>
        <div className="text-xs civr-l-muted mt-6">Server / domain</div>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate rounded-xl bg-white/5 border border-white/10 px-4 py-3 font-mono text-base text-white" data-testid="sip-connection-server" data-no-translate>{domain}</code>
          <button type="button" onClick={copy} className="civr-l-btn civr-l-btn-ghost civr-l-btn-sm shrink-0" aria-label="Copy server address" data-testid="sip-copy-server"><Copy className="w-4 h-4" />Copy</button>
        </div>
        <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
          {rows.map(([k, v, id]) => (
            <div key={id} className="flex items-center justify-between gap-4 py-3" data-testid={`sip-connection-${id}`}>
              <span className="text-sm civr-l-muted">{k}</span>
              <span className={`text-sm text-right ${id === 'port' ? 'font-mono text-white' : 'text-white/90'}`}>{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-3 rounded-2xl bg-white/5 border border-white/10 p-4" data-testid="sip-browser-note">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#a5b4fc]" />
          <p className="text-sm text-white/80">{`${domain} is a server address for phone apps, not a web page — that’s why it doesn’t open in a browser. Type it into your app as the SIP server.`}</p>
        </div>
        <a href="#plans" className="civr-l-btn w-full mt-6" data-testid="sip-connection-cta"><Slide>Get your SIP login</Slide><ArrowRight className="w-4 h-4" /></a>
      </div>
    </Reveal>
  );
}

export function Apps({ catalog }) {
  const domain = sipDomain(catalog);
  return (
    <section id="apps" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="sip-apps-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="Works with your phone app" title="Three details. Any SIP app." sub="Pick a free softphone or use the desk phone you already have. Your login is on the number’s SIP tab as soon as the number is live." />
        <div className="grid lg:grid-cols-12 gap-6 mt-12 items-start">
          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
            {SIP_APPS.map((a, i) => {
              const Icon = APP_ICON[a.id] || Smartphone;
              return (
                <Reveal key={a.id} delay={i * 80} className="civr-l-card-cream p-6 flex flex-col" data-testid={`sip-app-${a.id}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-indigo-50 text-[#4f46e5] grid place-items-center shrink-0"><Icon className="w-5 h-5" /></span>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900" data-no-translate={a.id === 'desk' ? undefined : true}>{a.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{a.where}</div>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 mt-4">{a.how}</p>
                </Reveal>
              );
            })}
          </div>
          <div className="lg:col-span-5"><ConnectionCard domain={domain} /></div>
        </div>
      </div>
    </section>
  );
}

export function Steps() {
  const steps = [
    [UserPlus, 'Choose a plan and sign up', 'Create your free account with your email. No card, no contract, no setup fee.'],
    [Hash, 'Pick your number', 'Choose a country and a local, mobile or toll-free number. Most numbers go live in about a minute.'],
    [KeyRound, 'Paste your SIP login', 'Copy the username and password into your app. When it shows “Registered”, you can call out and answer.'],
  ];
  return (
    <section id="how" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="sip-steps">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="How it works" title="Ringing on your softphone in three steps." />
        <ol className="grid md:grid-cols-3 gap-4 mt-12">
          {steps.map(([Icon, t, s], i) => (
            <Reveal as="li" key={t} delay={i * 120} className="civr-l-card-cream p-6 md:p-8" data-testid={`sip-step-${i + 1}`}>
              <div className="flex items-center justify-between"><span className="w-8 h-8 rounded-full bg-[#4f46e5] text-white text-sm font-semibold grid place-items-center">{i + 1}</span><Icon className="w-5 h-5 text-slate-400" /></div>
              <div className="text-xl font-semibold text-slate-900 mt-6">{t}</div>
              <p className="text-sm text-slate-600 mt-2">{s}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
