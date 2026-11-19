import React, { useEffect, useRef, useState } from 'react';
import { Plus, Check, Loader2 } from 'lucide-react';
import { useApi, api } from './api';
import { LockedNote } from './Upgrade';
import { Field } from './ui';
import { usePrivacy } from './privacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { CallerIdManager } from './pages/number/CallerIds';

function Chip({ on, onClick, children, testid, compact }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} data-testid={testid}
      className={`inline-flex items-center gap-1 rounded-full border font-mono transition-colors ${compact ? 'px-2.5 h-8 text-xs' : 'px-3 h-9 text-sm'} ${on ? 'border-[#818cf8] bg-[#818cf8]/15 text-[#e0e7ff]' : 'border-[#3f3f46] text-[#a1a1aa] hover:border-[#71717a] hover:text-[#e4e4e7]'}`}>
      {on && <Check className="w-3.5 h-3.5" />}{children}
    </button>
  );
}

// Business plan: type any number (checked by the caller-ID guard). Other plans: a locked note that opens the upgrade pop-up.
function AnyNumber({ any, onChange, testid, phone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!any) return <LockedNote text="Show any number as caller ID" feature="Any caller ID" need="business" phone={phone} testid={`${testid}-any-locked`} />;
  const use = async () => {
    setBusy(true); setErr('');
    try { const r = await api('/caller-ids/check', { method: 'POST', body: { number: text } }); onChange(r.number); setText(''); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1" data-testid={`${testid}-any`}>
      <div className="flex gap-2">
        <input className="civr-input flex-1 font-mono" value={text} onChange={e => { setText(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) use(); } }}
          placeholder="Any number, e.g. +14155550100" inputMode="tel" aria-label="Show any number as caller ID" data-testid={`${testid}-any-input`} />
        <button type="button" className="civr-btn civr-btn-ghost" disabled={busy || !text.trim()} onClick={use} data-testid={`${testid}-any-use`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Use'}</button>
      </div>
      {err ? <p className="text-xs text-[#fb7185]" data-testid={`${testid}-any-error`}>{err}</p>
        : <p className="text-xs text-[#a1a1aa]">Business plan: any number you're allowed to use. Banks, government, hotlines and emergency numbers are blocked.</p>}
    </div>
  );
}

// "Show as": the number people see. Empty = the CloudIVR number placing the call; otherwise one tap on a saved caller ID.
export function ShowAsSelect({ value, onChange, testid, compact = false, from }) {
  const pv = usePrivacy();
  const { data, reload, stale } = useApi(`/caller-ids/presets${from ? `?from=${encodeURIComponent(from)}` : ''}`);
  // Each VoIP number starts with the caller ID it used last time; switching numbers switches to that number's own.
  const applied = useRef(null);
  useEffect(() => {
    if (!data || stale || applied.current === (from || '')) return;
    const first = applied.current === null;
    applied.current = from || '';
    if (first ? !value && data.last : (data.last || '') !== value) onChange(data.last || '');
  }, [data, stale, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const list = data?.items || [];
  const typed = value && !list.some(i => i.number === value) && data?.anyNumber ? value : '';
  const cur = list.some(i => i.number === value) ? value : typed;
  if (!data?.enabled) return null;
  const onVerified = (n) => { reload(); if (n) { onChange(n); setOpen(false); } };
  const addBtn = <button type="button" className="text-[#818cf8] hover:underline inline-flex items-center gap-1 min-h-[44px]" onClick={() => setOpen(true)} data-testid={`${testid}-add-button`}><Plus className="w-3.5 h-3.5" />{list.length ? 'Add a caller ID' : 'Show a different caller ID'}</button>;
  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="civr !min-h-0 content-start max-w-4xl" onEscapeKeyDown={e => { if (e.target?.closest?.('[data-testid^="caller-ids-rename-input"]')) e.preventDefault(); }} data-testid={`${testid}-dialog`}>
        <DialogHeader>
          <DialogTitle>Your saved caller IDs</DialogTitle>
          <DialogDescription>Verify numbers you own with a quick code call, name them, and pick one with a tap on any call. Only verified numbers can be shown. Calls are still billed from your VoIP number.</DialogDescription>
        </DialogHeader>
        <CallerIdManager onVerified={onVerified} />
      </DialogContent>
    </Dialog>
  );
  const chips = (
    <div role="radiogroup" aria-label="Caller ID shown" className="flex flex-wrap gap-2" data-testid={testid}>
      <Chip on={!cur} onClick={() => onChange('')} compact={compact} testid={`${testid}-own`}>Your VoIP number</Chip>
      {list.map((i, k) => <Chip key={i.number} on={cur === i.number} onClick={() => onChange(i.number)} compact={compact} testid={`${testid}-option-${k}`}>{i.label ? `${i.label} · ${pv.phone(i.number)}` : pv.phone(i.number)}</Chip>)}
      {typed && <Chip on onClick={() => {}} compact={compact} testid={`${testid}-typed`}>{pv.phone(typed)}</Chip>}
    </div>
  );
  if (compact) return (
    <div className="mb-3" data-testid={`${testid}-compact`}>
      <div className="flex items-center justify-between mb-1"><span className="text-xs text-[#a1a1aa]">Show as</span>{addBtn}</div>
      {list.length || typed ? chips : null}
      <AnyNumber any={data.anyNumber} onChange={onChange} testid={testid} phone={from} />
      {dialog}
    </div>
  );
  return (
    <Field label="Show as (caller ID people see)" hint={<>Calls are still billed to the VoIP number you call from. {addBtn}</>}>
      <div className="space-y-3">
        {list.length || typed ? chips : <p className="text-sm text-[#a1a1aa]" data-testid={`${testid}-empty`}>Calls show your VoIP number.</p>}
        <AnyNumber any={data.anyNumber} onChange={onChange} testid={testid} phone={from} />
      </div>
      {dialog}
    </Field>
  );
}

// Rotate one list across several caller IDs: each call in progress uses a different one (own numbers + verified caller IDs).
export function RotateCallerIds({ numbers = [], primary, value = [], onChange, testid = 'campaign-rotate' }) {
  const { data } = useApi('/caller-ids/presets');
  const own = numbers.map(n => n.phoneNumber).filter(n => n && n !== primary);
  const verified = (data?.items || []).map(i => i.number).filter(n => n && !own.includes(n) && n !== primary);
  const all = [...own.map(n => ({ n, kind: 'Your number' })), ...verified.map(n => ({ n, kind: 'Verified caller ID' }))];
  const pick = new Set(value.filter(v => all.some(a => a.n === v)));
  const toggle = (n) => { const s = new Set(pick); s.has(n) ? s.delete(n) : s.add(n); onChange([...s]); };
  if (!all.length) return null;
  return (
    <Field label="Rotate caller IDs (optional)" hint={pick.size ? `${pick.size + 1} caller IDs. Your calls at the same time are shared across them, so no single number takes all the volume.` : 'Pick more caller IDs to dial this list from several numbers at once.'}>
      <div className="flex flex-wrap gap-2" data-testid={testid}>
        {all.map(({ n, kind }) => (
          <button key={n} type="button" title={kind} onClick={() => toggle(n)} data-testid={`${testid}-${n.replace(/\D/g, '')}`}
            className={`inline-flex items-center gap-1 rounded-full border font-mono transition-colors px-3 h-9 text-sm ${pick.has(n) ? 'border-[#818cf8] bg-[#818cf8]/15 text-[#e0e7ff]' : 'border-[#3f3f46] text-[#a1a1aa] hover:border-[#71717a]'}`}>
            {pick.has(n) ? <Check size={12} /> : <Plus size={12} />}{n}{kind !== 'Your number' ? <span className="opacity-60">· verified</span> : null}
          </button>
        ))}
        {pick.size ? <button type="button" onClick={() => onChange([])} className="text-xs underline text-[#a1a1aa]" data-testid={`${testid}-clear`}>Clear</button> : null}
      </div>
    </Field>
  );
}
