import React, { useState } from 'react';
import { ChevronDown, ChevronUp, PhoneIncoming, PhoneOutgoing, Mic } from 'lucide-react';
import { useApi, when, secs, money } from '../../api';
import { Spinner, Empty, ErrorNote } from '../../ui';
import { usePrivacy } from '../../privacy';

const OUTCOME = { interested: 'civr-pill civr-pill-on', callback: 'civr-pill civr-pill-warn', transferred: 'civr-pill civr-pill-on', message: 'civr-pill civr-pill-warn', opted_out: 'civr-pill civr-pill-bad', not_interested: 'civr-pill civr-pill-bad' };
export const outcomeLabel = (o) => String(o || 'no answer').replace(/_/g, ' ');
const DIR = { inbound: PhoneIncoming, outbound: PhoneOutgoing, test: Mic };

function Transcript({ id }) {
  const { data, loading, error } = useApi(`/ai-calls/${id}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const c = data.call;
  return (
    <div className="mt-4 space-y-3" data-testid="ai-call-transcript">
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
    <div className="civr-card p-5" data-testid={`ai-call-row-${i}`}>
      <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(o => !o)} data-testid={`ai-call-row-${i}-toggle`}>
        <Icon className="w-4 h-4 text-[#34d399] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{c.direction === 'test' ? `Browser test · ${c.agentName}` : `${pv.phone(c.other)} · ${c.agentName}`}</div>
          <div className="text-xs text-[#a1a1aa]">{when(c.startedAt)} · {secs(c.duration)}{c.charge ? ` · ${money(c.charge)}` : ' · free'}</div>
        </div>
        <span className={`${OUTCOME[c.outcome] || 'civr-pill'} shrink-0`} data-testid={`ai-call-row-${i}-outcome`}>{outcomeLabel(c.outcome)}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {c.summary && <p className="text-sm text-[#d4d4d8] mt-3" data-testid={`ai-call-row-${i}-summary`}>{pv.text(c.summary, 'Summary hidden')}</p>}
      {open && <Transcript id={c.id} />}
    </div>
  );
}

// Every AI conversation: summary, outcome, cost and the full transcript.
export function AiCalls({ agentId }) {
  const { data, loading, error } = useApi(`/ai-calls?limit=50${agentId ? `&agentId=${agentId}` : ''}`);
  if (loading && !data) return <Spinner />;
  const list = data?.calls || [];
  return (
    <div className="space-y-3" data-testid="ai-calls-list">
      <ErrorNote error={error} />
      {!list.length ? <Empty icon={Mic} title="No AI calls yet" sub="Calls your agents answer or make, and your browser tests, show up here with a summary and transcript." testid="ai-calls-empty" /> : list.map((c, i) => <Row key={c.id} c={c} i={i} />)}
    </div>
  );
}
