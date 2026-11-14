import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, Trash2, ShieldCheck, Clock, Pencil, Check, X, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { api, useApi, enc, money, day } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { usePrivacy } from '../../privacy';
import { useShell } from '../../Shell';

const split = (s) => String(s || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);

function AddForm({ price, onSent, onSaved }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fails, setFails] = useState([]);
  const n = split(text).length;
  const send = async () => {
    setBusy(true); setError(null); setFails([]);
    try {
      const d = await api('/caller-ids', { method: 'POST', body: { numbers: split(text), method: 'call' } });
      const bad = (d.results || []).filter(r => !r.ok);
      setFails(bad); setText(bad.map(r => r.number).join('\n'));
      toast.success(d.message); onSent();
    } catch (e) { setError(e); setFails(e.body?.results?.filter(r => !r.ok) || []); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3" data-testid="caller-ids-add-form">
      <Field label="Numbers you own" hint="One per line, with country code. Up to 10 at a time — each gets its own code."><textarea className="civr-input font-mono !h-24 py-2" value={text} onChange={e => setText(e.target.value)} placeholder={'+14155550100\n+14155550101'} data-testid="caller-ids-number-input" /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--c-muted)] flex-1 min-w-[200px]" data-testid="caller-ids-method-note">Bird calls each number and reads out a code. Type it in below.</span>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !n} onClick={send} data-testid="caller-ids-send-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{n > 1 ? `Send ${n} codes` : 'Send code'}</button>
      </div>
      {fails.length > 0 && <ul className="text-xs text-[#fb7185] space-y-1" data-testid="caller-ids-send-failures">{fails.map(f => <li key={f.number}><span className="font-mono">{f.number}</span>: {f.message}</li>)}</ul>}
      <ErrorNote error={fails.length ? null : error} testid="caller-ids-error" />
    </div>
  );
}

// Pro/Starter: one tap moves a number to Business for just the price gap.
function SipDefaults({ ids }) {
  const { data: nums } = useApi('/numbers');
  const { data, reload } = useApi('/caller-ids/defaults');
  const cur = Object.fromEntries((data?.items || []).map(d => [d.number, d.showAs]));
  const save = async (number, showAs) => {
    try { await api('/caller-ids/default', { method: 'PUT', body: { number, showAs: showAs || null } }); toast.success('Softphone caller ID saved'); reload(); } catch (e) { toast.error(e.message); }
  };
  const list = (nums?.numbers || []).filter(n => n.status === 'active' && n.plan === 'business');
  if (!list.length || !ids.length) return null;
  return (
    <div className="mt-6 space-y-2" data-testid="caller-ids-sip-defaults">
      <p className="text-sm font-medium">Softphone (SIP) calls show</p>
      {list.map((n, k) => (
        <div key={n.phoneNumber} className="flex items-center gap-2 text-sm">
          <span className="font-mono flex-1">{n.phoneNumber}</span>
          <select className="civr-input !w-auto !h-9 text-sm" value={cur[n.phoneNumber] || ''} onChange={e => save(n.phoneNumber, e.target.value)} aria-label={`Caller ID shown on softphone calls from ${n.phoneNumber}`} data-testid={`caller-ids-sip-default-${k}`}>
            <option value="">Its own number</option>
            {ids.map(i => <option key={i.number} value={i.number}>{i.number}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function Pending({ item, price, i, onDone }) {
  const pv = usePrivacy();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try { await api('/caller-ids/verify', { method: 'POST', body: { number: item.number, code } }); toast.success(`${item.number} verified · ${money(price)} charged`); onDone(item.number); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const press = item.method === 'dtmf';
  return (
    <div className="flex flex-wrap items-center gap-2 border border-dashed border-[var(--c-border-hover)] rounded-xl px-4 py-2" data-testid={`caller-ids-pending-${i}`}>
      <span className="font-mono flex-1 min-w-[140px]">{pv.phone(item.number)}{press && <span className="block font-sans text-xs text-[var(--c-muted)]">Answer our call and press 1</span>}</span>
      {!press && <input className="civr-input font-mono !w-28 !h-9" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} placeholder="Code" data-testid={`caller-ids-code-input-${i}`} />}
      <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || (!press && !code.trim())} onClick={verify} data-testid={`caller-ids-verify-button-${i}`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{press ? 'I pressed 1' : 'Verify'} · {money(price)}</button>
    </div>
  );
}

// One saved caller ID: drag (or arrows) to reorder, inline rename, calls in the last 30 days.
function SavedRow({ i, k, last, dragging, onDragStart, onDrop, onMove, onRemove, onSaved }) {
  const pv = usePrivacy();
  const [edit, setEdit] = useState(false);
  const [label, setLabel] = useState(i.label || '');
  const save = async () => {
    try { await api(`/caller-ids/${enc(i.number)}/label`, { method: 'PUT', body: { label } }); toast.success('Name saved'); setEdit(false); onSaved(); } catch (e) { toast.error(e.message); }
  };
  const btn = 'w-8 h-8 flex items-center justify-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--c-card-hover)] disabled:opacity-30';
  return (
    <div draggable={!edit} onDragStart={onDragStart} onDragOver={e => e.preventDefault()} onDrop={onDrop}
      className={`flex flex-wrap sm:flex-nowrap items-center gap-2 border rounded-xl px-3 py-2 transition-colors ${dragging ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10' : 'border-[var(--c-border)]'}`} data-testid={`caller-ids-item-${k}`}>
      <GripVertical className="w-4 h-4 text-[var(--c-muted)] cursor-grab shrink-0" aria-hidden />
      <BadgeCheck className="w-4 h-4 text-[var(--c-accent)] shrink-0" />
      <div className="flex-1 min-w-0">
        {edit ? (
          <div className="flex items-center gap-2">
            <input autoFocus className="civr-input !h-8 text-sm" value={label} maxLength={24} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLabel(i.label || ''); setEdit(false); } }} placeholder="Name, e.g. Office" data-testid={`caller-ids-rename-input-${k}`} />
            <button type="button" className={btn} onClick={save} aria-label="Save name" data-testid={`caller-ids-rename-save-${k}`}><Check className="w-4 h-4" /></button>
            <button type="button" className={btn} onClick={() => { setLabel(i.label || ''); setEdit(false); }} aria-label="Cancel" data-testid={`caller-ids-rename-cancel-${k}`}><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {i.label && <span className="truncate max-w-[8rem]" data-testid={`caller-ids-item-label-${k}`}>{i.label}</span>}
            <span className="font-mono text-[var(--c-muted)] truncate min-w-0">{pv.phone(i.number)}</span>
          </div>
        )}
        <div className="text-xs text-[var(--c-muted)] mt-0.5" data-testid={`caller-ids-item-usage-${k}`}>{`${i.uses30 || 0} call${i.uses30 === 1 ? '' : 's'} · 30 days · ${i.lastUsedAt ? `last ${day(i.lastUsedAt)}` : 'not used yet'}`}</div>
      </div>
      {!edit && <span className="flex items-center shrink-0 ml-auto">
        <button type="button" className={btn} disabled={k === 0} onClick={() => onMove(-1)} aria-label="Move up" data-testid={`caller-ids-up-${k}`}><ChevronUp className="w-4 h-4" /></button>
        <button type="button" className={btn} disabled={last} onClick={() => onMove(1)} aria-label="Move down" data-testid={`caller-ids-down-${k}`}><ChevronDown className="w-4 h-4" /></button>
        <button type="button" className={btn} onClick={() => setEdit(true)} aria-label="Rename" data-testid={`caller-ids-rename-${k}`}><Pencil className="w-4 h-4" /></button>
        <button type="button" className={`${btn} hover:text-[#fb7185]`} onClick={onRemove} aria-label="Remove" data-testid={`caller-ids-remove-${k}`}><Trash2 className="w-4 h-4" /></button>
      </span>}
    </div>
  );
}

// List of a user's caller IDs + the add / verify / review forms. `onVerified(number)` fires when one becomes usable.
export function CallerIdManager({ onVerified }) {
  const { data, reload } = useApi('/caller-ids');
  const pv = usePrivacy();
  const all = data?.items || [];
  const items = all.filter(i => i.status === 'verified');
  const pending = all.filter(i => i.status === 'pending');
  const review = all.filter(i => i.status === 'review');
  const price = data?.price ?? 25;
  const afterVerify = (n) => { reload(); onVerified?.(n); };
  const remove = async (n) => {
    if (!window.confirm(`Stop showing ${n}? Calls using it go back to their CloudIVR number. Verifying it again costs ${money(price)}.`)) return;
    try { await api(`/caller-ids/${enc(n)}`, { method: 'DELETE' }); toast.success('Caller ID removed'); reload(); } catch (e) { toast.error(e.message); }
  };
  const [drag, setDrag] = useState(null);
  const reorder = async (from, to) => {
    setDrag(null);
    if (from === null || from === to) return;
    const list = items.map(i => i.number); const [m] = list.splice(from, 1); list.splice(to, 0, m);
    try { await api('/caller-ids/order', { method: 'PUT', body: { numbers: list } }); toast.success('Order saved'); reload(); onVerified?.(); } catch (e) { toast.error(e.message); }
  };
  const drop = (to) => reorder(drag, to);
  const move = (k, d) => reorder(k, k + d);
  return (
    <div className="grid lg:grid-cols-2 gap-8" data-testid="caller-ids-manager">
      <div>
        <div className="space-y-2" data-testid="caller-ids-list">
          {pending.map((p, k) => <Pending key={p.number} item={p} price={price} i={k} onDone={afterVerify} />)}
          {review.map((r, k) => (
            <div key={r.number} className="flex items-center justify-between border border-[var(--c-border)] rounded-xl px-4 py-2" data-testid={`caller-ids-review-${k}`}>
              <span className="font-mono flex items-center gap-2 text-[var(--c-muted)]"><Clock className="w-4 h-4" />{pv.phone(r.number)}<span className="civr-pill civr-pill-warn">not usable · verify with a code</span></span>
              <button type="button" onClick={() => remove(r.number)} className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--c-muted)] hover:text-[#fb7185] hover:bg-[var(--c-card-hover)]" aria-label="Cancel" data-testid={`caller-ids-review-cancel-${k}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {data && !items.length && !pending.length && !review.length && <p className="text-sm text-[var(--c-muted)]" data-testid="caller-ids-empty">No verified numbers yet.</p>}
          {items.map((i, k) => <SavedRow key={i.number} i={i} k={k} last={k === items.length - 1} dragging={drag === k} onDragStart={() => setDrag(k)} onDrop={() => drop(k)} onMove={(d) => move(k, d)} onRemove={() => remove(i.number)} onSaved={() => { reload(); onVerified?.(); }} />)}
        </div>
        {data?.dryRun && <p className="text-xs text-[var(--c-muted)] mt-3">Preview mode: no code is sent — use 123456.</p>}
        <SipDefaults ids={items} />
      </div>
      <AddForm price={price} onSent={reload} onSaved={afterVerify} />
    </div>
  );
}

export function CallerIds() {
  const { hash } = useLocation();
  const { data } = useApi('/caller-ids/presets');
  useEffect(() => { if (hash === '#caller-ids') setTimeout(() => document.getElementById('caller-ids')?.scrollIntoView({ behavior: 'smooth' }), 300); }, [hash]);
  if (!data?.enabled) return null;
  return (
    <section id="caller-ids" className="civr-card p-6 mt-8 scroll-mt-24" data-testid="caller-ids-card">
      <div className="flex items-center gap-2 font-display text-xl font-bold mb-2"><ShieldCheck className="w-5 h-5 text-[var(--c-accent)]" />Your own caller IDs</div>
      <p className="text-sm text-[var(--c-muted)] mb-6 max-w-2xl">Show a number you own, such as your mobile or office line, on Quick IVR calls, Call me first, campaigns, AI agent calls, text triggers and the browser phone. Bird calls the number and reads out a code; type it in to verify ($25, charged only when the code is accepted). Only verified numbers can be shown. Calls are still billed from your CloudIVR number.</p>
      <CallerIdManager />
    </section>
  );
}
