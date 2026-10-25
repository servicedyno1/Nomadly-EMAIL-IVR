import React from 'react';
import { Gauge, Hash, ShoppingCart, PhoneOutgoing, Megaphone, Bot, Inbox, Wallet, PhoneIncoming, Voicemail, MessageSquare, Bell, Play, ChevronRight } from 'lucide-react';
import { Wordmark } from '../../Brand';

// Coded product shots: the real app's dark styling with sample data, sharp at any size.
const NAV = [['Numbers', [[Gauge, 'Overview', true], [Hash, 'My numbers'], [ShoppingCart, 'Buy a number']]], ['Calling', [[PhoneOutgoing, 'Quick IVR call'], [Megaphone, 'Campaigns'], [Bot, 'AI voice agents']]], ['Account', [[Inbox, 'Inbox'], [Wallet, 'Wallet']]]];
const STATS = [['Wallet', '$128.40'], ['Numbers', '3'], ['Minutes', '142'], ['SMS', '36']];
const NUMS = [['+1 415 555 0182', 'United States · Pro', 'Active'], ['+44 20 7946 0958', 'United Kingdom · Business', 'Active'], ['+33 1 84 88 01 12', 'France · Starter', 'Renews 12 Nov']];
const ACT = [[PhoneIncoming, 'Pressed 1 → Sales', '2m 14s', '09:41'], [Voicemail, 'New voicemail', '0m 42s', '09:12'], [MessageSquare, 'SMS received', 'Inbox', '08:57']];

const Pill = ({ ok, children }) => <span className={`shrink-0 h-5 px-2 rounded-full border text-[10px] font-medium inline-flex items-center gap-1 ${ok ? 'border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399]' : 'border-[#3a3a3a] text-[#a1a1aa]'}`}>{ok && <span className="w-1.5 h-1.5 rounded-full bg-[#34d399]" />}{children}</span>;
const Box = ({ className = '', children }) => <div className={`rounded-lg border border-[#262626] bg-[#141414] ${className}`}>{children}</div>;

export function MockFrame({ url = 'cloudivr.net/app', children, className = '', testid }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,.06),0_32px_64px_-32px_rgba(15,23,42,.4)] ${className}`} data-testid={testid}>
      <div className="rounded-xl overflow-hidden bg-[#0a0a0a] text-[#f3f4f6] text-left select-none" aria-hidden="true">
        <div className="flex items-center gap-1.5 px-3 h-8 border-b border-white/[.06] bg-[#111]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#3f3f46]" /><span className="w-2.5 h-2.5 rounded-full bg-[#3f3f46]" /><span className="w-2.5 h-2.5 rounded-full bg-[#3f3f46]" />
          <span className="mx-auto h-5 px-3 rounded-md bg-white/[.05] text-[10px] font-mono text-[#a1a1aa] inline-flex items-center truncate max-w-[60%]">{url}</span>
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
          <div className="px-2 mb-1 text-[9px] font-mono uppercase tracking-widest text-[#71717a]">{g}</div>
          {items.map(([I, l, on]) => <div key={l} className={`flex items-center gap-2 px-2 h-7 rounded-md text-[11px] ${on ? 'bg-[#818cf8]/10 text-[#818cf8] font-semibold' : 'text-[#a1a1aa]'}`}><I className="w-3 h-3" />{l}</div>)}
        </div>
      ))}
    </div>
  );
}

function MockNumbers() {
  return (
    <Box className="p-3">
      <div className="flex items-center justify-between"><span className="text-xs font-semibold">Your numbers</span><span className="text-[10px] text-[#a1a1aa]">All numbers</span></div>
      <div className="mt-2 divide-y divide-white/[.06]">
        {NUMS.map(([n, s, st]) => (
          <div key={n} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1"><div className="font-mono text-[12px] truncate">{n}</div><div className="text-[10px] text-[#a1a1aa] truncate">{s}</div></div>
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
            <div className="min-w-0 flex-1"><div className="text-[11px] truncate">{t}</div><div className="text-[10px] text-[#a1a1aa] font-mono">{s}</div></div>
            <span className="text-[10px] font-mono text-[#71717a]">{at}</span>
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
            <div><div className="text-[9px] font-semibold uppercase tracking-[.08em] text-[#818cf8]">Overview</div><div className="font-display text-2xl font-extrabold mt-0.5">Hi Alex</div></div>
            <div className="flex items-center gap-2">
              <span className="h-6 px-2.5 rounded-full border border-[#818cf8]/40 bg-[#818cf8]/10 text-[#818cf8] text-[10px] font-semibold inline-flex items-center">$128.40</span>
              <span className="relative w-6 h-6 grid place-items-center text-[#a1a1aa]"><Bell className="w-3.5 h-3.5" /><span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#6366f1]" /></span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {STATS.map(([l, v]) => <Box key={l} className="p-2.5 min-w-0"><div className="text-[9px] uppercase tracking-[.1em] text-[#a1a1aa] truncate">{l}</div><div className="font-mono text-sm sm:text-base mt-1 truncate">{v}</div></Box>)}
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

export function IvrMock() {
  return (
    <MockFrame url="cloudivr.net/app/numbers · Keypad menu" testid="feature-ivr-mock">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">Keypad menu · +1 415 555 0182</span><Pill ok>Live</Pill></div>
        <div className="mt-3 rounded-lg border border-[#818cf8]/40 bg-[#818cf8]/[.06] p-3 flex gap-3">
          <span className="w-7 h-7 rounded-md bg-[#6366f1] text-white grid place-items-center shrink-0"><Play className="w-3.5 h-3.5" /></span>
          <div className="min-w-0"><div className="text-[9px] uppercase tracking-widest text-[#818cf8]">Greeting · text-to-speech</div><div className="text-[12px] mt-1 text-[#e4e4e7] leading-snug">“Thanks for calling Acme. Press 1 for sales, 2 for support, or 3 to leave a message.”</div></div>
        </div>
        <div className="ml-3.5 border-l border-dashed border-[#3a3a3a] pl-4 pt-2 space-y-2">
          {KEYS.map(([k, t, s, pct]) => (
            <div key={k} className="relative">
              <span className="absolute -left-4 top-1/2 w-4 border-t border-dashed border-[#3a3a3a]" />
              <Box className="p-2.5 flex items-center gap-3">
                <span className="w-7 h-7 rounded-md border border-[#3a3a3a] font-mono text-xs grid place-items-center shrink-0">{k}</span>
                <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold">{t}</div><div className="text-[10px] text-[#a1a1aa] truncate">{s}</div></div>
                <span className="text-[10px] font-mono text-[#a1a1aa] shrink-0">{pct} of callers</span>
              </Box>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] font-mono text-[#71717a]">No key in 10 s → Voicemail · last 30 days</div>
      </div>
    </MockFrame>
  );
}

export function CampaignMock() {
  const stats = [['Called', '1,240'], ['Answered', '812'], ['Pressed 1', '214']];
  return (
    <MockFrame url="cloudivr.net/app/campaigns" testid="feature-campaign-mock">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><div className="text-xs font-semibold truncate">Spring renewals</div><div className="text-[10px] text-[#a1a1aa]">1,820 leads · recorded message</div></div><Pill ok>Running</Pill>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-[#262626] overflow-hidden"><div className="h-full w-[68%] rounded-full bg-[#6366f1]" /></div>
        <div className="flex justify-between text-[10px] text-[#a1a1aa] mt-1.5 font-mono"><span>68% done</span><span>Pause · Cancel</span></div>
        <div className="grid grid-cols-3 gap-2 mt-3">{stats.map(([l, v]) => <Box key={l} className="p-2 min-w-0"><div className="text-[9px] uppercase tracking-[.1em] text-[#a1a1aa] truncate">{l}</div><div className="font-mono text-sm mt-0.5">{v}</div></Box>)}</div>
      </div>
    </MockFrame>
  );
}

const LINES = [[0, 'Hi, can I book a cleaning for Tuesday?'], [1, 'Of course. I have 10:30 or 2:00 on Tuesday. Which suits you?'], [0, '2:00, please.'], [1, 'You’re booked for Tuesday at 2:00. I’ll text you a confirmation.']];

export function AiMock() {
  return (
    <MockFrame url="cloudivr.net/app/ai-agents" testid="feature-ai-mock">
      <div className="p-4">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">AI voice agent · Front desk</span><span className="text-[10px] font-mono text-[#818cf8] inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#818cf8] civr-pulse" />Live · 01:12</span></div>
        <div className="mt-3 space-y-2">
          {LINES.map(([agent, t]) => (
            <div key={t} className={`flex ${agent ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[12px] leading-snug ${agent ? 'bg-[#1c1c22] border border-white/[.06] rounded-bl-md' : 'bg-[#6366f1] text-white rounded-br-md'}`}>{t}</div>
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}
