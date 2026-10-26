import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Repeat, Gauge, Loader2, CircleStop } from 'lucide-react';
import { api, when } from '../../api';
import { ask } from '../../i18n';
import { cp } from '../../paths';
import { Pipeline, RunStats, CallFeed, TopAreas, repeatLabel } from './LiveParts';

// Repeat + daily call limit of this campaign, with "Stop repeating".
export function RunPlan({ c, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!c.repeat && !c.dailyLimit && !c.runNumber) return null;
  const stop = async () => {
    if (!(await ask('Stop repeating this campaign? No new runs are made and the next scheduled run is cancelled. Calls going on now keep going.', { danger: true, ok: 'Stop repeating', cancel: 'Keep repeating' }))) return;
    setBusy(true);
    try { const d = await api(`/campaigns/${c.id}/stop-repeat`, { method: 'POST' }); toast.success(d.cancelledRuns ? 'Repeat stopped · next run cancelled' : 'Repeat stopped'); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const next = c.nextRun && c.nextRun.status === 'scheduled' ? c.nextRun : null;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-3" data-testid="campaign-run-plan">
      {c.repeat && <span className="civr-pill civr-pill-on" data-testid="campaign-repeat-pill"><Repeat className="w-3 h-3" />{repeatLabel(c.repeat)}</span>}
      {c.runNumber > 1 && <span className="civr-pill" data-testid="campaign-run-number">{`Run ${c.runNumber}`}</span>}
      {next && <Link to={cp(`/app/campaigns/${next.id}`)} className="civr-pill hover:border-[#818cf8] transition-colors" data-testid="campaign-next-run-link">{`Next run ${when(next.scheduledFor)}`}</Link>}
      {c.dailyLimit && <span className="civr-pill" data-testid="campaign-daily-limit-pill"><Gauge className="w-3 h-3" />{`${c.callsToday || 0} / ${c.dailyLimit} calls today`}</span>}
      {c.repeat && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={stop} data-testid="campaign-stop-repeat-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CircleStop className="w-4 h-4" />}Stop repeating</button>}
    </div>
  );
}

// Pipeline + pace while the campaign is running or paused.
export function LiveNow({ c }) {
  if (!['running', 'paused'].includes(c.status) || !c.live) return null;
  return (
    <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 mt-6 items-center" data-testid="campaign-live-now">
      <Pipeline p={c.live.pipeline} testid="campaign-pipeline" />
      <RunStats c={c} testid="campaign-run-stats" />
    </div>
  );
}

// Live call feed + top areas, once dialing has started.
export function FeedAndAreas({ c, isAi }) {
  if (!c.startedAt && !c.feed?.length) return null;
  const live = c.status === 'running';
  return (
    <div className="grid lg:grid-cols-3 gap-4 mb-4">
      <div className="civr-card p-5 sm:p-6 lg:col-span-2 min-w-0" data-testid="campaign-feed-card">
        <div className="flex items-center gap-2 mb-4"><span className={`w-2 h-2 rounded-full ${live ? 'bg-[#34d399] civr-live-dot' : 'bg-[#52525b]'}`} /><span className="font-display text-2xl font-bold">{live ? 'Live call feed' : 'Latest calls'}</span></div>
        <CallFeed feed={c.feed} testid="campaign-feed" />
      </div>
      <div className="civr-card p-5 sm:p-6 h-fit min-w-0" data-testid="campaign-areas-card">
        <div className="font-display text-2xl font-bold">Top areas</div>
        <div className="text-xs text-[#a1a1aa] mt-1 mb-4">From each number’s area code · % = answered of called</div>
        {c.areas?.length ? <TopAreas areas={c.areas} isAi={isAi} testid="campaign-areas" /> : <div className="text-sm text-[#a1a1aa]" data-testid="campaign-areas-empty">No numbers yet.</div>}
      </div>
    </div>
  );
}
