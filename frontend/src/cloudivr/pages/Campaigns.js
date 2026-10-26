import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Megaphone, Plus, Loader2, Calculator, FileUp, ChevronRight, Pause, Play, Contact } from 'lucide-react';
import { api, useApi, when, money } from '../api';
import { PageHeader, Field, SkeletonRows, SkeletonPage, Empty, AudioSelect, KeyPicker, Toggle, ErrorNote, statusPill, BackupsField } from '../ui';
import { useCallerNumbers } from './QuickCall';
import { DateTimePicker } from '../DateTimePicker';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { MenuBuilder, menuToApi } from './quick/MenuBuilder';
import { ScriptBox } from './quick/ScriptBox';
import { CampaignKind, AiCampaignFields } from './ai/AiCampaignFields';
import { useSearch, SearchBox, NoMatches } from '../search';
import { useUnsaved, UnsavedPill } from '../guard';
import { TrialLink } from './dashboard/Banners';
import { useShell } from '../Shell';
import { showUpgrade } from '../Upgrade';
import { planFor } from '../PlanFeatures';

const pct = (c) => (c.stats?.total ? Math.round(((c.stats.completed || 0) / c.stats.total) * 100) : 0);

// Pause / Resume right on the row (Cancel stays on the detail page — it needs a confirmation).
function RowAction({ c, i, onChange }) {
  const [busy, setBusy] = useState(false);
  const action = c.status === 'running' ? 'pause' : c.status === 'paused' ? 'resume' : null;
  if (!action) return null;
  const run = async (e) => {
    e.preventDefault(); e.stopPropagation(); setBusy(true);
    try {
      const d = await api(`/campaigns/${c.id}/${action}`, { method: 'POST' });
      if (d.dryRun) toast.message(d.message); else toast.success(action === 'pause' ? 'Campaign paused' : 'Campaign resumed');
      if (d.campaign) onChange(d.campaign);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const Icon = action === 'pause' ? Pause : Play;
  return <button type="button" className={`civr-btn civr-btn-sm relative z-10 ${action === 'resume' ? 'civr-btn-primary' : 'civr-btn-ghost'}`} disabled={busy} onClick={run} data-testid={`campaign-row-${i}-${action}`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}{action === 'pause' ? 'Pause' : 'Resume'}</button>;
}

function CampaignRow({ c, i, pv, onChange }) {
  const live = ['running', 'paused', 'scheduled', 'created'].includes(c.status);
  return (
    <div className="civr-card civr-card-link relative p-4 sm:p-6" data-testid={`campaign-row-${i}`}>
      <Link to={cp(`/app/campaigns/${c.id}`)} className="absolute inset-0 rounded-[14px]" aria-label={`Open campaign ${c.name || c.audioName || ''}`} data-testid={`campaign-row-${i}-link`} />
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0"><div className="font-semibold truncate" data-testid={`campaign-row-${i}-name`}>{c.name || c.audioName || 'Campaign'}</div><div className="text-xs text-[#a1a1aa] font-mono">{pv.phone(c.callerId)} · {when(c.createdAt)}</div></div>
        <div className="font-mono text-sm text-[#d4d4d8]" data-testid={`campaign-row-${i}-progress-text`}>{c.stats?.completed || 0}/{c.stats?.total || 0} called</div>
        <span className={statusPill(c.status)} data-testid={`campaign-row-${i}-status`}>{c.status}</span>
        {c.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}
        <RowAction c={c} i={i} onChange={onChange} />
        <ChevronRight className="w-4 h-4 text-[#a1a1aa] hidden md:block" />
      </div>
      {live && (
        <div className="mt-4 h-1.5 rounded-full bg-[#262626] overflow-hidden" role="progressbar" aria-valuenow={pct(c)} aria-valuemin={0} aria-valuemax={100} aria-label="Calls made" data-testid={`campaign-row-${i}-progress`}>
          <div className={`h-full rounded-full transition-[width] duration-700 ${c.status === 'running' ? 'bg-[#6366f1]' : 'bg-[#52525b]'}`} style={{ width: `${pct(c)}%` }} />
        </div>
      )}
    </div>
  );
}

export function Campaigns() {
  const { data, loading, error, reload, setData } = useApi('/campaigns');
  const pv = usePrivacy();
  const list = data?.campaigns || [];
  const s = useSearch(list, c => [c.name || '', c.audioName || 'Campaign', c.callerId, c.status, c.mode === 'ai' ? 'AI voice agent' : '']);
  const onChange = (c) => setData(x => ({ ...x, campaigns: (x?.campaigns || []).map(k => (k.id === c.id ? c : k)) }));
  // Live numbers while something is dialing.
  const running = list.some(c => c.status === 'running');
  useEffect(() => { if (!running) return undefined; const t = setInterval(reload, 8000); return () => clearInterval(t); }, [running, reload]);
  return (
    <div data-testid="campaigns-page">
      <PageHeader label="Outbound" title="Bulk IVR campaigns" sub="Automated calls to a whole list: play your message, see who answered and what they pressed, and connect interested people to you." testid="campaigns-header">
        <Link to={cp('/app/campaigns/new')} className="civr-btn civr-btn-primary" data-testid="campaigns-new-button"><Plus className="w-4 h-4" />New campaign</Link>
      </PageHeader>
      <ErrorNote error={error} onRetry={reload} className="mb-4" />
      {error && !data ? null : loading && !data ? <SkeletonRows rows={3} /> : !list.length ? (
        <Empty icon={Megaphone} title="No campaigns yet" sub="Paste your numbers, pick a message and go. You see every answer and key press live." testid="campaigns-empty">
          <Link to={cp('/app/campaigns/new')} className="civr-btn civr-btn-primary" data-testid="campaigns-empty-create-button"><Plus className="w-4 h-4" />Create your first campaign</Link>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <SearchBox s={s} placeholder="Search campaigns" testid="campaigns-search" className="max-w-md" />
          <NoMatches s={s} testid="campaigns-no-matches" />
          {s.list.map((c, i) => <CampaignRow key={c.id} c={c} i={i} pv={pv} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}

const SourcePill = ({ on, onClick, children, testid }) => <button type="button" onClick={onClick} aria-pressed={on} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-9 ${on ? 'civr-pill-on' : ''}`} data-testid={testid}>{children}</button>;

// Excel / CSV / TXT → "number,name" lines; the server finds the phone and name columns.
function LoadFile({ onChange }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    setBusy(true); setNote('');
    try {
      const form = new FormData(); form.append('file', file);
      const d = await api('/contacts/leads-file', { method: 'POST', form });
      if (!d.count) { toast.error(d.errors[0] || 'No phone numbers found in that file.'); return; }
      onChange(d.text);
      const cols = d.columns?.phone ? ` · phone from “${d.columns.phone}”${d.columns.name ? `, names from “${d.columns.name}”` : ''}` : '';
      setNote(`${d.count} numbers loaded${cols}${d.errors.length === 1 ? ' · 1 row without a valid number skipped' : d.errors.length ? ` · ${d.errors.length} rows without a valid number skipped` : ''}`);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2">
      <input ref={ref} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/plain,text/csv" className="hidden" onChange={load} data-testid="campaign-leads-file-input" />
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={() => ref.current?.click()} data-testid="campaign-leads-file-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}Load Excel / CSV / TXT</button>
      {note && <div className="text-xs text-[#a5b4fc] mt-2" data-testid="campaign-leads-file-note">{note}</div>}
    </div>
  );
}

function SavedList({ value, onChange }) {
  const { data, loading } = useApi('/contacts/lists');
  const lists = (data?.lists || []).filter(l => l.count > 0);
  if (loading && !data) return <div className="text-sm text-[#a1a1aa]">Loading your lists…</div>;
  if (!lists.length) return <div className="rounded-xl border border-[#262626] p-4 text-sm text-[#a1a1aa]" data-testid="campaign-no-lists">No saved contact lists yet. <Link to={cp('/app/contacts')} className="text-[#818cf8]" data-testid="campaign-contacts-link">Upload contacts</Link> to call a saved list.</div>;
  const cur = lists.find(l => l.id === value);
  return (
    <Field label="Contact list" hint={cur && cur.count > 500 ? 'Campaigns can call up to 500 numbers — split this list first.' : 'Everyone in the list is called.'}>
      <select className="civr-input" value={value} onChange={e => onChange(e.target.value)} data-testid="campaign-list-select">
        <option value="">Pick a list…</option>
        {lists.map(l => <option key={l.id} value={l.id}>{`${l.name} · ${l.count} contacts`}</option>)}
      </select>
    </Field>
  );
}

function LeadsField({ value, onChange, source, onSource, listId, onList }) {
  return (
    <div className="space-y-3">
      <div className="text-[13px] font-medium text-[#d4d4d8]">Who to call</div>
      <div className="flex flex-wrap gap-2">
        <SourcePill on={source !== 'list'} onClick={() => onSource('numbers')} testid="campaign-source-numbers">Type or upload numbers</SourcePill>
        <SourcePill on={source === 'list'} onClick={() => onSource('list')} testid="campaign-source-list"><Contact className="w-3.5 h-3.5" />Saved contact list</SourcePill>
      </div>
      {source === 'list' ? <SavedList value={listId} onChange={onList} /> : (
        <div>
          <Field label="Numbers to call" hint="One per line, with country code. Optional name after a comma: +14155550100,Jane. Or load an Excel (.xlsx), .csv or .txt file — we find the phone and name columns.">
            <textarea rows={7} className="civr-input font-mono text-xs" value={value} onChange={e => onChange(e.target.value)} placeholder={'+14155550100,Jane\n+14155550101'} data-testid="campaign-leads-input" />
          </Field>
          <LoadFile onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function Estimate({ est }) {
  if (!est) return null;
  return (
    <div className="civr-card p-4 text-sm space-y-1" data-testid="campaign-estimate">
      <div><span className="font-mono text-lg">{est.count}</span> valid numbers (max {est.max}) · about <span className="font-mono">{money(est.estimate.total)}</span> for 1 minute each</div>
      <div className="text-xs text-[#a1a1aa]">{est.estimate.rateLine}. Wallet needs at least {money(est.minWallet)} to start.</div>
      {est.estimate.blockedLine && <div className="text-xs text-[#fbbf24]">{est.estimate.blockedLine.replace(/^\W+/, '')}</div>}
      {est.errors?.length > 0 && <div className="text-xs text-[#fb7185]">{est.errors.length} line(s) skipped: {est.errors.slice(0, 3).join(' · ')}</div>}
    </div>
  );
}

export function CampaignNew() {
  const nav = useNavigate();
  const [kind, setKind] = useState('audio');
  const { numbers, all, loading } = useCallerNumbers(kind === 'ai' ? 'aiAgent' : 'bulkCall');
  const { catalog } = useShell();
  const aiLocked = !all.some(n => n.status === 'active' && n.access?.aiAgent);
  const { data: au, reload: reloadAudio } = useApi('/audio');
  const [params] = useSearchParams();
  // Contacts → "Start a campaign" opens this page with ?list=<id>.
  const [f, setF] = useState(() => ({ name: '', callerId: '', audioId: '', voicemailAudioId: '', leads: '', source: params.get('list') ? 'list' : 'numbers', listId: params.get('list') || '', mode: 'report_only', transferNumber: '', transferBackups: '', activeKeys: ['1'], menu: [], concurrency: 5, scheduledFor: '', holdMusic: false, agentId: '' }));
  const [script, setScript] = useState(null);
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const u = useUnsaved({ f, kind, script });
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  if (loading) return <SkeletonPage cards={2} rows={0} />;
  if (!numbers.length) return (
    <div data-testid="campaign-new-page">
      <PageHeader label="Campaigns" title="New campaign" testid="campaign-new-header" />
      <CampaignKind value={kind} onChange={setKind} aiLocked={aiLocked} />
      <Empty icon={Megaphone} title={kind === 'ai' ? 'No number can run AI voice agent campaigns' : 'No number can run campaigns'} sub={kind === 'ai' ? 'AI voice agent campaigns need an active number on the Business plan.' : 'Bulk IVR needs an active number on the Pro plan or higher.'} testid="campaign-new-empty">
        {all.length ? <button type="button" onClick={() => showUpgrade({ feature: kind === 'ai' ? 'AI voice agent campaigns' : 'Bulk IVR campaigns', need: planFor(catalog?.plans, kind === 'ai' ? 'aiAgent' : 'bulkCall')?.id || 'business' })} className="civr-btn civr-btn-primary" data-testid="campaign-new-empty-action">See what you get</button>
          : <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="campaign-new-empty-action">Buy a number</Link>}
        {kind !== 'ai' && <TrialLink testid="campaign-new-trial-link" />}
      </Empty>
    </div>
  );
  const callerId = numbers.some(n => n.phoneNumber === f.callerId) ? f.callerId : numbers[0].phoneNumber;
  const isAi = kind === 'ai';

  const fromList = f.source === 'list';
  const audience = fromList ? { listId: f.listId, leads: '' } : { listId: undefined, leads: f.leads };
  const estimate = async () => { setBusy('est'); try { setEst(await api('/campaigns/estimate', { method: 'POST', body: audience })); } catch (e) { toast.error(e.message); } finally { setBusy(''); } };
  const create = async (e) => {
    e.preventDefault(); setBusy('create'); setError(null);
    try {
      const scheduledFor = f.scheduledFor ? new Date(f.scheduledFor).toISOString() : null;
      const body = isAi ? { mode: 'ai', name: f.name, agentId: f.agentId, callerId, ...audience, concurrency: f.concurrency, scheduledFor }
        : { ...f, ...audience, source: undefined, callerId, menu: f.mode === 'menu' ? menuToApi(f.menu) : undefined, scheduledFor };
      const d = await api('/campaigns', { method: 'POST', body });
      toast.success(d.skipped ? `Campaign saved · ${d.skipped} line(s) skipped` : 'Campaign saved');
      if (d.doNotCall) toast.message(`${d.doNotCall} number(s) are on your do-not-call list and will be skipped`);
      u.reset();
      nav(cp(`/app/campaigns/${d.campaign.id}`));
    } catch (err) { setError(err); } finally { setBusy(''); }
  };

  return (
    <div data-testid="campaign-new-page">
      <PageHeader label="Campaigns" title="New campaign" testid="campaign-new-header" />
      <CampaignKind value={kind} onChange={setKind} aiLocked={aiLocked} />
      <form onSubmit={create} className="grid lg:grid-cols-2 gap-4" {...u.bind}>
        <div className="civr-card p-6 space-y-6">
          <Field label="Campaign name (optional)" hint="Shown in your campaign list and reports. Leave empty to use the message name."><input className="civr-input" maxLength={80} value={f.name} onChange={set('name')} placeholder="e.g. June follow-ups" data-testid="campaign-name-input" /></Field>
          <Field label="Caller ID"><select className="civr-input font-mono" value={callerId} onChange={set('callerId')} data-testid="campaign-caller-select">{numbers.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{n.phoneNumber}</option>)}</select></Field>
          {isAi ? <AiCampaignFields agentId={f.agentId} onChange={set('agentId')} /> : <>
          <Field label="Message"><AudioSelect value={f.audioId} onChange={set('audioId')} audios={au?.audios} by="id" testid="campaign-audio-select" /></Field>
          {script ? <div className="border border-[#262626] rounded-xl p-4"><ScriptBox value={script} onChange={setScript} onAudio={(a) => { reloadAudio(); setF(x => ({ ...x, audioId: a.id })); setScript(null); }} testid="campaign-script" /></div>
            : <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setScript({ text: '', values: {} })} data-testid="campaign-write-script-button">Write a script with a template instead</button>}
          <Field label="Voicemail drop (optional)" hint="Played when an answering machine picks up. With a voicemail drop, calls end after 1 minute unless the person is connected to you."><AudioSelect value={f.voicemailAudioId} onChange={set('voicemailAudioId')} audios={au?.audios} by="id" placeholder="None" testid="campaign-voicemail-audio-select" /></Field>
          </>}
          <LeadsField value={f.leads} onChange={(v) => { set('leads')(v); setEst(null); }} source={f.source} onSource={(v) => { setF(x => ({ ...x, source: v })); setEst(null); }} listId={f.listId} onList={(v) => { setF(x => ({ ...x, listId: v })); setEst(null); }} />
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={(fromList ? !f.listId : !f.leads.trim()) || busy === 'est'} onClick={estimate} data-testid="campaign-estimate-button">{busy === 'est' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}Check numbers &amp; cost</button>
          <Estimate est={est} />
        </div>
        <div className="civr-card p-6 space-y-6 h-fit">
          {!isAi && <>
          <Field label="When someone presses a key">
            <select className="civr-input" value={f.mode} onChange={set('mode')} data-testid="campaign-mode-select"><option value="report_only">Just report it</option><option value="transfer">Transfer the call to me</option><option value="menu">Route each key (menu)</option></select>
          </Field>
          {f.mode === 'transfer' && <Field label="Transfer to"><input className="civr-input font-mono" value={f.transferNumber} onChange={set('transferNumber')} placeholder="+14155550199" data-testid="campaign-transfer-input" /></Field>}
          {f.mode === 'transfer' && <BackupsField value={f.transferBackups} onChange={set('transferBackups')} testid="campaign-backups-input" />}
          {f.mode === 'menu' ? <MenuBuilder value={f.menu} onChange={set('menu')} testid="campaign-menu" /> : <Field label="Keys that count"><KeyPicker value={f.activeKeys} onChange={set('activeKeys')} testid="campaign-keys" /></Field>}
          </>}
          <Field label="Calls at the same time"><input type="number" min={1} max={20} className="civr-input" value={f.concurrency} onChange={set('concurrency')} data-testid="campaign-concurrency-input" /></Field>
          <Field label="Schedule (optional)" hint="Leave empty to start manually."><DateTimePicker value={f.scheduledFor} onChange={set('scheduledFor')} testid="campaign-schedule" /></Field>
          {!isAi && f.mode !== 'report_only' && <div className="flex items-center justify-between"><span className="text-sm">Hold music during transfer</span><Toggle checked={f.holdMusic} onChange={set('holdMusic')} testid="campaign-hold-music-toggle" /></div>}
          <ErrorNote error={error} testid="campaign-create-error" />
          <button className="civr-btn civr-btn-primary w-full" disabled={busy === 'create'} data-testid="campaign-create-button">{busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />}Save campaign</button>
          <UnsavedPill show={u.dirty} testid="campaign-unsaved-pill" />
        </div>
      </form>
    </div>
  );
}
