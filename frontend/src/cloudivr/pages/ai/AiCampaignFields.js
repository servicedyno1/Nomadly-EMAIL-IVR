import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Clock, Ban, Lock } from 'lucide-react';
import { useApi } from '../../api';
import { Field, Spinner } from '../../ui';
import { cp } from '../../paths';

// Campaign type switch: a recorded message or an AI agent that has a real conversation with each lead.
export function CampaignKind({ value, onChange, aiLocked }) {
  const opt = (k, label, sub, testid, locked) => (
    <button type="button" onClick={() => onChange(k)} data-testid={testid}
      className={`flex-1 text-left rounded-xl border px-4 py-3 transition-colors ${value === k ? 'border-[#818cf8] bg-[#818cf8]/10' : 'border-[#2a2a2a] hover:border-[#3a3a3a]'}`}>
      <div className="font-semibold text-sm flex items-center gap-2">{label}{locked && <span className="civr-pill civr-pill-warn !normal-case !tracking-normal inline-flex items-center gap-1" data-testid={`${testid}-lock`}><Lock className="w-3 h-3" />Business</span>}</div><div className="text-xs text-[#a1a1aa] mt-0.5">{sub}</div>
    </button>
  );
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-4" data-testid="campaign-kind">
      {opt('audio', 'Recorded message', 'Play audio, count key presses or transfer.', 'campaign-kind-audio')}
      {opt('ai', 'AI voice agent conversation', 'Business plan · your AI voice agent talks with each lead · $0.30/min (+$0.02 recorded).', 'campaign-kind-ai', aiLocked)}
    </div>
  );
}

export function AiCampaignFields({ agentId, onChange }) {
  const { data } = useApi('/ai-agents');
  const agents = data?.agents || [];
  const first = agents[0]?.id;
  useEffect(() => { if (!agentId && first) onChange(first); }, [agentId, first, onChange]);
  if (!data) return <Spinner label="Loading your agents…" testid="campaign-ai-agents-loading" />;
  if (!agents.length) return <div className="text-sm text-[#a1a1aa]" data-testid="campaign-ai-no-agents">You have no AI agent yet. <Link to={cp('/app/ai-agents/new')} className="text-[#818cf8] underline" data-testid="campaign-ai-create-agent-link">Create one</Link> first.</div>;
  return (
    <div className="space-y-4">
      <Field label="AI agent"><select className="civr-input" value={agentId || ''} onChange={e => onChange(e.target.value)} data-testid="campaign-ai-agent-select">{agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.businessName ? ` · ${a.businessName}` : ''}</option>)}</select></Field>
      <ul className="text-xs text-[#a1a1aa] space-y-2" data-testid="campaign-ai-rules">
        <li className="flex gap-2"><Clock className="w-4 h-4 shrink-0 text-[#818cf8]" />Calls only between 8am and 9pm in each lead's local time — others wait and are called when their window opens.</li>
        <li className="flex gap-2"><Ban className="w-4 h-4 shrink-0 text-[#818cf8]" />Numbers on your do-not-call list are skipped; anyone who asks not to be called again is added to it.</li>
        <li className="flex gap-2"><Bot className="w-4 h-4 shrink-0 text-[#818cf8]" />The agent says it is an AI, waits for the person to say hello, introduces itself to call screeners, leaves one voicemail after the beep and bills $0.30 per started minute (+$0.02 when the agent records). Unanswered calls are free. Agents with bookings on add appointments to your Google Calendar.</li>
      </ul>
    </div>
  );
}
