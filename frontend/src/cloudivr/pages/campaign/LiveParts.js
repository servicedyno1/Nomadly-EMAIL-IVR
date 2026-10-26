import React from 'react';
import { Clock, PhoneCall, AudioLines, CheckCircle2, MapPin } from 'lucide-react';
import { secs } from '../../api';
import { useIsPhone } from '../../ui';
import { usePrivacy } from '../../privacy';
import { outcomeLabel } from '../ai/AiCalls';

const STEPS = [['waiting', 'Waiting', Clock], ['ringing', 'Ringing', PhoneCall], ['talking', 'Talking', AudioLines], ['done', 'Done', CheckCircle2]];
const STEP_TONE = {
  waiting: 'text-[#a1a1aa] border-[#2a2a2a] bg-[#111]',
  ringing: 'text-[#fbbf24] border-[#fbbf24]/50 bg-[#fbbf24]/10',
  talking: 'text-[#34d399] border-[#34d399]/50 bg-[#34d399]/10',
  done: 'text-[#818cf8] border-[#818cf8]/50 bg-[#818cf8]/10',
};

// Waiting → Ringing → Talking → Done, with how many numbers are at each step.
export function Pipeline({ p, testid }) {
  return (
    <ol className="grid grid-cols-4" aria-label="Where the numbers are" data-testid={testid}>
      {STEPS.map(([k, label, Icon], i) => {
        const n = p?.[k] || 0;
        const busy = n > 0 && (k === 'ringing' || k === 'talking');
        return (
          <li key={k} className="relative flex flex-col items-center text-center min-w-0">
            {i > 0 && <span aria-hidden="true" className={`absolute top-5 right-1/2 w-full h-px ${n > 0 ? 'bg-[#3f3f46]' : 'bg-[#1f1f1f]'}`} />}
            <span className={`relative w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${STEP_TONE[k]} ${busy ? 'civr-live-ring' : ''}`}><Icon className="w-4 h-4" /></span>
            <span className="font-mono text-lg mt-2 leading-none" data-testid={`${testid}-${k}`}>{n}</span>
            <span className="text-xs text-[#a1a1aa] mt-1 truncate max-w-full">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export const dur = (s) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`);

// Calls per minute, time left, time running and lines in use.
export function RunStats({ c, testid }) {
  const l = c.live || {};
  const items = [
    ['rate', 'Calls per minute', String(l.ratePerMin ?? 0)],
    ['eta', 'Time left', l.etaSec != null ? `~${dur(l.etaSec)}` : '—'],
    ['elapsed', 'Running for', dur(l.elapsedSec || 0)],
    ['lines', 'Lines in use', `${l.linesInUse || 0} / ${c.concurrency || 0}`],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid={testid}>
      {items.map(([k, label, v]) => (
        <div key={k} className="rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3 min-w-0">
          <div className="font-mono text-xl truncate" data-testid={`${testid}-${k}`}>{v}</div>
          <div className="text-xs text-[#a1a1aa] mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// → [label, tone] for one call in the feed.
export function callResult(f) {
  if (f.phase === 'talking') return ['Talking', 'live'];
  if (f.phase === 'ringing') return ['Ringing', 'warn'];
  if (f.status === 'skipped') return ['Do-not-call', 'muted'];
  if (f.outcome) return [outcomeLabel(f.outcome), 'ok'];
  if (f.status === 'voicemail') return [f.voicemailDropped ? 'Message left' : 'Voicemail', 'muted'];
  if (f.status === 'no_answer') return ['No answer', 'muted'];
  if (f.status === 'busy') return ['Busy', 'muted'];
  if (f.status === 'failed') return ['Failed', 'bad'];
  if (f.transferred) return ['Transferred', 'ok'];
  if (f.digitPressed) return [`Pressed ${f.digitPressed}`, 'ok'];
  return ['Answered', 'ok'];
}
const DOT = { live: 'bg-[#34d399] civr-pulse', warn: 'bg-[#fbbf24] civr-pulse', ok: 'bg-[#34d399]', muted: 'bg-[#52525b]', bad: 'bg-[#fb7185]' };
const TEXT = { live: 'text-[#34d399]', warn: 'text-[#fbbf24]', ok: 'text-[#e4e4e7]', muted: 'text-[#a1a1aa]', bad: 'text-[#fb7185]' };
const clock = (d) => (d ? new Date(d).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

function FeedRow({ f, i, showCampaign, testid }) {
  const pv = usePrivacy();
  const [label, tone] = callResult(f);
  return (
    <tr data-testid={`${testid}-row-${i}`}>
      <td className="font-mono text-xs text-[#a1a1aa] whitespace-nowrap">{clock(f.at)}</td>
      <td className="font-mono text-xs whitespace-nowrap">{pv.phone(f.number)}</td>
      <td className="text-xs text-[#d4d4d8]" data-testid={`${testid}-row-${i}-area`}>{f.area}</td>
      {showCampaign && <td className="text-xs text-[#a1a1aa] max-w-[12rem] truncate">{f.campaignName}</td>}
      <td className="font-mono text-xs">{f.duration ? secs(f.duration) : '—'}</td>
      <td className="whitespace-nowrap"><span className={`inline-flex items-center gap-2 text-xs ${TEXT[tone]}`} data-testid={`${testid}-row-${i}-result`}><span className={`w-2 h-2 rounded-full ${DOT[tone]}`} />{label}</span></td>
    </tr>
  );
}

function FeedItem({ f, i, showCampaign, testid }) {
  const pv = usePrivacy();
  const [label, tone] = callResult(f);
  return (
    <li className="py-3 first:pt-0 last:pb-0 flex items-start gap-3" data-testid={`${testid}-row-${i}`}>
      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT[tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm truncate">{pv.phone(f.number)}</span><span className={`text-xs shrink-0 ${TEXT[tone]}`} data-testid={`${testid}-row-${i}-result`}>{label}</span></div>
        <div className="text-xs text-[#a1a1aa] mt-0.5 truncate"><span data-testid={`${testid}-row-${i}-area`}>{f.area}</span> · {clock(f.at)}{f.duration ? ` · ${secs(f.duration)}` : ''}{showCampaign ? ` · ${f.campaignName}` : ''}</div>
      </div>
    </li>
  );
}

// Newest calls first: ringing and talking ones on top.
export function CallFeed({ feed, showCampaign = false, testid, empty = 'No calls yet. They show up here the moment dialing starts.' }) {
  const phone = useIsPhone();
  if (!feed?.length) return <div className="text-sm text-[#a1a1aa] py-6" data-testid={`${testid}-empty`}>{empty}</div>;
  if (phone) return <ul className="divide-y divide-[#1f1f1f]" data-testid={testid}>{feed.map((f, i) => <FeedItem key={`${f.campaignId}-${f.number}-${i}`} f={f} i={i} showCampaign={showCampaign} testid={testid} />)}</ul>;
  return (
    <div className="overflow-x-auto">
      <table className="civr-table" data-testid={testid}>
        <thead><tr><th>Time</th><th>Number</th><th>Area</th>{showCampaign && <th>Campaign</th>}<th>Length</th><th>Result</th></tr></thead>
        <tbody>{feed.map((f, i) => <FeedRow key={`${f.campaignId}-${f.number}-${i}`} f={f} i={i} showCampaign={showCampaign} testid={testid} />)}</tbody>
      </table>
    </div>
  );
}

// Busiest states / countries with their answer rate.
export function TopAreas({ areas, isAi, testid }) {
  if (!areas?.length) return null;
  const max = Math.max(...areas.map(a => a.numbers), 1);
  return (
    <ul className="flex flex-col gap-4" data-testid={testid}>
      {areas.map((a, i) => {
        const rate = a.called ? Math.round((a.answered / a.called) * 100) : null;
        return (
          <li key={a.area} data-testid={`${testid}-row-${i}`}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 min-w-0"><MapPin className="w-3.5 h-3.5 text-[#818cf8] shrink-0" /><span className="truncate" data-testid={`${testid}-row-${i}-name`}>{a.area}</span></span>
              <span className="font-mono text-xs text-[#a1a1aa] shrink-0" data-testid={`${testid}-row-${i}-rate`}>{rate == null ? '—' : `${rate}%`}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full bg-[#3f3f46] relative transition-[width] duration-700" style={{ width: `${(a.numbers / max) * 100}%` }}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-[#34d399]" style={{ width: `${a.numbers ? (a.answered / a.numbers) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="text-xs text-[#a1a1aa] mt-1.5">{[`${a.numbers} ${a.numbers === 1 ? 'number' : 'numbers'}`, `${a.called} called`, `${a.answered} answered`, isAi ? (a.interested ? `${a.interested} interested` : null) : (a.keyPressed ? `${a.keyPressed} pressed a key` : null)].filter(Boolean).join(' · ')}</div>
          </li>
        );
      })}
    </ul>
  );
}

export const repeatLabel = (r) => (r === 'weekly' ? 'Repeats every week' : r === 'daily' ? 'Repeats every day' : null);
