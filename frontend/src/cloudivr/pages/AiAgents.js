import React from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bot, Plus, ArrowLeft, ChevronRight, Lock } from 'lucide-react';
import { useApi, enc } from '../api';
import { PageHeader, SkeletonRows, SkeletonPage, Empty, ErrorNote, TabStrip, SeePricing } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { AgentForm, EMPTY_AGENT } from './ai/AgentForm';

const RECEPTIONIST = { ...EMPTY_AGENT, name: 'Receptionist', goal: 'Answer callers’ questions, take a message with their name and number, and offer to have someone call them back.' };
import { TestTalk } from './ai/TestTalk';
import { AiCalls } from './ai/AiCalls';
import AgentNumbers from './ai/AgentNumbers';
import { DncList } from './ai/DncList';
import { useSearch, SearchBox, NoMatches } from '../search';
import { showUpgrade } from '../Upgrade';
import { AI_LANG_NAME as LANG_NAME } from './ai/languages';

const TABS = [['agents', 'Agents'], ['calls', 'Call history'], ['dnc', 'Do-not-call list']];

function PlanNote({ canUse }) {
  if (canUse) return <div className="text-sm text-[#a1a1aa] mb-6" data-testid="ai-agents-rate-note">The same AI answers incoming calls (any plan) and runs outgoing AI campaigns (Pro and Business). Browser tests are free. <SeePricing testid="ai-agents-see-pricing" /></div>;
  return (
    <div className="civr-card p-6 mb-6 flex flex-col md:flex-row md:items-center gap-4" data-testid="ai-agents-plan-note">
      <Lock className="w-6 h-6 text-[#fbbf24]" />
      <div className="flex-1"><div className="font-semibold">Get a number to start AI conversations</div><div className="text-sm text-[#a1a1aa]">You can build and test agents now. Any plan can let the agent answer calls. Outgoing AI conversation campaigns need Pro or Business. <SeePricing testid="ai-agents-plan-see-pricing" /></div></div>
      <button type="button" onClick={() => showUpgrade({ feature: 'AI conversation campaigns', need: 'pro' })} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="ai-agents-upgrade-link">See what Pro adds</button>
    </div>
  );
}

function AgentRows({ agents }) {
  const pv = usePrivacy();
  const s = useSearch(agents, a => [a.name, a.businessName, a.voice, LANG_NAME[a.language], ...a.numbers]);
  if (!agents.length) return <Empty icon={Bot} title="No AI conversations yet" sub="Tell Emily who to call and why — she writes the AI agent and sets up the campaign with you. Test it free in your browser." testid="ai-agents-empty"><Link to={cp('/app/campaigns/new?kind=ai')} className="civr-btn civr-btn-primary" data-testid="ai-agents-empty-create-button"><Plus className="w-4 h-4" />Start an AI conversation campaign</Link></Empty>;
  return (
    <div className="flex flex-col gap-4">
      <SearchBox s={s} placeholder="Search AI agents" testid="ai-agents-search" className="max-w-md" />
      <NoMatches s={s} testid="ai-agents-no-matches" />
      {s.list.map((a, i) => (
        <Link key={a.id} to={cp(`/app/ai-agents/${a.id}`)} className="civr-card civr-card-link p-4 sm:p-6 flex items-center gap-4" data-testid={`ai-agent-row-${i}`}>
          <div className="w-11 h-11 rounded-full bg-[#818cf8]/15 flex items-center justify-center"><Bot className="w-5 h-5 text-[#818cf8]" /></div>
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
  const inbound = params.get('use') === 'inbound';
  const setTab = (id) => setParams(inbound ? { use: 'inbound', tab: id } : { tab: id }, { replace: true });
  const { data, loading, error, reload } = useApi('/ai-agents');
  if (inbound) return <Navigate to={cp('/app/receptionist')} replace />;
  return (
    <div data-testid="ai-agents-page" data-use={inbound ? 'inbound' : 'outbound'}>
      <PageHeader label="Campaigns" title={inbound ? 'AI receptionist' : 'AI conversations'}
        sub={inbound ? 'An AI that picks up your numbers 24/7 — answers questions, takes messages and books appointments. Give each agent its own number.' : 'Your AI agents hold real two-way phone conversations with your leads, in 20 languages. Open one to test it, change it or see its calls. On incoming calls the same AI works as your AI receptionist.'} testid="ai-agents-header">
        <Link to={cp('/app/campaigns/new?kind=ai')} className="civr-btn civr-btn-primary" data-testid="ai-agents-new-button"><Plus className="w-4 h-4" />New AI conversation campaign</Link>
      </PageHeader>
      {data && <PlanNote canUse={data.canUse} />}
      <TabStrip active={tab} className="mb-6" testid="ai-tabstrip">
        {TABS.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`ai-tab-${id}`} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${tab === id ? 'border-[#818cf8] text-[#818cf8]' : 'border-transparent text-[#a1a1aa] hover:text-white'}`}>{name}</button>)}
      </TabStrip>
      <ErrorNote error={error} onRetry={reload} className="mb-4" />
      {tab === 'calls' ? <AiCalls /> : tab === 'dnc' ? <DncList /> : error && !data ? null : loading && !data ? <SkeletonRows rows={3} /> : <AgentRows agents={(data?.agents || []).filter(a => a.role !== 'receptionist')} />}
    </div>
  );
}

export function AiAgentEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === undefined;
  const { data: list } = useApi('/ai-agents');
  const { data, loading, error, setData } = useApi(isNew ? null : `/ai-agents/${id}`);
  const [params] = useSearchParams();
  const prepFor = isNew && params.get('prep') ? params.get('number') : null;
  const agent = isNew ? (prepFor ? RECEPTIONIST : EMPTY_AGENT) : data?.agent;
  // New outgoing agents are written with Emily inside the AI conversation campaign — one place, no duplicate.
  if (isNew && !prepFor) return <Navigate to={cp('/app/campaigns/new?kind=ai')} replace />;
  return (
    <div data-testid="ai-agent-edit-page">
      <Link to={cp('/app/ai-agents')} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[#a1a1aa] hover:text-[#818cf8] mb-3" data-testid="ai-agent-back-link"><ArrowLeft className="w-4 h-4" />AI conversations</Link>
      <PageHeader label="AI conversations" title={isNew ? 'New agent' : agent?.name || 'Agent'} testid="ai-agent-edit-header" />
      <ErrorNote error={error} />
      {prepFor && <div className="civr-card p-4 mb-4 text-sm" data-testid="ai-agent-prep-note">{`We started an AI receptionist for ${prepFor}. Add your business name and answers, then save. It only answers calls once you switch it on in the number’s AI agent tab.`}</div>}
      {!isNew && loading && !agent ? <SkeletonPage header={false} cards={2} rows={0} /> : agent && (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
          <div className="min-w-0"><AgentForm key={agent.id || 'new'} initial={agent} voices={list?.voices} recordRate={list?.recordRate} recordingDays={list?.recordingDays} onSaved={(a) => (prepFor ? nav(cp(`/app/numbers/${enc(prepFor)}?tab=ai`)) : isNew ? nav(cp(`/app/ai-agents/${a.id}`), { replace: true }) : setData({ agent: a }))} onDeleted={() => nav(cp('/app/ai-agents'))} /></div>
          <div className="space-y-4 xl:sticky xl:top-20">{isNew ? <div className="civr-card p-6 text-sm text-[#a1a1aa]" data-testid="ai-agent-save-first-note">Save the agent, then talk to it here in your browser before it takes real calls.</div> : <><TestTalk agent={agent} /><AgentNumbers agent={agent} agents={list?.agents || []} /><AiCalls agentId={agent.id} /></>}</div>
        </div>
      )}
    </div>
  );
}
