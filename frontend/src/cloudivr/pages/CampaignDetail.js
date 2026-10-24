import React, { useEffect, useState } from 'react';
import { ask } from '../i18n';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Play, Pause, RotateCcw, XCircle, Download } from 'lucide-react';
import { api, useApi, when, secs, downloadFile } from '../api';
import { useShell } from '../Shell';
import { Spinner, ErrorNote, statusPill } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { outcomeLabel } from './ai/AiCalls';

const STATS = [['total', 'Numbers'], ['completed', 'Called'], ['answered', 'Answered'], ['keyPressed', 'Pressed a key'], ['transferred', 'Transferred'], ['noAnswer', 'No answer']];
const AI_STATS = [['total', 'Numbers'], ['completed', 'Called'], ['answered', 'Talked'], ['interested', 'Interested'], ['callback', 'Call back'], ['skipped', 'Do-not-call']];
const LIVE = ['running', 'scheduled'];

function Waiting({ c }) {
  if (c.status !== 'running' || (!c.waitingForHours && !c.waitingForLine)) return null;
  return <div className="text-xs text-[#fbbf24] mt-3" data-testid="campaign-waiting-note">{c.waitingForLine ? 'All your lines are busy — waiting numbers are redialed automatically as soon as a line frees up.' : 'Waiting for calling hours — the remaining numbers are called between 8am and 9pm their local time.'}</div>;
}

function Controls({ c, act, busy }) {
  const btn = (action, label, Icon, cls = 'civr-btn-ghost') => <button className={`civr-btn ${cls} civr-btn-sm`} disabled={busy} onClick={() => act(action)} data-testid={`campaign-${action}-button`}><Icon className="w-4 h-4" />{label}</button>;
  return (
    <div className="flex flex-wrap gap-2">
      {c.status === 'created' && btn('start', 'Start calling', Play, 'civr-btn-primary')}
      {c.status === 'running' && btn('pause', 'Pause', Pause)}
      {c.status === 'paused' && btn('resume', 'Resume', RotateCcw, 'civr-btn-primary')}
      {['created', 'running', 'paused', 'scheduled'].includes(c.status) && btn('cancel', 'Cancel', XCircle, 'civr-btn-danger')}
    </div>
  );
}

export default function CampaignDetail() {
  const { id } = useParams();
  const { refreshSummary } = useShell();
  const pv = usePrivacy();
  const { data, error, loading, reload, setData } = useApi(`/campaigns/${id}`);
  const [busy, setBusy] = useState(false);
  const c = data?.campaign;
  useEffect(() => { if (!c || !LIVE.includes(c.status)) return undefined; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [c, reload]);

  const act = async (action) => {
    if (action === 'cancel' && !ask('Cancel this campaign? No more numbers are dialed. Calls still ringing or playing the message end now; calls already transferred to you keep going.')) return;
    setBusy(true);
    try {
      const d = await api(`/campaigns/${id}/${action}`, { method: 'POST' });
      if (d.dryRun) toast.message(d.message); else toast.success(`Campaign ${action === 'start' ? 'started' : action === 'cancel' ? 'cancelled' : `${action}d`}`);
      if (d.campaign) setData(p => ({ campaign: { ...p.campaign, ...d.campaign } })); else reload();
      refreshSummary();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (loading && !c) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const isAi = c.mode === 'ai';
  const pct = c.stats?.total ? Math.round(((c.stats.completed || 0) / c.stats.total) * 100) : 0;
  return (
    <div data-testid="campaign-detail-page">
      <Link to={cp('/app/campaigns')} className="inline-flex items-center gap-2 text-sm text-[#a1a1aa] hover:text-[#34d399] mb-6" data-testid="campaign-back-link"><ArrowLeft className="w-4 h-4" />All campaigns</Link>
      <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between mb-8">
        <div>
          <div className="civr-label">{isAi ? `AI agent conversation · ${c.agentName || ''}` : `${c.mode === 'menu' ? 'Menu' : c.mode === 'transfer' ? `Transfer to ${pv.phone(c.transferNumber)}` : 'Report key presses'} · keys ${c.activeKeys?.join(' ')}`}</div>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold mt-2" data-testid="campaign-title">{c.audioName || 'Campaign'}</h1>
          <div className="text-sm text-[#a1a1aa] font-mono mt-1">from {pv.phone(c.callerId)} · created {when(c.createdAt)}{c.scheduledFor ? ` · scheduled ${when(c.scheduledFor)}` : ''}</div>
        </div>
        <div className="flex items-center gap-2"><span className={statusPill(c.status)} data-testid="campaign-status">{c.status}</span>{c.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}</div>
      </div>
      <div className="civr-card p-6 mb-4">
        <div className="flex items-center justify-between mb-3"><span className="text-sm text-[#d4d4d8]">Progress</span><span className="font-mono text-sm" data-testid="campaign-progress">{pct}%</span></div>
        <div className="h-2 rounded-full bg-[#1c1c1c] overflow-hidden"><div className={`h-full bg-[#34d399] transition-[width] duration-700 ${c.status === 'running' ? 'civr-pulse' : ''}`} style={{ width: `${pct}%` }} /></div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mt-6">{(isAi ? AI_STATS : STATS).map(([k, l]) => <div key={k} data-testid={`campaign-stat-${k}`}><div className="font-mono text-2xl">{c.stats?.[k] || 0}</div><div className="text-xs text-[#a1a1aa]">{l}</div></div>)}</div>
        <div className="mt-6 flex flex-wrap gap-2"><Controls c={c} act={act} busy={busy} />
          <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => downloadFile(`/campaigns/${id}/report.csv`, `campaign-${String(id).slice(0, 8)}.csv`).catch(e => toast.error(e.message))} data-testid="campaign-report-download-button"><Download className="w-4 h-4" />Download CSV report</button></div>
        <Waiting c={c} />
        {(c.cancelledReason || c.pausedReason) && <div className="text-xs text-[#a1a1aa] mt-3" data-testid="campaign-reason">{c.cancelledReason || c.pausedReason}</div>}
      </div>
      <div className="civr-card p-6 overflow-x-auto">
        <div className="font-display text-2xl font-bold mb-3">Numbers</div>
        <table className="civr-table" data-testid="campaign-leads-table">
          <thead><tr><th>Number</th><th>Name</th><th>Status</th><th>{isAi ? 'AI result' : 'Key'}</th><th>Length</th></tr></thead>
          <tbody>{(c.leads || []).map((l, i) => (
            <tr key={`${l.number}-${i}`} data-testid={`campaign-lead-${i}`}><td className="font-mono text-xs">{pv.phone(l.number)}</td><td>{pv.text(l.name, '•••') || '—'}</td><td><span className={statusPill(l.status)}>{l.status}</span>{l.transferred && <span className="civr-pill civr-pill-on ml-1">transferred</span>}{l.waitingForLine && l.status === 'pending' && <span className="civr-pill civr-pill-warn ml-1" data-testid={`campaign-lead-${i}-waiting-line`}>waiting for a line</span>}</td><td className={isAi ? 'text-xs max-w-xs' : 'font-mono'} data-testid={`campaign-lead-${i}-result`}>{isAi ? (l.ai ? <><span className="civr-pill">{outcomeLabel(l.ai.outcome)}</span>{l.ai.summary && <div className="text-[#a1a1aa] mt-1">{pv.text(l.ai.summary, 'Summary hidden')}</div>}</> : l.hangupCause && l.status === 'skipped' ? l.hangupCause : '—') : (l.digitPressed || '—')}</td><td className="font-mono text-xs">{l.duration ? secs(l.duration) : '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
