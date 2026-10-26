import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Radio, Plus, Pause, Play, XCircle, Loader2, CalendarClock, ChevronRight, Repeat } from 'lucide-react';
import { api, useApi, enc, when } from '../api';
import { ask } from '../i18n';
import { PageHeader, SkeletonPage, Empty, ErrorNote, statusPill } from '../ui';
import { cp } from '../paths';
import { useShell } from '../Shell';
import { Pipeline, RunStats, CallFeed, repeatLabel } from './campaign/LiveParts';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const pct = (c) => (c.stats?.total ? Math.round(((c.stats.completed || 0) / c.stats.total) * 100) : 0);

function Summary({ s }) {
  const rate = s.callsToday ? Math.round((s.answeredToday / s.callsToday) * 100) : 0;
  const tiles = [
    ['calling', 'Calling now', String(s.linesInUse), s.linesInUse > 0],
    ['lines', 'Lines in use', `${s.linesInUse} / ${s.lineCapacity}`],
    ['rate', 'Calls per minute', String(s.ratePerMin)],
    ['today', 'Calls today', String(s.callsToday)],
    ['answered', 'Answered today', `${s.answeredToday} · ${rate}%`],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" data-testid="live-summary">
      {tiles.map(([k, label, v, on], i) => (
        <div key={k} className={`civr-card p-4 sm:p-5 min-w-0 civr-rise ${i === 0 ? 'col-span-2 md:col-span-1' : ''}`} style={{ animationDelay: `${i * 50}ms` }}>
          <div className="flex items-center gap-2 text-xs text-[#a1a1aa]">{on && <span className="w-2 h-2 rounded-full bg-[#34d399] civr-live-dot" />}{label}</div>
          <div className="font-mono text-2xl sm:text-3xl mt-2 truncate" data-testid={`live-summary-${k}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function CardActions({ c, i, onDone }) {
  const [busy, setBusy] = useState('');
  const act = async (action) => {
    if (action === 'cancel' && !(await ask('Stop this campaign? No more numbers are dialed. Calls still ringing or playing the message end now; calls already transferred to you keep going.', { danger: true, ok: 'Stop campaign', cancel: 'Keep it running' }))) return;
    setBusy(action);
    try {
      const d = await api(`/campaigns/${c.id}/${action}`, { method: 'POST' });
      if (d.dryRun) toast.message(d.message); else toast.success(action === 'pause' ? 'Campaign paused' : action === 'resume' ? 'Campaign resumed' : 'Campaign stopped');
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const btn = (action, label, Icon, cls) => <button type="button" className={`civr-btn civr-btn-sm ${cls}`} disabled={!!busy} onClick={() => act(action)} data-testid={`live-campaign-${i}-${action}`}>{busy === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}{label}</button>;
  return (
    <div className="flex flex-wrap gap-2">
      {c.status === 'running' ? btn('pause', 'Pause', Pause, 'civr-btn-ghost') : btn('resume', 'Resume', Play, 'civr-btn-primary')}
      {btn('cancel', 'Stop', XCircle, 'civr-btn-danger')}
    </div>
  );
}

const waitNote = (c) => (c.status === 'paused' ? (c.pausedReason === 'wallet' ? 'Paused — your wallet ran low. Top up, then resume.' : 'Paused — no new calls until you resume.')
  : c.waitingForDailyLimit ? 'Today’s call limit is reached — calling goes on after midnight your time.'
    : c.waitingForHours ? 'Waiting for calling hours (8am–9pm in each person’s time zone).'
      : c.waitingForLine ? 'All your lines are busy — waiting numbers are redialed as soon as one frees up.' : null);

function LiveCampaign({ c, i, onDone }) {
  const note = waitNote(c);
  return (
    <div className="civr-card p-5 sm:p-6 civr-rise" style={{ animationDelay: `${i * 60}ms` }} data-testid={`live-campaign-${i}`}>
      <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {c.status === 'running' && <span className="w-2.5 h-2.5 rounded-full bg-[#34d399] civr-live-dot" />}
            <Link to={cp(`/app/campaigns/${c.id}`)} className="font-display text-xl sm:text-2xl font-bold hover:text-[#818cf8] transition-colors break-words" data-testid={`live-campaign-${i}-name`}>{c.name || c.audioName || 'Campaign'}</Link>
            <span className={statusPill(c.status)} data-testid={`live-campaign-${i}-status`}>{c.status}</span>
            {c.repeat && <span className="civr-pill civr-pill-on"><Repeat className="w-3 h-3" />{repeatLabel(c.repeat)}</span>}
          </div>
          <div className="text-xs text-[#a1a1aa] font-mono mt-1">{`${c.stats?.completed || 0} of ${c.stats?.total || 0} called · ${pct(c)}%`}{c.dailyLimit ? ` · ${c.callsToday || 0} / ${c.dailyLimit} today` : ''}</div>
        </div>
        <CardActions c={c} i={i} onDone={onDone} />
      </div>
      <div className="mt-4 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden" role="progressbar" aria-valuenow={pct(c)} aria-valuemin={0} aria-valuemax={100} aria-label="Calls made">
        <div className={`h-full rounded-full transition-[width] duration-700 ${c.status === 'running' ? 'bg-[#6366f1]' : 'bg-[#52525b]'}`} style={{ width: `${pct(c)}%` }} />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 mt-6 items-center">
        <Pipeline p={c.live?.pipeline} testid={`live-campaign-${i}-pipeline`} />
        <RunStats c={c} testid={`live-campaign-${i}-stats`} />
      </div>
      {note && <div className="text-xs text-[#fbbf24] mt-4" data-testid={`live-campaign-${i}-note`}>{note}</div>}
    </div>
  );
}

function Upcoming({ list }) {
  if (!list.length) return <div className="text-sm text-[#a1a1aa]" data-testid="live-upcoming-empty">Nothing scheduled. Pick a start time — or repeat every day or week — when you create a campaign.</div>;
  return (
    <ul className="flex flex-col gap-2" data-testid="live-upcoming">
      {list.map((c, i) => (
        <li key={c.id}>
          <Link to={cp(`/app/campaigns/${c.id}`)} className="flex items-center gap-3 rounded-xl border border-[#1f1f1f] hover:border-[#3f3f46] px-4 py-3 transition-colors" data-testid={`live-upcoming-${i}`}>
            <CalendarClock className="w-4 h-4 text-[#818cf8] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{c.name || c.audioName || 'Campaign'}</div>
              <div className="text-xs text-[#a1a1aa]">{`${when(c.scheduledFor)} · ${c.stats?.total || 0} numbers`}{c.repeat ? ` · ${repeatLabel(c.repeat)}` : ''}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#a1a1aa] shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Live() {
  const { data, error, loading, reload } = useApi(`/campaigns/live?tz=${enc(TZ)}`);
  const { summary, refreshSummary } = useShell();
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) reload(); }, 5000); return () => clearInterval(t); }, [reload]);
  // Keep the menu's green dot in step with what this page sees.
  const running = data?.summary?.running || 0;
  useEffect(() => { if (data && (running > 0) !== ((summary?.liveCampaigns || 0) > 0)) refreshSummary(); }, [data, running, summary, refreshSummary]);
  const onDone = () => { reload(); refreshSummary(); };
  const header = (
    <PageHeader label="Calling" title="Live" sub="Every campaign that is calling right now: who is ringing, who is talking, how fast it goes and what is coming up. Updates every few seconds." testid="live-header">
      <Link to={cp('/app/campaigns/new')} className="civr-btn civr-btn-primary" data-testid="live-new-campaign-button"><Plus className="w-4 h-4" />New campaign</Link>
    </PageHeader>
  );
  if (loading && !data) return <div data-testid="live-page">{header}<SkeletonPage header={false} cards={3} rows={2} /></div>;
  if (error && !data) return <div data-testid="live-page">{header}<ErrorNote error={error} onRetry={reload} /></div>;
  const { campaigns = [], upcoming = [], feed = [] } = data || {};
  return (
    <div data-testid="live-page">
      {header}
      <Summary s={data.summary} />
      <div className="flex flex-col gap-4 mb-6">
        {campaigns.length ? campaigns.map((c, i) => <LiveCampaign key={c.id} c={c} i={i} onDone={onDone} />) : (
          <Empty icon={Radio} title="Nothing is calling right now" sub="Start a campaign and watch every call here as it rings, connects and finishes." testid="live-empty">
            <Link to={cp('/app/campaigns')} className="civr-btn civr-btn-ghost" data-testid="live-empty-campaigns-link">See campaigns</Link>
          </Empty>
        )}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="civr-card p-5 sm:p-6 lg:col-span-2 min-w-0">
          <div className="flex items-center gap-2 mb-4"><span className={`w-2 h-2 rounded-full ${running ? 'bg-[#34d399] civr-live-dot' : 'bg-[#52525b]'}`} /><span className="font-display text-xl font-bold">Latest calls</span></div>
          <CallFeed feed={feed} showCampaign testid="live-feed" empty="No calls today yet." />
        </div>
        <div className="civr-card p-5 sm:p-6 h-fit">
          <div className="font-display text-xl font-bold mb-4">Coming up</div>
          <Upcoming list={upcoming} />
        </div>
      </div>
    </div>
  );
}
