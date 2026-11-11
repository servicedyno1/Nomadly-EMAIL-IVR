import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PhoneForwarded, Headphones, CalendarClock, Loader2, Trophy } from 'lucide-react';
import { api, when } from '../../api';
import { cp } from '../../paths';
import { ReachStats } from './LiveParts';

const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

// Finished campaign: what it achieved, what each result cost, and one-tap follow-ups.
export function Results({ c }) {
  const e = c.engagement, nav = useNavigate();
  const [busy, setBusy] = useState('');
  if (!e || !['completed', 'cancelled'].includes(c.status) || !e.called) return null;
  const go = async (key, kind, whenTo) => {
    setBusy(key);
    try {
      const d = await api(`/campaigns/${c.id}/followup`, { method: 'POST', body: { kind, when: whenTo } });
      toast.success(d.scheduledFor ? `Follow-up scheduled for ${when(d.scheduledFor)} — ${d.leadsCount} numbers` : `Follow-up ready — ${d.leadsCount} numbers. Review it and press Start.`);
      nav(cp(`/app/campaigns/${d.campaign.id}`));
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };
  const btn = (key, label, Icon, kind, whenTo, primary) => (
    <button type="button" className={`civr-btn civr-btn-sm ${primary ? 'civr-btn-primary' : 'civr-btn-ghost'}`} disabled={!!busy} onClick={() => go(key, kind, whenTo)} data-testid={`campaign-followup-${key}`}>
      {busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}{label}
    </button>
  );
  const facts = [
    e.perPerson != null ? `$${e.spent.toFixed(2)} spent · $${e.perPerson.toFixed(2)} per person reached${e.perHot != null ? ` · $${e.perHot.toFixed(2)} per hot lead` : ''}` : null,
    e.bestHour ? `Best hour: ${hourLabel(e.bestHour.hour)} (${e.bestHour.reached} reached)` : null,
    e.bestArea ? `Best area: ${e.bestArea.area} (${e.bestArea.pct}% answered)` : null,
  ].filter(Boolean);
  return (
    <div className="civr-card p-6 mb-4" data-testid="campaign-results">
      <div className="flex items-center gap-2 mb-4"><Trophy className="w-4 h-4 text-[#f59e0b]" /><span className="font-semibold">What this campaign achieved</span></div>
      <ReachStats l={e} testid="campaign-results-reach" />
      {facts.length > 0 && <ul className="text-sm text-[#a1a1aa] mt-4 flex flex-col gap-1" data-testid="campaign-results-facts">{facts.map(f => <li key={f}>{f}</li>)}</ul>}
      {(e.unanswered > 0 || e.listenersNoKey > 0) && (
        <div className="mt-5">
          <div className="text-sm font-medium mb-2">Keep the momentum — same message and settings:</div>
          <div className="flex flex-wrap gap-2">
            {e.unanswered > 0 && btn('unanswered', `Re-call ${e.unanswered} unanswered`, PhoneForwarded, 'unanswered', 'now', true)}
            {e.listenersNoKey > 0 && btn('listeners', `Call ${e.listenersNoKey} listeners again`, Headphones, 'listeners', 'now')}
            {e.unanswered > 0 && e.bestHour && btn('best', `Re-call unanswered tomorrow at ${hourLabel(e.bestHour.hour)}`, CalendarClock, 'unanswered', 'best')}
          </div>
        </div>
      )}
    </div>
  );
}
