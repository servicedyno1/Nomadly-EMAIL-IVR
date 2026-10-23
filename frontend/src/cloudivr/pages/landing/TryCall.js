import React, { useState } from 'react';
import { Loader2, PhoneCall, Laptop, MailCheck, Timer, ShieldCheck } from 'lucide-react';
import { SectionHead, Slide } from './kit';
import EmailGate from './EmailGate';
import { CallMeLive, BrowserLive, Keypad } from './TryLive';
import { savedToken, saveToken, clearToken, startCall } from './tryApi';

const TABS = [
  ['callme', 'We call your phone', PhoneCall, 'Enter your number. We ring you with a live demo menu — press 1, 2 or 3 and watch each key light up here.', 'civr-callme', 'Call me'],
  ['browser', 'Call from this browser', Laptop, 'Call any phone from this tab using your microphone — no app needed. Try calling your own mobile.', 'civr-browser', 'Browser'],
];
const POINTS = [[MailCheck, 'Confirm your email with a 6-digit code'], [Timer, 'One free call per email, up to 60 seconds'], [ShieldCheck, 'No account, no card, no catch']];
const E164 = /^\+[1-9]\d{7,14}$/;

function TryForm({ tab, to, setTo, busy, onSubmit }) {
  const [, , , text, id] = TABS.find(t => t[0] === tab);
  return (
    <form onSubmit={onSubmit} noValidate data-testid={`${id}-form`}>
      <p className="text-sm civr-l-muted min-h-[40px]">{text}</p>
      <label className="block mt-6">
        <span className="block text-xs font-mono uppercase tracking-widest civr-l-muted mb-2">{tab === 'callme' ? 'Your phone number' : 'Number to call'}</span>
        <input className="civr-l-input" type="tel" inputMode="tel" placeholder="+14155550100" value={to} onChange={e => setTo(e.target.value)} data-testid={tab === 'callme' ? 'civr-callme-phone-input' : 'civr-browser-phone-input'} />
      </label>
      <button className="civr-l-btn w-full mt-4" disabled={busy} data-testid={tab === 'callme' ? 'civr-callme-start-btn' : 'civr-browser-call-btn'}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}<Slide>{tab === 'callme' ? 'Ring my phone' : 'Start browser call'}</Slide>
      </button>
      {tab === 'callme' && <div className="mt-6 opacity-60 pointer-events-none" aria-hidden="true"><Keypad labels={{ 1: 'Forwarding', 2: 'Voicemail', 3: 'Campaigns' }} /></div>}
    </form>
  );
}

export function TryCall() {
  const [tab, setTab] = useState('callme');
  const [to, setTo] = useState('');
  const [gate, setGate] = useState(false);
  const [call, setCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const number = to.replace(/[\s().-]/g, '').replace(/^00/, '+');

  const begin = async (t) => {
    setBusy(true); setError(null);
    try { setCall(await startCall(tab, t.token, number)); } catch (e) {
      if (e.status === 401) { clearToken(); setGate(true); } else setError(e);
    } finally { setBusy(false); }
  };
  const submit = (e) => {
    e.preventDefault();
    if (!E164.test(number)) { setError(new Error('Start with + and your country code, e.g. +14155550100.')); return; }
    const t = savedToken();
    if (t) begin(t); else { setError(null); setGate(true); }
  };
  const verified = (d) => { saveToken(d.token, d.email); setGate(false); begin(d); };

  return (
    <section id="try" className="civr-l-dark relative overflow-hidden scroll-mt-16" data-testid="try-section">
      <div className="absolute inset-0 civr-l-gridbg opacity-50" />
      <div className="civr-l-glow w-[460px] h-[460px] bg-[#00E3AA]/10 -left-40 bottom-0" />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 py-24 grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5">
          <SectionHead n="02" label="Free test call" title="Hear it before you buy." sub="Take CloudIVR for a 60-second spin — on your own phone or right here in the browser." />
          <ul className="mt-10 grid gap-5">
            {POINTS.map(([Icon, t], i) => <li key={t} className="flex items-center gap-4" data-testid={`try-point-${i}`}><span className="w-11 h-11 rounded-full border civr-l-rule flex items-center justify-center shrink-0"><Icon className="w-5 h-5 text-[#00E3AA]" /></span><span className="text-sm">{t}</span></li>)}
          </ul>
        </div>
        <div className="lg:col-span-7">
          <div className="civr-l-card p-6 md:p-8" data-testid="try-card">
            {!call && (
              <div role="tablist" className="grid grid-cols-2 sm:inline-flex gap-1 p-1 rounded-full border civr-l-rule mb-6 w-full sm:w-fit">
                {TABS.map(([id, label, Icon, , , short]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setError(null); }} className="civr-l-tab inline-flex items-center justify-center gap-2 whitespace-nowrap" data-testid={id === 'callme' ? 'civr-test-tab-callme' : 'civr-test-tab-browser'}><Icon className="w-4 h-4" /><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></button>
                ))}
              </div>
            )}
            {call ? (call.kind === 'browser' ? <BrowserLive call={call} onReset={() => setCall(null)} /> : <CallMeLive call={call} onReset={() => setCall(null)} />)
              : <TryForm tab={tab} to={to} setTo={setTo} busy={busy} onSubmit={submit} />}
            {error && !call && <div className="mt-4 text-sm text-[#fb7185] border border-[#fb7185]/30 bg-[#fb7185]/10 rounded-xl px-4 py-3" data-testid="civr-try-error">{error.message}</div>}
          </div>
        </div>
      </div>
      <EmailGate open={gate} onClose={() => setGate(false)} onVerified={verified} />
    </section>
  );
}
