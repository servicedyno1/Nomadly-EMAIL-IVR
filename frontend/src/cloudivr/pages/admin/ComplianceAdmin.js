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
    <div className="flex gap-2">{[['papers', 'Company papers'], ['cards', 'Card ID checks'], ['tendlc', 'US 10DLC'], ['tollfree', 'Toll-free texting']].map(([k, l]) => <button key={k} className={`civr-btn ${tab === k ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setTab(k)} data-testid={`admin-compliance-tab-${k}`}>{l}</button>)}</div>
    {tab === 'papers' ? <Papers /> : tab === 'cards' ? <CardChecks /> : tab === 'tollfree' ? <TollFreeAdmin /> : <TenDlcAdmin />}
  </div>);
}

export function CardChecks() {
  const [status, setStatus] = useState('review');
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => { setItems(null); api(`/admin/card-checks?status=${status}`).then(d => setItems(d.items)).catch(setErr); }, [status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (chatId, decision) => {
    if (decision === 'refund' && !window.confirm('Refund every held card payment of this account?')) return;
    setBusy(chatId); setErr(null);
    try { await api(`/admin/card-checks/${chatId}`, { method: 'POST', body: { decision } }); toast.success(decision === 'approve' ? 'Approved — money released' : 'Refund sent'); load(); window.dispatchEvent(new Event('civr-card-checks')); } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const LABEL = { review: 'Needs review', required: 'Waiting for ID', passed: 'Passed', refunded: 'Refunded' };
  return (
    <div className="space-y-3" data-testid="admin-card-checks">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(LABEL).map(([s, l]) => <button key={s} className={`civr-btn ${status === s ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setStatus(s)} data-testid={`admin-card-checks-filter-${s}`}>{l}</button>)}
        <button className="civr-btn civr-btn-ghost ml-auto" onClick={load} aria-label="Refresh" data-testid="admin-card-checks-refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <ErrorNote error={err} testid="admin-card-checks-error" />
      {!items ? <Spinner /> : !items.length ? <p className="text-sm text-[var(--c-muted)]" data-testid="admin-card-checks-empty">Nothing here.</p> : items.map(it => (
        <div key={it.chatId} className="civr-card p-5 space-y-2 text-sm" data-testid={`admin-card-check-row-${it.chatId}`}>
          <div className="text-xs text-[var(--c-muted)]">{it.email || '—'} · account {it.chatId}{it.deadline && it.status === 'required' ? ` · refund due ${new Date(it.deadline).toLocaleString()}` : ''}</div>
          <div>ID name: <b data-testid={`admin-card-check-idname-${it.chatId}`}>{it.identity?.name || it.idName || '—'}</b> <span className="text-[var(--c-muted)]">({it.identity?.status})</span> · Card name(s): <b data-testid={`admin-card-check-cardnames-${it.chatId}`}>{(it.cardNames || []).join(', ') || 'not given'}</b>{it.match ? <span className="text-[var(--c-muted)]"> · result: {it.match}</span> : null}</div>
          {it.reason && <div className="text-xs text-[var(--c-muted)]">{it.reason}</div>}
          {(it.deposits || []).map(d => <div key={d.ref} className="text-xs font-mono">{d.ref} · ${d.amountUsd} ({d.amount} {d.currency}) · {d.method || '?'} · {d.cardHolder || 'no card name'} · {d.held ? 'HELD' : d.refundState || 'released'}{d.refundError ? ` — ${d.refundError}` : ''}</div>)}
          {(['review', 'required'].includes(it.status) || (it.deposits || []).some(d => d.held)) && <div className="flex gap-2 pt-1">
            {['review', 'required'].includes(it.status) && <button className="civr-btn civr-btn-primary" disabled={busy === it.chatId} onClick={() => decide(it.chatId, 'approve')} data-testid={`admin-card-check-approve-${it.chatId}`}><Check className="w-4 h-4" />Approve and release</button>}
            <button className="civr-btn" disabled={busy === it.chatId} onClick={() => decide(it.chatId, 'refund')} data-testid={`admin-card-check-refund-${it.chatId}`}><X className="w-4 h-4" />Refund card</button>
          </div>}
        </div>))}
    </div>
  );
}

function TollFreeAdmin() {
  const [status, setStatus] = useState('submitted');
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => { setItems(null); api(`/admin/tollfree?status=${status}`).then(d => setItems(d.items)).catch(setErr); }, [status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (phone, decision) => {
    const note = decision === 'reject' ? window.prompt('Why is it rejected?') : '';
    if (decision === 'reject' && !note) return;
    try { const r = await api(`/admin/tollfree/${encodeURIComponent(phone)}/decision`, { method: 'POST', body: { decision, note } }); toast.success(`Status: ${r.status}`); load(); } catch (e) { setErr(e); }
  };
  return (
    <div className="space-y-3" data-testid="admin-tollfree">
      <div className="flex flex-wrap gap-2">{['submitted', 'filed', 'active', 'rejected'].map(s => <button key={s} className={`civr-btn ${status === s ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setStatus(s)} data-testid={`admin-tollfree-filter-${s}`}>{s}</button>)}</div>
      <p className="text-xs text-[var(--c-muted)]">“Approve” sends you the details on Telegram to file in the MultiTEL portal. It turns active by itself once MultiTEL shows it verified, or use “Mark active”.</p>
      <ErrorNote error={err} testid="admin-tollfree-error" />
      {!items ? <Spinner /> : !items.length ? <p className="text-sm text-[var(--c-muted)]" data-testid="admin-tollfree-empty">Nothing here.</p> : items.map(it => { const f = it.form || {}; const id = it.phone.replace(/\D/g, ''); return (
        <div key={it.phone} className="civr-card p-5 space-y-2 text-sm" data-testid={`admin-tollfree-row-${id}`}>
          <div className="text-xs text-[var(--c-muted)]">{it.email || '—'} · account {it.chatId} · <span className="font-mono">{it.phone}</span></div>
          <div className="font-semibold">{f.businessName} <span className="text-[var(--c-muted)] font-normal">· {f.website || 'no website'} · {f.city}, {f.state} {f.country}</span></div>
          <div className="text-[var(--c-muted)]">{f.contactName} · {f.email} · {f.phone}</div>
          <div><b>{f.useCase}</b> · up to {f.volume}/month: {f.description}</div>
          <div className="text-[var(--c-muted)]">“{f.sample}”</div>
          <div className="text-[var(--c-muted)]">Opt-in: {f.optIn} {f.optInUrl}</div>
          {it.note && <div className="text-xs text-[#f87171]">{it.note}</div>}
          <div className="flex gap-2">
            {it.status === 'submitted' && <button className="civr-btn civr-btn-primary" onClick={() => decide(it.phone, 'approve')} data-testid={`admin-tollfree-approve-${id}`}><Check className="w-4 h-4" />Approve and file</button>}
            {it.status !== 'active' && <button className="civr-btn" onClick={() => decide(it.phone, 'activate')} data-testid={`admin-tollfree-activate-${id}`}>Mark active</button>}
            {it.status !== 'rejected' && <button className="civr-btn" onClick={() => decide(it.phone, 'reject')} data-testid={`admin-tollfree-reject-${id}`}><X className="w-4 h-4" />Reject</button>}
          </div>
        </div>); })}
    </div>
  );
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
