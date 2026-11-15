import React, { useState } from 'react';
import { ChevronDown, ChevronUp, PhoneIncoming, PhoneOutgoing, Mic, CalendarCheck, Headphones } from 'lucide-react';
import { useApi, when, secs, money, day, playUrl } from '../../api';
import { Link } from 'react-router-dom';
import { Spinner, SkeletonRows, Empty, ErrorNote } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';
import { useSearch, SearchBox, NoMatches } from '../../search';

const OUTCOME = { booked: 'civr-pill civr-pill-ok', interested: 'civr-pill civr-pill-ok', callback: 'civr-pill civr-pill-warn', transferred: 'civr-pill civr-pill-ok', message: 'civr-pill civr-pill-warn', opted_out: 'civr-pill civr-pill-bad', not_interested: 'civr-pill civr-pill-bad' };
const OUTCOMES = { voicemail: 'Left a voicemail', screened: 'Call screener — person didn’t pick up', no_answer: 'No answer', no_conversation: 'Answered — no conversation', opted_out: 'Asked not to be called', booked: 'Booked', transferred: 'Transferred', message: 'Took a message', interested: 'Interested', not_interested: 'Not interested', callback: 'Wants a call back', other: 'Other' };
export const outcomeLabel = (o) => OUTCOMES[o || 'no_answer'] || String(o).replace(/_/g, ' ');
const DIR = { inbound: PhoneIncoming, outbound: PhoneOutgoing, test: Mic };

function Transcript({ id }) {
  const { data, loading, error } = useApi(`/ai-calls/${id}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const c = data.call;
  return (
    <div className="mt-4 space-y-3" data-testid="ai-call-transcript">
      {c.recordingUrl ? (
        <div className="rounded-xl border border-[#262626] p-3" data-testid="ai-call-recording">
          <audio controls preload="metadata" src={playUrl(c.recordingUrl)} className="w-full h-10" data-testid="ai-call-recording-player" />
          <div className="text-xs text-[#a1a1aa] mt-2">{`Recording · kept until ${day(c.recordingExpiresAt)}`}</div>
        </div>
      ) : c.recordingDeletedAt ? <div className="text-xs text-[#a1a1aa]" data-testid="ai-call-recording-deleted">The recording was deleted after 90 days.</div> : null}
      {c.message && <div className="text-sm border border-[#fbbf24]/30 bg-[#fbbf24]/5 rounded-xl px-4 py-3" data-testid="ai-call-message">Message{c.message.name ? ` from ${c.message.name}` : ''}{c.message.callback ? ` (${c.message.callback})` : ''}: {c.message.text}</div>}
      {(c.transcript || []).map((t, i) => <div key={i} className="text-sm"><span className="font-mono text-xs text-[#a1a1aa] mr-2 uppercase">{t.role === 'agent' ? 'Agent' : 'Caller'}</span>{t.text}</div>)}
      {!c.transcript?.length && <div className="text-sm text-[#a1a1aa]">No words were exchanged.</div>}
    </div>
  );
}

function Row({ c, i }) {
  const [open, setOpen] = useState(false);
  const pv = usePrivacy();
  const Icon = DIR[c.direction] || PhoneIncoming;
  return (
    <div className="civr-card p-4 sm:p-6" data-testid={`ai-call-row-${i}`}>
      <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(o => !o)} data-testid={`ai-call-row-${i}-toggle`}>
        <Icon className="w-4 h-4 text-[#818cf8] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{c.direction === 'test' ? `Browser test · ${c.agentName}` : `${pv.phone(c.other)} · ${c.agentName}`}</div>
          <div className="text-xs text-[#a1a1aa] flex items-center gap-1.5">{when(c.startedAt)} · {secs(c.duration)}{c.charge ? ` · ${money(c.charge)}` : ' · free'}{c.recordingUrl && <Headphones className="w-3.5 h-3.5 text-[#818cf8]" aria-label="Recorded" data-testid={`ai-call-row-${i}-recorded`} />}</div>
        </div>
        <span className={`${OUTCOME[c.outcome] || 'civr-pill'} shrink-0`} data-testid={`ai-call-row-${i}-outcome`}>{outcomeLabel(c.outcome)}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {c.summary && <p className="text-sm text-[#d4d4d8] mt-3" data-testid={`ai-call-row-${i}-summary`}>{pv.text(c.summary, 'Summary hidden')}</p>}
      {c.booking && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#e4e4e7]" data-testid={`ai-call-row-${i}-booking`}>
          <span className="inline-flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-[#818cf8]" />{`Booked ${c.booking.day} at ${c.booking.time}`}</span>
          {c.booking.name && <span className="text-[#a1a1aa]" data-no-translate>{pv.text(c.booking.name, '•••')}</span>}
          {c.booking.link && <a href={c.booking.link} target="_blank" rel="noopener noreferrer" className="text-[#818cf8] underline underline-offset-2" data-testid={`ai-call-row-${i}-booking-link`}>Open in Google Calendar</a>}
        </div>
      )}
      {open && <Transcript id={c.id} />}
    </div>
  );
}

// Every AI conversation: summary, outcome, cost and the full transcript.
export function AiCalls({ agentId }) {
  const { data, loading, error, reload } = useApi(`/ai-calls?limit=50${agentId ? `&agentId=${agentId}` : ''}`);
  const list = data?.calls || [];
  const pv = usePrivacy();
  const s = useSearch(list, c => (pv.on
    ? [pv.phone(c.other), c.agentName, outcomeLabel(c.outcome), c.direction === 'test' ? 'Browser test' : c.direction]
    : [c.other, c.agentName, c.summary, outcomeLabel(c.outcome), c.direction === 'test' ? 'Browser test' : c.direction]));
  if (loading && !data) return <SkeletonRows rows={agentId ? 2 : 3} />;
  return (
    <div className="flex flex-col gap-4" data-testid="ai-calls-list">
      <ErrorNote error={error} onRetry={reload} />
      {error && !data ? null : !list.length ? (
        <Empty icon={Mic} title="No AI calls yet" sub={agentId ? 'Talk to this agent above. Tests and real calls show up here with a summary and transcript.' : 'Calls your agents answer or make, and your browser tests, show up here with a summary and transcript.'} testid="ai-calls-empty">
          {!agentId && <Link to={cp('/app/ai-agents?tab=agents')} className="civr-btn civr-btn-ghost" data-testid="ai-calls-empty-action">Test an agent in your browser</Link>}
        </Empty>
      ) : <>
        <SearchBox s={s} placeholder="Search calls" testid="ai-calls-search" />
        <NoMatches s={s} testid="ai-calls-no-matches" />
        {s.list.map((c, i) => <Row key={c.id} c={c} i={i} />)}
      </>}
    </div>
  );
}
