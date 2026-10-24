import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Bot } from 'lucide-react';
import { useApi } from '../../api';
import { Toggle, Spinner, Empty } from '../../ui';
import { cp } from '../../paths';
import { useSave } from './SettingsTabs';

// Lets one of the account's AI agents answer every call to this number (Pro plan and up).
export default function AiAgentTab({ num, reload }) {
  const { data, loading } = useApi('/ai-agents');
  const cur = num.features?.aiAgent || {};
  const [agentId, setAgentId] = useState(cur.agentId || '');
  const [enabled, setEnabled] = useState(!!cur.enabled);
  const [save, busy] = useSave(num, 'ai-agent', reload);
  const agents = data?.agents || [];
  const first = agents[0]?.id;
  useEffect(() => { if (!agentId && first) setAgentId(first); }, [first, agentId]);
  if (loading && !data) return <Spinner />;
  if (!agents.length) return <Empty icon={Bot} title="Create an AI agent first" sub="Give it a script and FAQs, test it in your browser, then let it answer this number." testid="number-ai-empty"><Link to={cp('/app/ai-agents/new')} className="civr-btn civr-btn-primary" data-testid="number-ai-create-link">Create an agent</Link></Empty>;
  return (
    <div className="civr-card p-6 max-w-2xl space-y-6" data-testid="number-ai-tab">
      <div>
        <div className="font-display text-2xl font-bold">AI agent answers this number</div>
        <p className="text-sm text-[#a1a1aa] mt-1">The agent picks up every call, says it is an AI assistant, answers from your FAQs, takes messages or transfers to you. ${Number(data?.rate || 0.2).toFixed(2)} per started minute from your wallet; if the wallet runs out it says goodbye and hangs up.</p>
      </div>
      <div className="flex items-center justify-between"><span className="text-sm">Answer calls with the AI agent</span><Toggle checked={enabled} onChange={setEnabled} testid="number-ai-enabled-toggle" /></div>
      <select className="civr-input" value={agentId} onChange={e => setAgentId(e.target.value)} data-testid="number-ai-agent-select">{agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.businessName ? ` · ${a.businessName}` : ''}</option>)}</select>
      <div className="flex flex-wrap gap-2">
        <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => save({ enabled, agentId }, 'PUT')} data-testid="number-ai-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save</button>
        <Link to={cp(`/app/ai-agents/${agentId}`)} className="civr-btn civr-btn-ghost" data-testid="number-ai-edit-agent-link">Edit or test the agent</Link>
      </div>
      <span className={enabled && cur.enabled ? 'civr-pill civr-pill-on' : 'civr-pill'} data-testid="number-ai-status-pill">{cur.enabled ? 'AI agent is answering' : 'Normal call handling'}</span>
    </div>
  );
}
