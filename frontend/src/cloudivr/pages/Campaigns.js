import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Megaphone, Plus, Loader2, Calculator, FileUp, ChevronRight } from 'lucide-react';
import { api, useApi, when, money } from '../api';
import { PageHeader, Field, Spinner, Empty, AudioSelect, KeyPicker, Toggle, ErrorNote, statusPill } from '../ui';
import { useCallerNumbers } from './QuickCall';
import { DateTimePicker } from '../DateTimePicker';
import { cp } from '../paths';

export function Campaigns() {
  const { data, loading, error } = useApi('/campaigns');
  const list = data?.campaigns || [];
  return (
    <div data-testid="campaigns-page">
      <PageHeader label="Outbound" title="Bulk IVR campaigns" sub="Call a list of numbers, play your message, report key presses or transfer interested callers to you." testid="campaigns-header">
        <Link to={cp('/app/campaigns/new')} className="civr-btn civr-btn-primary" data-testid="campaigns-new-button"><Plus className="w-4 h-4" />New campaign</Link>
      </PageHeader>
      <ErrorNote error={error} />
      {loading && !data ? <Spinner /> : !list.length ? <Empty icon={Megaphone} title="No campaigns yet" sub="Paste your numbers, pick a message and go." testid="campaigns-empty" /> : (
        <div className="space-y-3">
          {list.map((c, i) => (
            <Link key={c.id} to={cp(`/app/campaigns/${c.id}`)} className="civr-card civr-card-link p-6 flex flex-col md:flex-row md:items-center gap-3" data-testid={`campaign-row-${i}`}>
              <div className="flex-1 min-w-0"><div className="font-semibold truncate">{c.audioName || 'Campaign'}</div><div className="text-xs text-[#9a9a9a] font-mono">{c.callerId} · {when(c.createdAt)}</div></div>
              <div className="font-mono text-sm text-[#aaa]">{c.stats?.completed || 0}/{c.stats?.total || 0} called</div>
              <span className={statusPill(c.status)} data-testid={`campaign-row-${i}-status`}>{c.status}</span>
              {c.dryRun && <span className="civr-pill civr-pill-warn">preview</span>}
              <ChevronRight className="w-4 h-4 text-[#8a8a8a]" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadsField({ value, onChange }) {
  const ref = useRef(null);
  const load = (e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => onChange(String(r.result || '')); r.readAsText(file); e.target.value = ''; };
  return (
    <Field label="Numbers to call" hint="One per line, with country code. Optional name after a comma: +14155550100,Jane">
      <textarea rows={7} className="civr-input font-mono text-xs" value={value} onChange={e => onChange(e.target.value)} placeholder={'+14155550100,Jane\n+14155550101'} data-testid="campaign-leads-input" />
      <input ref={ref} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={load} data-testid="campaign-leads-file-input" />
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm mt-2" onClick={() => ref.current?.click()} data-testid="campaign-leads-file-button"><FileUp className="w-4 h-4" />Load .txt / .csv</button>
    </Field>
  );
}

function Estimate({ est }) {
  if (!est) return null;
  return (
    <div className="civr-card p-4 text-sm space-y-1" data-testid="campaign-estimate">
      <div><span className="font-mono text-lg">{est.count}</span> valid numbers (max {est.max}) · about <span className="font-mono">{money(est.estimate.total)}</span> for 1 minute each</div>
      <div className="text-xs text-[#888]">{est.estimate.rateLine}. Wallet needs at least {money(est.minWallet)} to start.</div>
      {est.estimate.blockedLine && <div className="text-xs text-[#fbbf24]">{est.estimate.blockedLine.replace(/^\W+/, '')}</div>}
      {est.errors?.length > 0 && <div className="text-xs text-[#fb7185]">{est.errors.length} line(s) skipped: {est.errors.slice(0, 3).join(' · ')}</div>}
    </div>
  );
}

export function CampaignNew() {
  const nav = useNavigate();
  const { numbers, loading } = useCallerNumbers('bulkCall');
  const { data: au } = useApi('/audio');
  const [f, setF] = useState({ callerId: '', audioId: '', voicemailAudioId: '', leads: '', mode: 'report_only', transferNumber: '', activeKeys: ['1'], concurrency: 5, scheduledFor: '', holdMusic: false });
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  if (loading) return <Spinner />;
  if (!numbers.length) return <Empty icon={Megaphone} title="No number can run campaigns" sub="Bulk IVR needs an active number on the Pro plan or higher." testid="campaign-new-empty"><Link to={cp('/app/numbers')} className="civr-btn civr-btn-primary" data-testid="campaign-new-empty-action">My numbers</Link></Empty>;
  const callerId = f.callerId || numbers[0].phoneNumber;

  const estimate = async () => { setBusy('est'); try { setEst(await api('/campaigns/estimate', { method: 'POST', body: { leads: f.leads } })); } catch (e) { toast.error(e.message); } finally { setBusy(''); } };
  const create = async (e) => {
    e.preventDefault(); setBusy('create'); setError(null);
    try {
      const body = { ...f, callerId, scheduledFor: f.scheduledFor ? new Date(f.scheduledFor).toISOString() : null };
      const d = await api('/campaigns', { method: 'POST', body });
      toast.success(d.skipped ? `Campaign saved · ${d.skipped} line(s) skipped` : 'Campaign saved');
      nav(cp(`/app/campaigns/${d.campaign.id}`));
    } catch (err) { setError(err); } finally { setBusy(''); }
  };

  return (
    <div data-testid="campaign-new-page">
      <PageHeader label="Campaigns" title="New campaign" testid="campaign-new-header" />
      <form onSubmit={create} className="grid lg:grid-cols-2 gap-4">
        <div className="civr-card p-6 space-y-6">
          <Field label="Caller ID"><select className="civr-input font-mono" value={callerId} onChange={set('callerId')} data-testid="campaign-caller-select">{numbers.map(n => <option key={n.phoneNumber}>{n.phoneNumber}</option>)}</select></Field>
          <Field label="Message"><AudioSelect value={f.audioId} onChange={set('audioId')} audios={au?.audios} by="id" testid="campaign-audio-select" /></Field>
          <Field label="Voicemail drop (optional)" hint="Played when an answering machine picks up."><AudioSelect value={f.voicemailAudioId} onChange={set('voicemailAudioId')} audios={au?.audios} by="id" placeholder="None" testid="campaign-voicemail-audio-select" /></Field>
          <LeadsField value={f.leads} onChange={set('leads')} />
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={!f.leads.trim() || busy === 'est'} onClick={estimate} data-testid="campaign-estimate-button">{busy === 'est' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}Check numbers &amp; cost</button>
          <Estimate est={est} />
        </div>
        <div className="civr-card p-6 space-y-6 h-fit">
          <Field label="When someone presses a key">
            <select className="civr-input" value={f.mode} onChange={set('mode')} data-testid="campaign-mode-select"><option value="report_only">Just report it</option><option value="transfer">Transfer the call to me</option></select>
          </Field>
          {f.mode === 'transfer' && <Field label="Transfer to"><input className="civr-input font-mono" value={f.transferNumber} onChange={set('transferNumber')} placeholder="+14155550199" data-testid="campaign-transfer-input" /></Field>}
          <Field label="Keys that count"><KeyPicker value={f.activeKeys} onChange={set('activeKeys')} testid="campaign-keys" /></Field>
          <Field label="Calls at the same time"><input type="number" min={1} max={20} className="civr-input" value={f.concurrency} onChange={set('concurrency')} data-testid="campaign-concurrency-input" /></Field>
          <Field label="Schedule (optional)" hint="Leave empty to start manually."><DateTimePicker value={f.scheduledFor} onChange={set('scheduledFor')} testid="campaign-schedule" /></Field>
          {f.mode === 'transfer' && <div className="flex items-center justify-between"><span className="text-sm">Hold music during transfer</span><Toggle checked={f.holdMusic} onChange={set('holdMusic')} testid="campaign-hold-music-toggle" /></div>}
          <ErrorNote error={error} testid="campaign-create-error" />
          <button className="civr-btn civr-btn-primary w-full" disabled={busy === 'create'} data-testid="campaign-create-button">{busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />}Save campaign</button>
        </div>
      </form>
    </div>
  );
}
