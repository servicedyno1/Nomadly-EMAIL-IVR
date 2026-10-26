import React from 'react';
import { Clock, PhoneCall, AudioLines, CheckCircle2, Repeat } from 'lucide-react';
import { MockFrame, Pill, Box } from './Mockups';
import { useInView, useStep } from './kit';

const FEED = [
  ['+1 305 555 0101', 'Florida', 'Pressed 1', 'ok'], ['+1 212 555 0178', 'New York', 'Talking', 'live'], ['+1 713 555 0105', 'Texas', 'Transferred', 'ok'],
  ['+44 20 7946 0108', 'United Kingdom', 'Ringing', 'warn'], ['+1 312 555 0106', 'Illinois', 'No answer', 'muted'], ['+1 404 555 0112', 'Georgia', 'Message left', 'muted'],
];
const DOT = { ok: 'bg-[#34d399]', live: 'bg-[#34d399] civr-pulse', warn: 'bg-[#fbbf24] civr-pulse', muted: 'bg-[#52525b]' };
const RING = [3, 4, 2, 5, 3, 4, 2, 3];
const TALK = [2, 2, 3, 1, 2, 3, 3, 2];
const STEPS = [['Waiting', Clock, 'text-[#a1a1aa] border-[#2a2a2a]'], ['Ringing', PhoneCall, 'text-[#fbbf24] border-[#fbbf24]/50 bg-[#fbbf24]/10'], ['Talking', AudioLines, 'text-[#34d399] border-[#34d399]/50 bg-[#34d399]/10'], ['Done', CheckCircle2, 'text-[#818cf8] border-[#818cf8]/50 bg-[#818cf8]/10']];

// The Live page: numbers move through Waiting → Ringing → Talking → Done while calls land in the feed.
export function LiveMock() {
  const [ref, inView] = useInView({ once: false });
  const step = useStep(inView, 8, 1400);
  const done = 1236 + step * 4, ring = RING[step], talk = TALK[step];
  const counts = [1820 - done - ring - talk, ring, talk, done];
  const rows = FEED.map((_, k) => FEED[(k - step + FEED.length * 8) % FEED.length]).slice(0, 4);
  const tiles = [['Calling now', String(ring + talk)], ['Calls per minute', (17.2 + step * 0.4).toFixed(1)], ['Time left', `~${38 - step}m`], ['Answered today', `${62 + (step % 3)}%`]];
  return (
    <MockFrame url="cloudivr.net/app/live" testid="hero-live-mock">
      <div className="p-4 sm:p-5" ref={ref}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#34d399] civr-live-dot" /><span className="text-sm font-semibold">Spring renewals</span><Pill ok>Running</Pill>
          <span className="h-5 px-2 rounded-full border border-[#818cf8]/40 bg-[#818cf8]/10 text-[#818cf8] text-[10px] font-medium inline-flex items-center gap-1"><Repeat className="w-2.5 h-2.5" />Repeats every day</span>
          <span className="ml-auto text-[10px] font-mono text-[#a1a1aa]">{`${done.toLocaleString('en-US')} of 1,820 called`}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">{tiles.map(([l, v]) => <Box key={l} className="p-2.5 min-w-0"><div className="font-mono text-base truncate" data-no-translate>{v}</div><div className="text-[9px] uppercase tracking-[.1em] text-[#a1a1aa] truncate mt-0.5">{l}</div></Box>)}</div>
        <div className="grid md:grid-cols-5 gap-3 mt-3">
          <Box className="md:col-span-2 p-3">
            <ol className="grid grid-cols-4">
              {STEPS.map(([l, I, tone], k) => (
                <li key={l} className="relative flex flex-col items-center text-center">
                  {k > 0 && <span className="absolute top-4 right-1/2 w-full h-px bg-[#2a2a2a]" />}
                  <span className={`relative w-8 h-8 rounded-full border grid place-items-center bg-[#141414] ${tone} ${(k === 1 || k === 2) ? 'civr-live-ring' : ''}`}><I className="w-3.5 h-3.5" /></span>
                  <span className="font-mono text-xs mt-1.5" data-no-translate>{counts[k].toLocaleString('en-US')}</span><span className="text-[9px] text-[#a1a1aa]">{l}</span>
                </li>
              ))}
            </ol>
          </Box>
          <Box className="md:col-span-3 p-3">
            <div className="text-[10px] uppercase tracking-[.1em] text-[#a1a1aa]">Latest calls</div>
            <div className="mt-1 divide-y divide-white/[.06]">
              {rows.map(([n, area, res, tone], k) => (
                <div key={`${n}-${step}`} className={`flex items-center gap-2 py-1.5 ${k === 0 ? 'civr-pop' : ''}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[tone]}`} /><span className="font-mono text-[11px] truncate">{n}</span>
                  <span className="text-[10px] text-[#a1a1aa] truncate hidden sm:inline">{area}</span><span className="ml-auto text-[10px] text-[#e4e4e7] shrink-0">{res}</span>
                </div>
              ))}
            </div>
          </Box>
        </div>
      </div>
    </MockFrame>
  );
}
