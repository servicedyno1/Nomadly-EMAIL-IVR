import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Check, FileText, RefreshCw, X } from 'lucide-react';
import { api } from '../../api';
import { ErrorNote, Spinner } from '../../ui';
import { StatusPill } from '../../compliance/Compliance';
import { IS_CIVR_DOMAIN } from '../../paths';

const API_ROOT = IS_CIVR_DOMAIN ? '' : (process.env.REACT_APP_BACKEND_URL || '');

// Opens a private company document in a new tab (admin session cookie, no public link).
async function openFile(chatId, id) {
  const r = await fetch(`${API_ROOT}/api/cloudivr-web/admin/compliance/${chatId}/file/${id}`, { credentials: 'include' });
  if (!r.ok) return toast.error('Could not open the file');
  window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
}

export default function ComplianceAdmin() {
  const [tab, setTab] = useState('papers');
  return (<div className="space-y-4">
    <div className="flex gap-2">{[['papers', 'Company papers'], ['tendlc', 'US 10DLC']].map(([k, l]) => <button key={k} className={`civr-btn ${tab === k ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setTab(k)} data-testid={`admin-compliance-tab-${k}`}>{l}</button>)}</div>
    {tab === 'papers' ? <Papers /> : <TenDlcAdmin />}
  </div>);
}

function TenDlcAdmin() {
  const [status, setStatus] = useState('submitted');
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => { setItems(null); api(`/admin/tendlc?status=${status}`).then(d => setItems(d.items)).catch(setErr); }, [status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (chatId, decision) => {
    const note = decision === 'reject' ? window.prompt('Why is it rejected?') : '';
    if (decision === 'reject' && !note) return;
    try { const r = await api(`/admin/tendlc/${chatId}/decision`, { method: 'POST', body: { decision, note } }); toast.success(`Status: ${r.status}`); load(); } catch (e) { setErr(e); }
  };
  return (
    <div className="space-y-3" data-testid="admin-tendlc">
      <div className="flex flex-wrap gap-2">{['submitted', 'filed', 'failed', 'active', 'rejected'].map(s => <button key={s} className={`civr-btn ${status === s ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setStatus(s)} data-testid={`admin-tendlc-filter-${s}`}>{s}</button>)}</div>
      <ErrorNote error={err} testid="admin-tendlc-error" />
      {!items ? <Spinner /> : !items.length ? <p className="text-sm text-[var(--c-muted)]" data-testid="admin-tendlc-empty">Nothing here.</p> : items.map(it => (
        <div key={it.chatId} className="civr-card p-5 space-y-2 text-sm" data-testid={`admin-tendlc-row-${it.chatId}`}>
          <div className="text-xs text-[var(--c-muted)]">{it.email || '—'} · account {it.chatId} · numbers: {(it.usNumbers || []).map(n => `${n.phoneNumber} (${n.provider})`).join(', ') || 'none yet'}</div>
          <div className="font-semibold">{it.brand?.companyName || `${it.brand?.firstName} ${it.brand?.lastName}`} <span className="text-[var(--c-muted)] font-normal">· {it.brand?.entityType} · EIN {it.brand?.ein || '—'} · {it.brand?.city}, {it.brand?.state}</span></div>
          <div><b>{it.campaign?.useCase}</b>: {it.campaign?.description}</div>
          <div className="text-[var(--c-muted)]">“{it.campaign?.sample1}” / “{it.campaign?.sample2}”</div>
          <div className="text-[var(--c-muted)]">Opt-in: {it.campaign?.messageFlow}</div>
          {it.filings.map((f, i) => <div key={i} className="text-xs">{f.provider}: {f.status}{f.error ? ` — ${f.error}` : ''}</div>)}
          <div className="flex gap-2">
            {['submitted', 'failed'].includes(it.status) && <button className="civr-btn civr-btn-primary" onClick={() => decide(it.chatId, 'approve')} data-testid={`admin-tendlc-approve-${it.chatId}`}><Check className="w-4 h-4" />Approve and file</button>}
            {it.status !== 'active' && <button className="civr-btn" onClick={() => decide(it.chatId, 'activate')} data-testid={`admin-tendlc-activate-${it.chatId}`}>Mark active</button>}
            {it.status !== 'rejected' && <button className="civr-btn" onClick={() => decide(it.chatId, 'reject')} data-testid={`admin-tendlc-reject-${it.chatId}`}><X className="w-4 h-4" />Reject</button>}
          </div>
        </div>))}
    </div>
  );
}

function Papers() {
  const [status, setStatus] = useState('submitted');
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => { setItems(null); api(`/admin/compliance?status=${status}`).then(d => setItems(d.items)).catch(setErr); }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4" data-testid="admin-compliance">
      <div className="flex flex-wrap items-center gap-2">
        {['submitted', 'approved', 'rejected'].map(s => <button key={s} className={`civr-btn ${status === s ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setStatus(s)} data-testid={`admin-compliance-filter-${s}`}>{s === 'submitted' ? 'Waiting for review' : s[0].toUpperCase() + s.slice(1)}</button>)}
        <button className="civr-btn civr-btn-ghost ml-auto" onClick={load} aria-label="Refresh" data-testid="admin-compliance-refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <ErrorNote error={err} testid="admin-compliance-error" />
      {!items ? <Spinner /> : !items.length ? <p className="text-sm text-[var(--c-muted)]" data-testid="admin-compliance-empty">Nothing here.</p>
        : items.map(it => <Row key={it.chatId} it={it} onDone={load} />)}
    </div>
  );
}

function Row({ it, onDone }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const decide = async (decision) => {
    setErr(null);
    try { await api(`/admin/compliance/${it.chatId}/company`, { method: 'POST', body: { decision, note } }); toast.success(decision === 'approve' ? 'Approved' : 'Rejected'); onDone(); } catch (e) { setErr(e); }
  };
  return (
    <div className="civr-card p-5 space-y-3" data-testid={`admin-compliance-row-${it.chatId}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Building2 className="w-5 h-5 text-[#818cf8]" />
        <div className="font-semibold">{it.business || 'Business'}</div>
        <span className="text-sm text-[var(--c-muted)]">{it.email} · {it.country || '—'}{it.registrationNumber ? ` · Reg. ${it.registrationNumber}` : ''}</span>
        <span className="ml-auto flex gap-2 items-center text-xs">ID <StatusPill status={it.identity.status} testid={`admin-compliance-id-${it.chatId}`} /> Papers <StatusPill status={it.company.status} testid={`admin-compliance-papers-${it.chatId}`} /></span>
      </div>
      <div className="flex flex-wrap gap-2">
        {it.company.files.map(f => <button key={f.id} className="civr-btn civr-btn-ghost text-sm" onClick={() => openFile(it.chatId, f.id)} data-testid={`admin-compliance-file-${f.id}`}><FileText className="w-4 h-4" />{f.kind === 'address' ? 'Address proof' : 'Registration'}: {f.name}</button>)}
      </div>
      {it.company.status === 'rejected' && it.company.note && <p className="text-xs text-[#f87171]">Reason: {it.company.note}</p>}
      {it.company.status === 'submitted' && <div className="flex flex-wrap gap-2 items-center">
        <input className="civr-input flex-1 min-w-[200px]" placeholder="Reason (needed to reject)" value={note} onChange={e => setNote(e.target.value)} data-testid={`admin-compliance-note-${it.chatId}`} />
        <button className="civr-btn civr-btn-primary" onClick={() => decide('approve')} data-testid={`admin-compliance-approve-${it.chatId}`}><Check className="w-4 h-4" />Approve</button>
        <button className="civr-btn" onClick={() => decide('reject')} data-testid={`admin-compliance-reject-${it.chatId}`}><X className="w-4 h-4" />Reject</button>
      </div>}
      <ErrorNote error={err} testid={`admin-compliance-row-error-${it.chatId}`} />
    </div>
  );
}
