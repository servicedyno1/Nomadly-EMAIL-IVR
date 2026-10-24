import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bot, Plus, ArrowLeft, ChevronRight, Lock } from 'lucide-react';
import { useApi } from '../api';
import { PageHeader, Spinner, Empty, ErrorNote } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { AgentForm, EMPTY_AGENT } from './ai/AgentForm';
import { TestTalk } from './ai/TestTalk';
import { AiCalls } from './ai/AiCalls';
import { DncList } from './ai/DncList';

const LANG_NAME = { en: 'English', fr: 'French', es: 'Spanish' };
const TABS = [['agents', 'Agents'], ['calls', 'Call history'], ['dnc', 'Do-not-call list']];

function PlanNote({ canUse, rate, recordRate }) {
  if (canUse) return <div className="text-sm text-[#a1a1aa] mb-6" data-testid="ai-agents-rate-note">{`Real calls bill $${Number(rate || 0.2).toFixed(2)} per started minute from your wallet, +$${Number(recordRate ?? 0.02).toFixed(2)} when the agent records. Browser tests are free.`}</div>;
  return (
    <div className="civr-card p-6 mb-6 flex flex-col md:flex-row md:items-center gap-4" data-testid="ai-agents-plan-note">
      <Lock className="w-6 h-6 text-[#fbbf24]" />
      <div className="flex-1"><div className="font-semibold">AI agents answer and call on the Pro plan and up</div><div className="text-sm text-[#a1a1aa]">You can build and test agents now. To use one on real calls, put a number on Pro or Business.</div></div>
      <Link to={cp('/app/numbers')} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="ai-agents-upgrade-link">My numbers</Link>
    </div>
  );
}

function AgentRows({ agents }) {
  const pv = usePrivacy();
  if (!agents.length) return <Empty icon={Bot} title="No AI agents yet" sub="Create an agent, give it a script and FAQs, then talk to it right here in your browser." testid="ai-agents-empty"><Link to={cp('/app/ai-agents/new')} className="civr-btn civr-btn-primary" data-testid="ai-agents-empty-create-button"><Plus className="w-4 h-4" />Create an agent</Link></Empty>;
  return (
    <div className="space-y-3">
      {agents.map((a, i) => (
        <Link key={a.id} to={cp(`/app/ai-agents/${a.id}`)} className="civr-card civr-card-link p-6 flex items-center gap-4" data-testid={`ai-agent-row-${i}`}>
          <div className="w-11 h-11 rounded-full bg-[#34d399]/15 flex items-center justify-center"><Bot className="w-5 h-5 text-[#34d399]" /></div>
          <div className="flex-1 min-w-0"><div className="font-semibold truncate">{a.name}{a.businessName ? ` · ${a.businessName}` : ''}</div><div className="text-xs text-[#a1a1aa]"><span className="capitalize">{a.voice}</span> · {LANG_NAME[a.language] || a.language} · {a.numbers.length ? `answers ${a.numbers.map(n => pv.phone(n)).join(', ')}` : 'not on a number yet'}</div></div>
          <ChevronRight className="w-4 h-4 text-[#a1a1aa]" />
        </Link>
      ))}
    </div>
  );
}

export function AiAgents() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'agents';
  const { data, loading, error } = useApi('/ai-agents');
  return (
    <div data-testid="ai-agents-page">
      <PageHeader label="Calling" title="AI voice agents" sub="An AI that answers your number or calls your leads, in English, French or Spanish — with natural, fast conversation." testid="ai-agents-header">
        <Link to={cp('/app/ai-agents/new')} className="civr-btn civr-btn-primary" data-testid="ai-agents-new-button"><Plus className="w-4 h-4" />New agent</Link>
      </PageHeader>
      {data && <PlanNote canUse={data.canUse} rate={data.rate} recordRate={data.recordRate} />}
      <div className="flex gap-1 overflow-x-auto border-b border-[#1f1f1f] mb-6" role="tablist">
        {TABS.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id }, { replace: true })} data-testid={`ai-tab-${id}`} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${tab === id ? 'border-[#34d399] text-[#34d399]' : 'border-transparent text-[#a1a1aa] hover:text-white'}`}>{name}</button>)}
      </div>
      <ErrorNote error={error} />
      {tab === 'calls' ? <AiCalls /> : tab === 'dnc' ? <DncList /> : loading && !data ? <Spinner /> : <AgentRows agents={data?.agents || []} />}
    </div>
  );
}

export function AiAgentEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === undefined;
  const { data: list } = useApi('/ai-agents');
  const { data, loading, error, setData } = useApi(isNew ? null : `/ai-agents/${id}`);
  const agent = isNew ? EMPTY_AGENT : data?.agent;
  return (
    <div data-testid="ai-agent-edit-page">
      <Link to={cp('/app/ai-agents')} className="inline-flex items-center gap-2 text-sm text-[#a1a1aa] hover:text-[#34d399] mb-6" data-testid="ai-agent-back-link"><ArrowLeft className="w-4 h-4" />All agents</Link>
      <PageHeader label="AI agent" title={isNew ? 'New agent' : agent?.name || 'Agent'} testid="ai-agent-edit-header" />
      <ErrorNote error={error} />
      {!isNew && loading && !agent ? <Spinner /> : agent && (
        <div className="grid lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-3"><AgentForm key={agent.id || 'new'} initial={agent} voices={list?.voices} recordRate={list?.recordRate} recordingDays={list?.recordingDays} onSaved={(a) => (isNew ? nav(cp(`/app/ai-agents/${a.id}`), { replace: true }) : setData({ agent: a }))} onDeleted={() => nav(cp('/app/ai-agents'))} /></div>
          <div className="lg:col-span-2 space-y-4">{isNew ? <div className="civr-card p-6 text-sm text-[#a1a1aa]" data-testid="ai-agent-save-first-note">Save the agent, then talk to it here in your browser before it takes real calls.</div> : <><TestTalk agent={agent} /><AiCalls agentId={agent.id} /></>}</div>
        </div>
      )}
    </div>
  );
}
