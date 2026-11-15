import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeft } from 'lucide-react';
import { useApi, enc } from '../api';
import { PageHeader, SkeletonPage, ErrorNote, TabStrip } from '../ui';
import { cp } from '../paths';
import { Overview } from './receptionist/Overview';
import { Numbers } from './receptionist/Numbers';
import { Setup } from './receptionist/Setup';
import { AiCalls } from './ai/AiCalls';
import { AgentForm, EMPTY_AGENT } from './ai/AgentForm';
import { EMPTY_OFFICE } from './ai/ReceptionistFields';
import { TestTalk } from './ai/TestTalk';

const TABS = [['overview', 'Overview'], ['setup', 'Setup'], ['numbers', 'Numbers'], ['calls', 'Call log']];
export const NEW_RECEPTIONIST = {
  ...EMPTY_AGENT, role: 'receptionist', name: 'Receptionist', answerWhen: 'always', officeHours: EMPTY_OFFICE,
  goal: 'Warm, professional receptionist. Greet the caller, answer questions from the FAQs, and if you can’t help, take their name, number and a short message so someone calls them back.',
};

// AI receptionist: answers incoming calls. Separate from outgoing AI calling agents.
export default function Receptionist() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const { data, loading, error, reload } = useApi('/ai-receptionist');
  return (
    <div data-testid="receptionist-page">
      <PageHeader label="Answer calls" title="AI receptionist" sub={`Picks up your numbers, answers questions, takes messages, books appointments and passes urgent callers to you. $${data?.rate ?? 0.1}/min from your wallet; browser tests are free.`} testid="receptionist-header">
        <Link to={cp('/app/receptionist/new')} className="civr-btn civr-btn-primary" data-testid="receptionist-new-button"><Plus className="w-4 h-4" />New receptionist</Link>
      </PageHeader>
      <TabStrip active={tab} className="mb-6" testid="receptionist-tabs">
        {TABS.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id }, { replace: true })} data-testid={`receptionist-tab-${id}`} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${tab === id ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-muted)]'}`}>{name}</button>)}
      </TabStrip>
      <ErrorNote error={error} onRetry={reload} className="mb-4" />
      {tab === 'calls' ? <AiCalls direction="inbound" /> : loading && !data ? <SkeletonPage header={false} cards={3} rows={2} /> : !data ? null
        : tab === 'setup' ? <Setup receptionists={data.receptionists} /> : tab === 'numbers' ? <Numbers receptionists={data.receptionists} reload={reload} /> : <Overview d={data} reload={reload} />}
    </div>
  );
}

export function ReceptionistEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === undefined;
  const [params] = useSearchParams();
  const prepFor = isNew ? params.get('number') : null;
  const { data: list } = useApi('/ai-agents');
  const { data, loading, error, setData } = useApi(isNew ? null : `/ai-agents/${id}`);
  const agent = isNew ? NEW_RECEPTIONIST : data?.agent && { ...data.agent, role: 'receptionist' };
  const saved = (a) => (prepFor ? nav(cp(`/app/numbers/${enc(prepFor)}?tab=ai`)) : isNew ? nav(cp(`/app/receptionist/${a.id}`), { replace: true }) : setData({ agent: a }));
  return (
    <div data-testid="receptionist-edit-page">
      <Link to={cp('/app/receptionist')} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[var(--c-muted)] hover:text-[var(--c-accent)] mb-3" data-testid="receptionist-back-link"><ArrowLeft className="w-4 h-4" />AI receptionist</Link>
      <PageHeader label="AI receptionist" title={isNew ? 'Set up your receptionist' : agent?.name || 'Receptionist'} testid="receptionist-edit-header" />
      <ErrorNote error={error} />
      {!isNew && loading && !agent ? <SkeletonPage header={false} cards={2} rows={0} /> : agent && (
        <div className="grid lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-3"><AgentForm key={agent.id || 'new'} initial={agent} voices={list?.voices} recordRate={list?.recordRate} recordingDays={list?.recordingDays} onSaved={saved} onDeleted={() => nav(cp('/app/receptionist?tab=setup'))} /></div>
          <div className="lg:col-span-2 space-y-4">{isNew ? <div className="civr-card p-6 text-sm text-[var(--c-muted)]" data-testid="receptionist-save-first-note">Save it, then call it from your browser to hear how it answers before it takes real calls.</div> : <><TestTalk agent={agent} /><AiCalls agentId={agent.id} direction="inbound" /></>}</div>
        </div>
      )}
    </div>
  );
}
