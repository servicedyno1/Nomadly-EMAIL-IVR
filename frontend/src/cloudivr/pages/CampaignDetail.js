import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Play, Pause, RotateCcw, XCircle } from 'lucide-react';
import { api, useApi, when, secs } from '../api';
import { useShell } from '../Shell';
import { Spinner, ErrorNote, statusPill } from '../ui';
import { cp } from '../paths';

const STATS = [['total', 'Numbers'], ['completed', 'Called'], ['answered', 'Answered'], ['keyPressed', 'Pressed a key'], ['transferred', 'Transferred'], ['noAnswer', 'No answer']];
const LIVE = ['running', 'scheduled'];

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
  const { data, error, loading, reload, setData } = useApi(`/campaigns/${id}`);
  const [busy, setBusy] = useState(false);
  const c = data?.campaign;
  useEffect(() => { if (!c || !LIVE.includes(c.status)) return undefined; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [c, reload]);

  const act = async (action) => {
    if (action === 'cancel' && !window.confirm('Cancel this campaign? No more numbers are dialed. Calls still ringing or playing the message end now; calls already transferred to you keep going.')) return;
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
  const pct = c.stats?.total ? Math.round(((c.stats.completed || 0) / c.stats.total) * 100) : 0;
  return (
    <div data-testid="campaign-detail-page">
      <Link to={cp('/app/campaigns')} className="inline-flex items-center gap-2 text-sm text-[#888] hover:text-[#34d399] mb-6" data-testid="campaign-back-link"><ArrowLeft className="w-4 h-4" />All campaigns</Link>
      <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between mb-8">
        <div>
          <div className="civr-label">{c.mode === 'transfer' ? `Transfer to ${c.transferNumber}` : 'Report key presses'} · keys {c.activeKeys?.join(' ')}</div>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold mt-2" data-testid="campaign-title">{c.audioName || 'Campaign'}</h1>
          <div className="text-sm text-[#888] font-mono mt-1">from {c.callerId} · created {when(c.createdAt)}{c.scheduledFor ? ` · scheduled ${when(c.scheduledFor)}` : ''}</div>
        </div>
        <div className="flex items-center gap-2"><span className={statusPill(c.status)} data-testid="campaign-status">{c.status}</span>{c.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}</div>
      </div>
      <div className="civr-card p-6 mb-4">
        <div className="flex items-center justify-between mb-3"><span className="text-sm text-[#aaa]">Progress</span><span className="font-mono text-sm" data-testid="campaign-progress">{pct}%</span></div>
        <div className="h-2 rounded-full bg-[#1c1c1c] overflow-hidden"><div className={`h-full bg-[#34d399] transition-[width] duration-700 ${c.status === 'running' ? 'civr-pulse' : ''}`} style={{ width: `${pct}%` }} /></div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mt-6">{STATS.map(([k, l]) => <div key={k} data-testid={`campaign-stat-${k}`}><div className="font-mono text-2xl">{c.stats?.[k] || 0}</div><div className="text-xs text-[#9a9a9a]">{l}</div></div>)}</div>
        <div className="mt-6"><Controls c={c} act={act} busy={busy} /></div>
        {(c.cancelledReason || c.pausedReason) && <div className="text-xs text-[#888] mt-3" data-testid="campaign-reason">{c.cancelledReason || c.pausedReason}</div>}
      </div>
      <div className="civr-card p-6 overflow-x-auto">
        <div className="font-display text-2xl font-bold mb-3">Numbers</div>
        <table className="civr-table" data-testid="campaign-leads-table">
          <thead><tr><th>Number</th><th>Name</th><th>Status</th><th>Key</th><th>Length</th></tr></thead>
          <tbody>{(c.leads || []).map((l, i) => (
            <tr key={`${l.number}-${i}`} data-testid={`campaign-lead-${i}`}><td className="font-mono text-xs">{l.number}</td><td>{l.name || '—'}</td><td><span className={statusPill(l.status)}>{l.status}</span>{l.transferred && <span className="civr-pill civr-pill-on ml-1">transferred</span>}</td><td className="font-mono">{l.digitPressed || '—'}</td><td className="font-mono text-xs">{l.duration ? secs(l.duration) : '—'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
