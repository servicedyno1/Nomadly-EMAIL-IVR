import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Clock, Ban } from 'lucide-react';
import { useApi } from '../../api';
import { Field, Toggle, Spinner } from '../../ui';
import { cp } from '../../paths';
import { Assist } from '../../Assist';
import { AI_LANGS } from '../ai/languages';

const AGENT_KEYS = ['name', 'businessName', 'language', 'voice', 'firstMessage', 'goal', 'knowledge', 'transferTo', 'takeMessages', 'discloseAi'];
export const NEW_AGENT = { name: '', businessName: '', language: 'en', voice: 'marin', firstMessage: '', goal: '', knowledge: '', transferTo: '', takeMessages: true, discloseAi: true };
const pickAgent = (a) => Object.fromEntries(AGENT_KEYS.map(k => [k, a?.[k] ?? NEW_AGENT[k] ?? '']));
// Draft of the agent the campaign uses: a copy of a saved agent (changes are saved back to it) or a new one.
export const draftOf = (a) => { const d = pickAgent(a); return { ...d, _orig: JSON.stringify(d) }; };
export const agentChanged = (d) => JSON.stringify(pickAgent(d)) !== d._orig;
export const agentBody = (d) => pickAgent(d);

const LABELS = { agentId: 'Agent', agentName: 'Agent name', businessName: 'Business', language: 'Language', voice: 'Voice', firstMessage: 'Opening line', goal: 'Script', knowledge: 'FAQs', transferTo: 'Hand over to', takeMessages: 'Messages', discloseAi: 'AI notice', name: 'Campaign', callerId: 'Calls from', listId: 'Contact list', leads: 'Numbers', concurrency: 'Calls at once', scheduledFor: 'Start', repeat: 'Repeat', dailyLimit: 'Daily limit' };
const EXAMPLES = ['Call my new leads and book a free consultation, hand interested people to +14155550100', 'Follow up on quotes we sent last week, in Spanish', 'Remind patients about their check-up and confirm the time'];
const CAMPAIGN_KEYS = ['name', 'callerId', 'listId', 'leads', 'concurrency', 'scheduledFor', 'repeat', 'dailyLimit'];

// One Emily chat writes the AI agent and sets up who it calls, from which number and when.
export function AiAssist({ f, setF, draft, setDraft, agents, numbers, lists }) {
  const current = { agentId: f.agentId, agentName: draft.name, ...Object.fromEntries(AGENT_KEYS.slice(1).map(k => [k, draft[k]])), ...Object.fromEntries(CAMPAIGN_KEYS.map(k => [k, f[k] ?? ''])) };
  const context = {
    agents: agents.map(a => ({ id: a.id, name: a.name, businessName: a.businessName, about: String(a.goal || '').slice(0, 160) })),
    callerNumbers: numbers.map(n => n.phoneNumber),
    contactLists: lists.map(l => ({ id: l.id, name: l.name, count: l.count })),
  };
  const apply = ({ agentId, agentName, ...p }) => {
    const ag = Object.fromEntries(Object.entries({ name: agentName, ...p }).filter(([k, v]) => AGENT_KEYS.includes(k) && v !== undefined));
    const camp = Object.fromEntries(Object.entries(p).filter(([k]) => CAMPAIGN_KEYS.includes(k)));
    const known = agentId === 'new' || agents.some(a => a.id === agentId);
    const switching = agentId !== undefined && known && agentId !== f.agentId;
    if (switching) setDraft({ ...draftOf(agentId === 'new' ? NEW_AGENT : agents.find(a => a.id === agentId)), ...ag });
    else if (Object.keys(ag).length) setDraft(d => ({ ...d, ...ag }));
    if (camp.listId && !lists.some(l => l.id === camp.listId)) delete camp.listId;
    if (camp.callerId && !numbers.some(n => n.phoneNumber === camp.callerId)) delete camp.callerId;
    const source = camp.listId ? { source: 'list' } : camp.leads ? { source: 'numbers' } : {};
    setF(x => ({ ...x, ...camp, ...source, ...(switching ? { agentId } : {}) }));
  };
  return <Assist screen="aicampaign" title="Set up your AI conversation campaign by chatting" hello="Tell me who you want to call and what the conversation is for — I’ll write the AI agent, pick your number and set up the list. You press Save campaign yourself." examples={EXAMPLES} current={current} context={context} onApply={apply} labels={LABELS} saveLabel="Save campaign" testid="aicampaign-assist" />;
}

const Text = ({ d, set, k, rows, ph, testid, max }) => (rows
  ? <textarea rows={rows} maxLength={max} className="civr-input" value={d[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} data-testid={testid} />
  : <input className="civr-input" maxLength={max} value={d[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} data-testid={testid} />);

// The agent part of an AI conversation campaign: reuse a saved agent (edits are saved to it) or write a new one.
export function AgentPanel({ agentId, onAgent, draft, setDraft, agents, voices }) {
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const saved = agents.find(a => a.id === agentId);
  return (
    <div className="space-y-4" data-testid="aicampaign-agent-panel">
      <Field label="AI agent" hint={saved ? `Changes below are saved to “${saved.name}” when you save the campaign.` : 'A new agent is saved with the campaign. You can reuse it next time.'}>
        <select className="civr-input" value={agentId} onChange={e => onAgent(e.target.value)} data-testid="campaign-ai-agent-select">
          <option value="new">New agent</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.businessName ? ` · ${a.businessName}` : ''}</option>)}
        </select>
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Agent name"><Text d={draft} set={set} k="name" max={40} ph="Ava" testid="aicampaign-agent-name-input" /></Field>
        <Field label="Business name"><Text d={draft} set={set} k="businessName" max={60} ph="Sunrise Dental" testid="aicampaign-agent-business-input" /></Field>
        <Field label="Language"><select className="civr-input" value={draft.language} onChange={e => set('language', e.target.value)} data-testid="aicampaign-agent-language-select">{AI_LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
        <Field label="Voice"><select className="civr-input capitalize" value={draft.voice} onChange={e => set('voice', e.target.value)} data-testid="aicampaign-agent-voice-select">{(voices || [draft.voice]).map(v => <option key={v} value={v}>{v}</option>)}</select></Field>
      </div>
      <Field label="Opening line (optional)" hint="Use {name}, {business} and {lead_name|there}. Leave empty for the standard opening."><Text d={draft} set={set} k="firstMessage" rows={2} max={500} ph="Hi {lead_name|there}, this is {name} from {business}. Do you have a minute?" testid="aicampaign-agent-first-message-input" /></Field>
      <Field label="What the agent does on each call" hint="How it talks, what it must find out and when to hand over."><Text d={draft} set={set} k="goal" rows={5} max={4000} ph="Friendly and brief. Ask if they still want a quote, book a call-back time and get their email." testid="aicampaign-agent-goal-input" /></Field>
      <Field label="FAQs & facts" hint="Prices, hours, offers — the agent only uses what is here."><Text d={draft} set={set} k="knowledge" rows={4} max={6000} ph="Free consultation: 30 minutes. Open Mon–Fri 9–5." testid="aicampaign-agent-knowledge-input" /></Field>
      <Field label="Hand interested people to (optional)"><Text d={draft} set={set} k="transferTo" ph="+14155550199" testid="aicampaign-agent-transfer-input" /></Field>
      <div className="flex items-center justify-between gap-4"><span className="text-sm">Take a message when nobody can take the call</span><Toggle checked={draft.takeMessages !== false} onChange={v => set('takeMessages', v)} testid="aicampaign-agent-messages-toggle" label="Take messages" /></div>
      <div className="flex items-center justify-between gap-4"><span className="text-sm">Say it’s an AI at the start</span><Toggle checked={draft.discloseAi !== false} onChange={v => set('discloseAi', v)} testid="aicampaign-agent-disclose-toggle" label="Say it’s an AI" /></div>
      {saved && <Link to={cp(`/app/ai-agents/${saved.id}`)} className="text-sm text-[var(--c-accent)] underline" data-testid="aicampaign-agent-more-link">More settings for this agent: keys, hours, booking, test talk</Link>}
      <AiRules />
    </div>
  );
}

const AiRules = () => (
  <ul className="text-xs text-[#a1a1aa] space-y-2" data-testid="campaign-ai-rules">
    <li className="flex gap-2"><Clock className="w-4 h-4 shrink-0 text-[#818cf8]" />Calls only between 8am and 9pm in each lead's local time — others wait and are called when their window opens.</li>
    <li className="flex gap-2"><Ban className="w-4 h-4 shrink-0 text-[#818cf8]" />Numbers on your do-not-call list are skipped; anyone who asks not to be called again is added to it.</li>
    <li className="flex gap-2"><Bot className="w-4 h-4 shrink-0 text-[#818cf8]" />The agent waits for hello, leaves one voicemail after the beep and bills $0.30 per started minute (+$0.02 when it records). Unanswered calls are free.</li>
  </ul>
);

// Loads the saved agents and contact lists, and starts with the newest agent (or a new one).
export function useAiSetup(on, f, setF, setDraft) {
  const { data: ag, reload } = useApi(on ? '/ai-agents' : null);
  const { data: li } = useApi(on ? '/contacts/lists' : null);
  const agents = ag?.agents || [];
  useEffect(() => {
    if (!on || !ag || f.agentId) return;
    const first = agents[0];
    setF(x => ({ ...x, agentId: first ? first.id : 'new' }));
    setDraft(draftOf(first || NEW_AGENT));
  }, [on, ag]); // eslint-disable-line react-hooks/exhaustive-deps
  const onAgent = (id) => { setF(x => ({ ...x, agentId: id })); setDraft(draftOf(id === 'new' ? NEW_AGENT : agents.find(a => a.id === id))); };
  return { ready: !!ag, agents, voices: ag?.voices, lists: (li?.lists || []).filter(l => l.count > 0), onAgent, reload };
}

export const AiLoading = () => <Spinner label="Loading your agents…" testid="campaign-ai-agents-loading" />;
