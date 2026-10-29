import React from 'react';
import { Gauge, Hash, ShoppingCart, PhoneOutgoing, Megaphone, Bot, Inbox, Wallet, PhoneIncoming, Voicemail, MessageSquare, Bell, Play, ChevronRight, Check } from 'lucide-react';
import { Wordmark } from '../../Brand';
import { useInView, useStep, CountUp } from './kit';

// Coded product shots: the real app's dark styling with sample data, sharp at any size.
const NAV = [['Numbers', [[Gauge, 'Overview', true], [Hash, 'My numbers'], [ShoppingCart, 'Buy a number']]], ['Calling', [[PhoneOutgoing, 'Quick IVR call'], [Megaphone, 'Campaigns'], [Bot, 'AI voice agents']]], ['Account', [[Inbox, 'Inbox'], [Wallet, 'Wallet']]]];
const STATS = [['Wallet', '$128.40'], ['Numbers', '3'], ['Minutes', '142'], ['SMS', '36']];
const NUMS = [['+1 415 555 0182', 'United States · Pro', 'Active'], ['+44 20 7946 0958', 'United Kingdom · Business', 'Active'], ['+33 1 84 88 01 12', 'France · Starter', 'Renews 12 Nov']];
const ACT = [[PhoneIncoming, 'Pressed 1 → Sales', '2m 14s', '09:41'], [Voicemail, 'New voicemail', '0m 42s', '09:12'], [MessageSquare, 'SMS received', 'Inbox', '08:57']];

export const Pill = ({ ok, children }) => <span className={`shrink-0 h-5 px-2 rounded-full border text-xs font-medium inline-flex items-center gap-1 ${ok ? 'border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399]' : 'border-[#3a3a3a] text-[#a1a1aa]'}`}>{ok && <span className="w-1.5 h-1.5 rounded-full bg-[#34d399]" />}{children}</span>;
export const Box = ({ className = '', children }) => <div className={`rounded-lg border border-[#262626] bg-[#141414] ${className}`}>{children}</div>;

export function MockFrame({ url = 'cloudivr.net/app', children, className = '', testid }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,.06),0_32px_64px_-32px_rgba(15,23,42,.4)] ${className}`} data-testid={testid}>
      <div className="rounded-xl overflow-hidden bg-[#0a0a0a] text-[#f3f4f6] text-left select-none" aria-hidden="true">
        <div className="flex items-center gap-1.5 px-3 h-8 border-b border-white/[.06] bg-[#111]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#3f3f46]" /><span className="w-2.5 h-2.5 rounded-full bg-[#3f3f46]" /><span className="w-2.5 h-2.5 rounded-full bg-[#3f3f46]" />
          <span className="mx-auto h-5 px-3 rounded-md bg-white/[.05] text-xs font-mono text-[#a1a1aa] inline-flex items-center truncate max-w-[60%]">{url}</span>
          <span className="w-10" />
        </div>
        {children}
      </div>
    </div>
  );
}

function MockSidebar() {
  return (
    <div className="hidden sm:flex flex-col gap-4 w-40 shrink-0 border-r border-white/[.06] p-3">
      <div className="font-display text-base font-extrabold flex items-center gap-1.5 px-1"><Wordmark iconClass="w-5 h-5" /></div>
      {NAV.map(([g, items]) => (
        <div key={g}>
          <div className="px-2 mb-1 text-xs font-mono uppercase tracking-widest text-[#71717a]">{g}</div>
          {items.map(([I, l, on]) => <div key={l} className={`flex items-center gap-2 px-2 h-7 rounded-md text-xs ${on ? 'bg-[#818cf8]/10 text-[#818cf8] font-semibold' : 'text-[#a1a1aa]'}`}><I className="w-3 h-3" />{l}</div>)}
        </div>
      ))}
    </div>
  );
}

function MockNumbers() {
  return (
    <Box className="p-3">
      <div className="flex items-center justify-between"><span className="text-xs font-semibold">Your numbers</span><span className="text-xs text-[#a1a1aa]">All numbers</span></div>
      <div className="mt-2 divide-y divide-white/[.06]">
        {NUMS.map(([n, s, st]) => (
          <div key={n} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1"><div className="font-mono text-[12px] truncate">{n}</div><div className="text-xs text-[#a1a1aa] truncate">{s}</div></div>
            <Pill ok={st === 'Active'}>{st}</Pill><ChevronRight className="w-3 h-3 text-[#71717a] shrink-0" />
          </div>
        ))}
      </div>
    </Box>
  );
}

function MockActivity() {
  return (
    <Box className="p-3 hidden md:block">
      <div className="text-xs font-semibold">Recent activity</div>
      <div className="mt-2 space-y-2.5">
        {ACT.map(([I, t, s, at]) => (
          <div key={t} className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-md bg-[#818cf8]/10 text-[#818cf8] grid place-items-center shrink-0"><I className="w-3 h-3" /></span>
            <div className="min-w-0 flex-1"><div className="text-xs truncate">{t}</div><div className="text-xs text-[#a1a1aa] font-mono">{s}</div></div>
            <span className="text-xs font-mono text-[#71717a]">{at}</span>
          </div>
        ))}
      </div>
    </Box>
  );
}

export function AppMock() {
  return (
    <MockFrame testid="hero-app-mock">
      <div className="flex">
        <MockSidebar />
        <div className="flex-1 min-w-0 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div><div className="text-xs font-semibold uppercase tracking-[.08em] text-[#818cf8]">Overview</div><div className="font-display text-2xl font-extrabold mt-0.5">Hi Alex</div></div>
            <div className="flex items-center gap-2">
              <span className="h-6 px-2.5 rounded-full border border-[#818cf8]/40 bg-[#818cf8]/10 text-[#818cf8] text-xs font-semibold inline-flex items-center">$128.40</span>
              <span className="relative w-6 h-6 grid place-items-center text-[#a1a1aa]"><Bell className="w-3.5 h-3.5" /><span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#6366f1]" /></span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {STATS.map(([l, v]) => <Box key={l} className="p-2 sm:p-2.5 min-w-0"><div className="text-xs uppercase tracking-[.1em] text-[#a1a1aa] truncate">{l}</div><div className="font-mono text-xs sm:text-base mt-1 truncate">{v}</div></Box>)}
          </div>
          <div className="grid md:grid-cols-5 gap-2 mt-2">
            <div className="md:col-span-3"><MockNumbers /></div>
            <div className="md:col-span-2"><MockActivity /></div>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

const KEYS = [['1', 'Sales', 'Forward to +1 415 555 0102', '42%'], ['2', 'Support', 'Ring group · 3 phones', '31%'], ['3', 'Voicemail', 'Transcript to your inbox', '18%']];
const Eq = ({ on, className = '' }) => <span className={`civr-eq ${on ? '' : 'still'} ${className}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>;

// The greeting plays, a caller presses a key, the key lights up — on a loop.
export function IvrMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, 6, 1500);
  const hot = step % 2 ? (step - 1) / 2 : -1;
  return (
    <MockFrame url="cloudivr.net/app/numbers · Keypad menu" testid="feature-ivr-mock">
      <div className="p-4 sm:p-5" ref={ref}>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">Keypad menu · +1 415 555 0182</span><Pill ok>Live</Pill></div>
        <div className={`mt-3 rounded-lg border p-3 flex gap-3 transition-colors duration-500 ${hot < 0 ? 'border-[#818cf8]/60 bg-[#818cf8]/[.1]' : 'border-[#818cf8]/25 bg-[#818cf8]/[.04]'}`}>
          <span className="w-7 h-7 rounded-md bg-[#6366f1] text-white grid place-items-center shrink-0">{hot < 0 ? <Eq on={inView} /> : <Play className="w-3.5 h-3.5" />}</span>
          <div className="min-w-0"><div className="text-xs uppercase tracking-widest text-[#818cf8]">Greeting · text-to-speech</div><div className="text-[12px] mt-1 text-[#e4e4e7] leading-snug">“Thanks for calling Acme. Press 1 for sales, 2 for support, or 3 to leave a message.”</div></div>
        </div>
        <div className="ml-3.5 border-l border-dashed border-[#3a3a3a] pl-4 pt-2 space-y-2">
          {KEYS.map(([k, t, s, pct], i) => (
            <div key={k} className="relative">
              <span className={`absolute -left-4 top-1/2 w-4 border-t border-dashed transition-colors duration-500 ${hot === i ? 'border-[#818cf8]' : 'border-[#3a3a3a]'}`} />
              <Box className={`p-2.5 flex items-center gap-3 transition-colors duration-500 ${hot === i ? '!border-[#818cf8]/60 !bg-[#818cf8]/[.08]' : ''}`}>
                <span className={`w-7 h-7 rounded-md border font-mono text-xs grid place-items-center shrink-0 transition-all duration-300 ${hot === i ? 'border-[#6366f1] bg-[#6366f1] text-white scale-110' : 'border-[#3a3a3a]'}`}>{k}</span>
                <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold">{t}</div><div className="text-xs text-[#a1a1aa] leading-snug">{hot === i ? <span className="text-[#818cf8] civr-pop inline-block">Caller pressed {k} → {t.toLowerCase()}</span> : s}</div></div>
                <span className="text-xs font-mono text-[#a1a1aa] shrink-0">{pct}<span className="hidden sm:inline"> of callers</span></span>
              </Box>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs font-mono text-[#71717a]">No key in 10 s → Voicemail · last 30 days</div>
      </div>
    </MockFrame>
  );
}

const RESULTS = [['+1 415 555 0143', 'Answered · pressed 1', true], ['+1 212 555 0178', 'Answered · listened', true], ['+1 305 555 0121', 'No answer · retry 10:30', false]];

// Bulk view: progress fills, counters climb and results land one by one.
function CampaignBody({ inView }) {
  const stats = [['Called', '1,240'], ['Answered', '812'], ['Pressed 1', '214']];
  return (
    <div data-testid="outbound-bulk-view">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="text-xs font-semibold truncate">Spring renewals</div><div className="text-xs text-[#a1a1aa]">1,820 leads · recorded message</div></div><Pill ok>Running</Pill>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-[#262626] overflow-hidden"><div className="h-full rounded-full bg-[#6366f1] transition-[width] [transition-duration:1400ms] ease-out" style={{ width: inView ? '68%' : '0%' }} /></div>
      <div className="flex justify-between text-xs text-[#a1a1aa] mt-1.5 font-mono"><span>{inView ? '68' : '0'}% done</span><span>Pause · Cancel</span></div>
      <div className="grid grid-cols-3 gap-2 mt-3">{stats.map(([l, v]) => <Box key={l} className="p-2 min-w-0"><div className="text-xs uppercase tracking-[.1em] text-[#a1a1aa] truncate">{l}</div><div className="font-mono text-sm mt-0.5">{inView ? <CountUp value={v} duration={1400} /> : '0'}</div></Box>)}</div>
      <div className="mt-3 divide-y divide-white/[.06]">
        {RESULTS.map(([n, s, ok], i) => <div key={n} className="flex items-center gap-2 py-2 civr-pop" style={{ animationDelay: `${300 + i * 250}ms` }}><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-[#34d399]' : 'bg-[#71717a]'}`} /><span className="font-mono text-xs truncate">{n}</span><span className="ml-auto text-xs text-[#a1a1aa] truncate">{s}</span></div>)}
      </div>
    </div>
  );
}

const QUICK = ['Ringing +1 415 555 0143…', 'Answered', 'Playing your message', 'They pressed 1', 'Connected to you · 00:08'];

// Quick view: one call rings, the script plays, they press 1 and reach you.
function QuickBody({ step }) {
  const done = (i) => step > i;
  return (
    <div data-testid="outbound-quick-view">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold truncate">Quick IVR call · 1 number</span><span className="shrink-0 h-5 px-2 rounded-full bg-[#6366f1] text-white text-xs font-semibold inline-flex items-center">1st call free</span></div>
      <div className={`mt-3 rounded-lg border p-3 flex gap-3 transition-colors duration-500 ${step === 2 ? 'border-[#818cf8]/60 bg-[#818cf8]/[.1]' : 'border-[#818cf8]/25 bg-[#818cf8]/[.04]'}`}>
        <span className="w-7 h-7 rounded-md bg-[#6366f1] text-white grid place-items-center shrink-0">{step === 2 ? <Eq on /> : <Play className="w-3.5 h-3.5" />}</span>
        <div className="min-w-0"><div className="text-xs uppercase tracking-widest text-[#818cf8]">Your script · AI voice</div><div className="text-[12px] mt-1 text-[#e4e4e7] leading-snug">“Hi, this is Acme Dental. Press 1 to confirm Tuesday’s visit and talk to us.”</div></div>
      </div>
      <ol className="mt-3 space-y-1.5">
        {QUICK.map((t, i) => (
          <li key={t} className={`flex items-center gap-2 text-xs transition-colors duration-300 ${step === i ? 'text-white' : done(i) ? 'text-[#a1a1aa]' : 'text-[#52525b]'}`}>
            <span className={`w-4 h-4 rounded-full border grid place-items-center shrink-0 transition-colors duration-300 ${done(i) || (i === 4 && step === 4) ? 'border-[#34d399] bg-[#34d399]/15 text-[#34d399]' : step === i ? 'border-[#818cf8] text-[#818cf8]' : 'border-[#3a3a3a]'}`}>{done(i) || (i === 4 && step === 4) ? <Check className="w-2.5 h-2.5" /> : <span className="w-1 h-1 rounded-full bg-current" />}</span>
            <span className="font-mono">{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Quick IVR (one call) and Bulk IVR (a whole list) on the same outbound engine — the tabs switch on their own.
export function OutboundMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, 12, 1200);
  const bulk = step >= 6;
  return (
    <MockFrame url={bulk ? 'cloudivr.net/app/campaigns' : 'cloudivr.net/app/quick-call'} testid="feature-outbound-mock">
      <div className="p-4" ref={ref}>
        <div className="flex gap-1 p-1 rounded-lg bg-[#141414] border border-[#262626] mb-3" data-testid="outbound-mock-tabs">
          {[['Quick IVR · one call', false], ['Bulk IVR · a whole list', true]].map(([l, b]) => <span key={l} className={`flex-1 text-center h-7 rounded-md text-xs font-semibold inline-flex items-center justify-center transition-colors duration-300 ${bulk === b ? 'bg-[#6366f1] text-white' : 'text-[#a1a1aa]'}`}>{l}</span>)}
        </div>
        <div key={bulk ? 'bulk' : 'quick'} className="civr-pop min-h-[13rem]">{bulk ? <CampaignBody inView={inView} /> : <QuickBody step={Math.min(step, 4)} />}</div>
      </div>
    </MockFrame>
  );
}

const LINES = [[0, 'Hi, can I book a cleaning for Tuesday?'], [1, 'Of course. I have 10:30 or 2:00 on Tuesday. Which suits you?'], [0, '2:00, please.'], [1, 'You’re booked for Tuesday at 2:00. I’ll text you a confirmation.']];
const Typing = () => <span className="inline-flex gap-1 items-center h-4" aria-label="typing"><i className="w-1.5 h-1.5 rounded-full bg-[#a1a1aa] civr-pulse" /><i className="w-1.5 h-1.5 rounded-full bg-[#a1a1aa] civr-pulse [animation-delay:.2s]" /><i className="w-1.5 h-1.5 rounded-full bg-[#a1a1aa] civr-pulse [animation-delay:.4s]" /></span>;

// The conversation plays out bubble by bubble, with a typing pause before each agent line.
export function AiMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, LINES.length * 2 + 2, 1100);
  const shown = Math.min(LINES.length, Math.floor(step / 2) + (step % 2));
  const typing = step % 2 === 0 && shown < LINES.length && LINES[shown][0] === 1;
  const secs = 60 + step * 3;
  return (
    <MockFrame url="cloudivr.net/app/ai-agents" testid="feature-ai-mock">
      <div className="p-4 min-h-[13.5rem]" ref={ref}>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">AI voice agent · Front desk</span><span className="text-xs font-mono text-[#818cf8] inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#818cf8] civr-pulse" />Live · {`0${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span></div>
        <div className="mt-3 space-y-2">
          {LINES.slice(0, shown).map(([agent, t]) => (
            <div key={t} className={`flex civr-pop ${agent ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[12px] leading-snug ${agent ? 'bg-[#1c1c22] border border-white/[.06] rounded-bl-md' : 'bg-[#6366f1] text-white rounded-br-md'}`}>{t}</div>
            </div>
          ))}
          {typing && <div className="flex justify-start civr-pop"><div className="rounded-2xl rounded-bl-md px-3 py-2 bg-[#1c1c22] border border-white/[.06]"><Typing /></div></div>}
        </div>
      </div>
    </MockFrame>
  );
}
