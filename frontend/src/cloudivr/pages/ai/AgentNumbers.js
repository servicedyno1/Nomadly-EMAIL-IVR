import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Phone, Plus, Loader2, X, ShoppingCart } from 'lucide-react';
import { api, enc, useApi } from '../../api';
import { Spinner, SeePricing } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';
import { ask } from '../../confirm';

// Dedicated inbound lines for one AI agent: assign a Business-capable number (full or extra) so this
// agent answers its calls on its own number. One number answers with exactly one agent.
export default function AgentNumbers({ agent, agents = [] }) {
  const pv = usePrivacy();
  const { data, loading, reload } = useApi('/numbers');
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState('');
  const nums = data?.numbers || [];
  const eligible = nums.filter(n => n.status === 'active' && n.access?.aiAgent);
  const mine = eligible.filter(n => n.features?.aiAgent?.enabled && n.features.aiAgent.agentId === agent.id);
  const assignable = eligible.filter(n => !(n.features?.aiAgent?.enabled && n.features.aiAgent.agentId === agent.id));
  const agentName = (gid) => agents.find(a => a.id === gid)?.name;

  const put = async (phone, body, okMsg) => {
    setBusy(phone);
    try { const r = await api(`/numbers/${enc(phone)}/ai-agent`, { method: 'PUT', body }); reload(); toast.success(r?.forwardingTurnedOff ? `${okMsg} Forward-every-call on that number is now off.` : r?.ivrTurnedOff ? `${okMsg} The keypad menu on that number is now off.` : okMsg); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const assign = async () => {
    const n = assignable.find(x => x.phoneNumber === sel);
    if (!n) return;
    const other = n.features?.aiAgent?.enabled && n.features.aiAgent.agentId && n.features.aiAgent.agentId !== agent.id;
    if (other && !(await ask(`${pv.phone(n.phoneNumber)} is answered by “${agentName(n.features.aiAgent.agentId) || 'another agent'}”. Move it to “${agent.name}” instead?`, { ok: 'Move it here', cancel: 'Keep it there', title: 'Reassign this number?' }))) return;
    await put(n.phoneNumber, { enabled: true, agentId: agent.id }, `${pv.phone(n.phoneNumber)} now answers with ${agent.name}.`);
    setSel('');
  };

  const unassign = async (phone) => {
    if (!(await ask(`Stop ${agent.name} from answering ${pv.phone(phone)}? The number goes back to normal call handling.`, { danger: true, ok: 'Unassign', cancel: 'Keep it', title: 'Unassign number?' }))) return;
    await put(phone, { enabled: false, agentId: null }, `${pv.phone(phone)} unassigned.`);
  };

  if (loading && !data) return <div className="civr-card p-6" data-testid="agent-numbers-card"><Spinner /></div>;
  return (
    <div className="civr-card p-6 space-y-4" data-testid="agent-numbers-card">
      <div className="flex items-center gap-2 font-display text-xl font-bold"><Phone className="w-5 h-5 text-[#818cf8]" />Dedicated numbers</div>
      <p className="text-sm text-[#a1a1aa]">Give this agent its own inbound number so it takes calls independently. A number answers with one agent — assigning it here switches off that number’s keypad menu.</p>

      {mine.length > 0 ? (
        <div className="space-y-2" data-testid="agent-numbers-assigned">
          {mine.map((n, i) => (
            <div key={n.phoneNumber} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--c-border,#1f1f1f)] px-3 py-2.5" data-testid={`agent-number-row-${i}`}>
              <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}?tab=ai-agent`)} className="font-mono text-sm text-[#f4f4f5] hover:text-[#818cf8]" data-testid={`agent-number-row-${i}-link`}>{pv.phone(n.phoneNumber)}</Link>
              <div className="flex items-center gap-2">
                <span className="civr-pill">{n.planName}{n.isSubNumber ? ' · extra' : ''}</span>
                <button type="button" onClick={() => unassign(n.phoneNumber)} disabled={busy === n.phoneNumber} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#a1a1aa] hover:text-[#fb7185] hover:bg-[#1f1f1f] transition-colors" aria-label={`Unassign ${n.phoneNumber}`} data-testid={`agent-number-row-${i}-unassign`}>{busy === n.phoneNumber ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}</button>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="text-sm text-[#a1a1aa]" data-testid="agent-numbers-none">No number answers with this agent yet.</div>}

      {assignable.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 pt-1" data-testid="agent-numbers-assign">
          <select className="civr-input !h-10 flex-1" value={sel} onChange={e => setSel(e.target.value)} data-testid="agent-numbers-select">
            <option value="">Assign one of your numbers…</option>
            {assignable.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{`${pv.phone(n.phoneNumber)} · ${n.planName}${n.isSubNumber ? ' (extra)' : ''}${n.features?.aiAgent?.enabled && n.features.aiAgent.agentId ? ` — now on ${agentName(n.features.aiAgent.agentId) || 'another agent'}` : ''}`}</option>)}
          </select>
          <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={!sel || busy === sel} onClick={assign} data-testid="agent-numbers-assign-button">{busy === sel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Assign</button>
        </div>
      )}

      <div className="pt-1 text-sm">
        <Link to={cp('/app/buy?plan=business')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="agent-numbers-buy-link"><ShoppingCart className="w-4 h-4" />Get a number for this agent</Link>
        <p className="text-xs text-[#a1a1aa] mt-2">Any plan can use the AI receptionist on incoming calls. Outgoing AI conversation campaigns need a Pro or Business number. <SeePricing testid="agent-numbers-see-pricing" /></p>
      </div>
    </div>
  );
}
