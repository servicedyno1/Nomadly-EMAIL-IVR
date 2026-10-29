import React from 'react';
import { Smartphone, Building2, PhoneIncoming, Check, Mail, Mic, Keyboard, Ear, Volume2, Captions } from 'lucide-react';
import { MockFrame, Pill, Box } from './Mockups';
import { useInView, useStep, useTyped, reducedMotion } from './kit';

const Wave = ({ on, bars = 18, className = '' }) => <span className={`civr-wave ${on ? '' : 'still'} ${className}`} aria-hidden="true">{Array.from({ length: bars }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 6) * 0.11}s` }} />)}</span>;

// Ring cascade: your number rings, the mobile doesn't pick up, the office does.
export function ForwardingMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, 5, 1300);
  const node = (Icon, label, state, testid) => (
    <div className="flex flex-col items-center gap-1.5 min-w-0" data-testid={testid}>
      <span className={`w-9 h-9 rounded-xl border grid place-items-center transition-colors duration-300 ${state === 'ring' ? 'border-[#818cf8] bg-[#818cf8]/15 text-[#818cf8]' : state === 'ok' ? 'border-[#34d399] bg-[#34d399]/15 text-[#34d399]' : state === 'miss' ? 'border-[#3a3a3a] text-[#71717a]' : 'border-[#3a3a3a] text-[#a1a1aa]'}`}><Icon className={`w-4 h-4 ${state === 'ring' ? 'civr-ringing' : ''}`} /></span>
      <span className="text-xs text-[#a1a1aa] truncate">{label}</span>
    </div>
  );
  const arrow = (lit) => <span className={`flex-1 h-px border-t border-dashed transition-colors duration-300 mb-5 ${lit ? 'border-[#818cf8]' : 'border-[#3a3a3a]'}`} />;
  const status = ['Incoming call…', 'Ringing your mobile', 'No answer after 20 s', 'Ringing the office', 'Answered · 00:12'][step];
  return (
    <MockFrame url="cloudivr.net/app/numbers · Forwarding" testid="feature-forwarding-mock">
      <div className="p-4" ref={ref}>
        <div className="flex items-center gap-2">
          {node(PhoneIncoming, '+1 415 555 0182', step === 0 ? 'ring' : 'idle', 'fwd-node-number')}
          {arrow(step >= 1)}
          {node(Smartphone, 'Mobile', step === 1 ? 'ring' : step >= 2 ? 'miss' : 'idle', 'fwd-node-mobile')}
          {arrow(step >= 3)}
          {node(Building2, 'Office', step === 3 ? 'ring' : step === 4 ? 'ok' : 'idle', 'fwd-node-office')}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs font-mono"><span key={step} className={`civr-pop ${step === 4 ? 'text-[#34d399]' : 'text-[#a1a1aa]'}`}>{status}</span><Pill ok={step === 4}>{step === 4 ? 'Connected' : 'No answer → next'}</Pill></div>
      </div>
    </MockFrame>
  );
}

const VM_TEXT = 'Hi, it’s Dana from the clinic — could you call me back about Tuesday’s appointment? Thanks!';

// A voicemail plays while its transcript types itself out.
export function VoicemailMock() {
  const [ref, inView] = useInView({ once: false });
  const typed = useTyped(inView, VM_TEXT, 26);
  const done = typed.length === VM_TEXT.length;
  const secs = Math.round((typed.length / VM_TEXT.length) * 42);
  return (
    <MockFrame url="cloudivr.net/app/inbox · Voicemail" testid="feature-voicemail-mock">
      <div className="p-4" ref={ref}>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">New voicemail · +1 212 555 0178</span><Pill ok={done}>{done ? 'Transcribed' : 'Playing'}</Pill></div>
        <div className="mt-3 flex items-center gap-3 text-[#818cf8]"><Wave on={inView && !done} bars={26} className="flex-1" /><span className="font-mono text-xs text-[#a1a1aa] shrink-0" data-no-translate>{`0:${String(secs).padStart(2, '0')} / 0:42`}</span></div>
        <Box className="mt-3 p-2.5 min-h-[3.4rem]"><div className="text-xs uppercase tracking-widest text-[#818cf8]">Transcript</div><div className={`text-xs text-[#e4e4e7] leading-snug mt-1 ${done ? '' : 'civr-caret'}`}>{typed}</div></Box>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[#a1a1aa]"><Mail className="w-3 h-3" />Recording + transcript sent to your inbox and email</div>
      </div>
    </MockFrame>
  );
}

const SMS = [['in', 'Hi! Are you open this Saturday?'], ['in', 'Need a haircut before a wedding 😅'], ['out', 'Yes — 9 to 1. Want 10:30?'], ['in', 'Perfect, see you then!']];

// Texts slide in, you answer from the inbox.
export function SmsMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, SMS.length + 2, 1200);
  const shown = Math.min(SMS.length, step);
  return (
    <MockFrame url="cloudivr.net/app/inbox" testid="feature-sms-mock">
      <div className="p-4 min-h-[11rem]" ref={ref}>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">SMS · +1 305 555 0121</span><span className="text-xs text-[#a1a1aa] font-mono">{shown ? 'just now' : ''}</span></div>
        <div className="mt-3 space-y-1.5">
          {SMS.slice(0, shown).map(([dir, t]) => <div key={t} className={`flex civr-pop ${dir === 'in' ? 'justify-start' : 'justify-end'}`}><div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-xs leading-snug ${dir === 'in' ? 'bg-[#1c1c22] border border-white/[.06] rounded-bl-md' : 'bg-[#6366f1] text-white rounded-br-md'}`}>{t}</div></div>)}
        </div>
        {shown >= 2 && shown < 3 && <div className="mt-2 text-xs text-[#818cf8] civr-pop">Reply from the inbox →</div>}
      </div>
    </MockFrame>
  );
}

const DIAL = '+14155550182';
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

// The dialer types a number, rings, connects and counts the call.
export function BrowserPhoneMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, DIAL.length + 9, 420);
  const typed = DIAL.slice(0, Math.min(DIAL.length, step));
  const phase = step < DIAL.length ? 'dial' : step < DIAL.length + 3 ? 'ring' : step < DIAL.length + 8 ? 'live' : 'end';
  const secs = phase === 'live' ? (step - DIAL.length - 3) * 1 : 0;
  const lastKey = phase === 'dial' && step > 0 ? DIAL[step - 1] : null;
  const label = { dial: 'Dialing from your browser', ring: 'Ringing…', live: `Connected · 00:0${secs}`, end: 'Call ended · $0.02' }[phase];
  return (
    <MockFrame url="cloudivr.net/app · Browser phone" testid="feature-browser-mock">
      <div className="p-4" ref={ref}>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">From +1 415 555 0101</span><Pill ok={phase === 'live'}>{phase === 'live' ? 'In call' : phase === 'ring' ? 'Ringing' : phase === 'end' ? 'Ended' : 'Ready'}</Pill></div>
        <div className={`mt-3 font-mono text-base h-6 ${phase === 'dial' ? 'civr-caret' : ''}`} data-no-translate>{typed}</div>
        <div className="mt-2 grid grid-cols-6 gap-1">
          {KEYPAD.map(k => <span key={k} className={`h-6 rounded-md border font-mono text-xs grid place-items-center transition-all duration-150 ${lastKey === k ? 'border-[#6366f1] bg-[#6366f1] text-white scale-105' : 'border-[#2a2a2a] text-[#a1a1aa]'}`}>{k}</span>)}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs font-mono"><span key={phase} className={`civr-pop ${phase === 'live' ? 'text-[#34d399]' : 'text-[#a1a1aa]'}`}>{label}</span>{phase === 'live' && <Wave on bars={10} className="w-16 text-[#34d399]" />}</div>
      </div>
    </MockFrame>
  );
}

const YOU = 'Hi, this is Sam — I’m calling about my appointment on Tuesday.';
const THEM = 'Sure Sam, is 2 o’clock on Tuesday still good for you?';
const T = { sent: 14, spoke: 23, heard: 36 }; // ticks of 250 ms in a 12 s loop

// Their phone: hears your typed words as a voice, then talks back (that speech becomes your captions).
function TheirPhone({ phase }) {
  const hearing = phase === 'speak', talking = phase === 'caption';
  return (
    <div className="civr-tc-phone w-[8.5rem] shrink-0 rounded-[1.4rem] border border-[#3a3a3a] bg-[#111] p-2 shadow-[0_30px_60px_-20px_rgba(0,0,0,.8)]" data-testid="textcall-their-phone">
      <div className="rounded-[1rem] bg-[#0a0a0a] border border-white/[.05] px-2.5 pt-3 pb-3 text-center">
        <div className="mx-auto w-10 h-1 rounded-full bg-[#262626]" />
        <div className="mt-3 mx-auto w-9 h-9 rounded-full bg-[#34d399]/15 text-[#34d399] grid place-items-center text-xs font-bold">DR</div>
        <div className="mt-1.5 text-xs font-semibold">Dr. Rivera’s office</div>
        <div className="text-xs text-[#a1a1aa] font-mono">On a call · 00:{phase === 'type' ? '04' : phase === 'speak' ? '09' : '15'}</div>
        <div className={`mt-3 h-8 flex items-center justify-center gap-1.5 text-xs ${hearing ? 'text-[#818cf8]' : talking ? 'text-[#34d399]' : 'text-[#52525b]'}`}>
          {talking ? <Mic className="w-3 h-3 shrink-0" /> : <Volume2 className="w-3 h-3 shrink-0" />}
          <Wave on={hearing || talking} bars={9} className="w-14" />
        </div>
        <div className="text-xs text-[#a1a1aa] leading-tight min-h-[1.5rem]">{hearing ? 'Hears your words as a clear voice' : talking ? 'Answers out loud, like any call' : 'A normal phone call'}</div>
      </div>
    </div>
  );
}

// Your screen in CloudIVR: type → it is spoken; they talk → you read it live.
function YourScreen({ s, typed, heard }) {
  const sent = s >= T.sent, speaking = s >= T.sent && s < T.spoke, captioning = s >= T.spoke && s < T.heard;
  return (
    <div className="civr-tc-screen flex-1 min-w-0 rounded-xl border border-[#262626] bg-[#0f0f12] p-3 flex flex-col gap-2" data-testid="textcall-your-screen">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold font-mono truncate">+1 212 555 0178</span><Pill ok>Connected</Pill></div>
      <div className="flex-1 min-h-[7.5rem] space-y-2">
        {sent && <div className="flex flex-col items-end civr-pop"><div className="max-w-[90%] rounded-2xl rounded-br-md bg-[#6366f1] text-white px-3 py-1.5 text-xs leading-snug">{YOU}</div><div className={`mt-1 flex items-center gap-1 text-xs ${speaking ? 'text-[#a5b4fc]' : 'text-[#71717a]'}`}><Volume2 className="w-3 h-3" />{speaking ? 'Speaking it aloud…' : 'Spoken aloud'}</div></div>}
        {s >= T.spoke && <div className="flex flex-col items-start civr-pop"><div className={`max-w-[90%] rounded-2xl rounded-bl-md border border-[#34d399]/40 bg-[#34d399]/[.08] px-3 py-1.5 text-xs leading-snug ${captioning ? 'civr-caret' : ''}`}>{heard}</div><div className="mt-1 flex items-center gap-1 text-xs text-[#34d399]"><Captions className="w-3 h-3" />{captioning ? 'Live caption…' : <>Live caption<Check className="w-3 h-3" /></>}</div></div>}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-[#262626] bg-[#141414] px-2.5 h-9">
        <Keyboard className="w-3.5 h-3.5 text-[#818cf8] shrink-0" />
        <span className={`flex-1 min-w-0 truncate text-xs ${sent ? 'text-[#52525b]' : 'text-[#e4e4e7] civr-caret'}`}>{sent ? 'Type your reply…' : typed}</span>
        <span className={`h-6 px-2.5 rounded-md text-xs font-semibold inline-flex items-center transition-colors duration-300 ${s === T.sent - 1 ? 'bg-[#6366f1] text-white' : 'bg-[#1f1f1f] text-[#a1a1aa]'}`}>Send</span>
      </div>
    </div>
  );
}

// Text calls: a laptop screen (you type, read captions) and their phone (hears a voice, talks back), linked by the call.
export function TextCallMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, 48, 250);
  const s = reducedMotion() ? 40 : step;
  const typed = YOU.slice(0, Math.round(YOU.length * Math.min(1, s / (T.sent - 1))));
  const heard = THEM.slice(0, Math.round(THEM.length * Math.min(1, Math.max(0, s - T.spoke) / (T.heard - T.spoke - 2))));
  const phase = s < T.sent ? 'type' : s < T.spoke ? 'speak' : s < T.heard ? 'caption' : 'done';
  const toThem = phase === 'speak', toYou = phase === 'caption';
  return (
    <MockFrame url="cloudivr.net/app/text-call" testid="feature-textcall-mock">
      <div ref={ref} className="civr-tc-stage p-4 sm:p-5" data-phase={phase}>
        <div className="flex items-stretch gap-3">
          <YourScreen s={s} typed={typed} heard={heard} />
          <div className="hidden sm:flex flex-col items-center justify-center gap-1 w-10 shrink-0" aria-hidden="true" data-testid="textcall-link">
            <span className={`civr-tc-flow ${toThem ? 'on' : ''} text-[#818cf8]`} />
            <span className="text-xs font-mono text-[#71717a] text-center leading-tight">{toThem ? 'voice →' : toYou ? '← text' : 'call'}</span>
            <span className={`civr-tc-flow rev ${toYou ? 'on' : ''} text-[#34d399]`} />
          </div>
          <div className="hidden sm:block"><TheirPhone phase={phase} /></div>
        </div>
        <div className={`sm:hidden mt-3 flex items-center gap-2 rounded-lg border border-[#262626] bg-[#141414] px-3 py-2 text-xs ${toThem ? 'text-[#818cf8]' : toYou ? 'text-[#34d399]' : 'text-[#a1a1aa]'}`} data-testid="textcall-their-phone-compact">
          <Smartphone className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{toThem ? 'Their phone: hears your words as a voice' : toYou ? 'Their phone: they answer out loud' : 'Their phone: a normal call'}</span>
          <Wave on={toThem || toYou} bars={8} className="w-12 ml-auto shrink-0" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs font-mono text-[#a1a1aa]">
          <span className="inline-flex items-center gap-1.5"><Keyboard className="w-3 h-3 text-[#818cf8]" />You type → they hear a voice</span>
          <span className="inline-flex items-center gap-1.5">They talk → you read<Ear className="w-3 h-3 text-[#34d399]" /></span>
        </div>
      </div>
    </MockFrame>
  );
}

const LANDLINE = [['in', 'Hi, is this the dental office on Main St?'], ['out', 'Yes! This is Sunrise Dental. How can we help?'], ['in', 'Can I move my cleaning to Friday?'], ['out', 'Done — Friday 2:30 pm. See you then.']];

// The office landline gets texts: an "enabled" badge, then the thread fills in.
export function LandlineTextMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, LANDLINE.length + 3, 1200);
  const on = step >= 1;
  const shown = Math.max(0, Math.min(LANDLINE.length, step - 1));
  return (
    <MockFrame url="cloudivr.net/app/texting" testid="feature-hosted-mock">
      <div className="p-4 min-h-[12rem]" ref={ref}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold"><Building2 className="w-3.5 h-3.5" />Office landline · +1 312 555 0100</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full transition-colors ${on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-[#a1a1aa]'}`}>{on ? 'Texting on' : 'Calls only'}</span>
        </div>
        <div className="mt-3 space-y-1.5">
          {LANDLINE.slice(0, shown).map(([dir, t]) => <div key={t} className={`flex civr-pop ${dir === 'in' ? 'justify-start' : 'justify-end'}`}><div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-xs leading-snug ${dir === 'in' ? 'bg-[#1c1c22] border border-white/[.06] rounded-bl-md' : 'bg-[#6366f1] text-white rounded-br-md'}`}>{t}</div></div>)}
        </div>
        {shown >= 2 && <div className="mt-2 text-xs text-[#a1a1aa] civr-pop">Calls still ring at your carrier · $0.05 per text</div>}
      </div>
    </MockFrame>
  );
}
