import React, { useEffect, useRef, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { useApi } from './api';
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
  const cur = list.some(i => i.number === value) ? value : '';
  if (!data?.enabled) return null;
  const onVerified = (n) => { reload(); if (n) { onChange(n); setOpen(false); } };
  const addBtn = <button type="button" className="text-[#818cf8] hover:underline inline-flex items-center gap-1 min-h-[44px]" onClick={() => setOpen(true)} data-testid={`${testid}-add-button`}><Plus className="w-3.5 h-3.5" />{list.length ? 'Add a caller ID' : 'Show a different caller ID'}</button>;
  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="civr !min-h-0 content-start max-w-4xl" onEscapeKeyDown={e => { if (e.target?.closest?.('[data-testid^="caller-ids-rename-input"]')) e.preventDefault(); }} data-testid={`${testid}-dialog`}>
        <DialogHeader>
          <DialogTitle>Your saved caller IDs</DialogTitle>
          <DialogDescription>Verify numbers you own with a Bird code call, name them, and pick one with a tap on any call. Only verified numbers can be shown. Calls are still billed from your VoIP number.</DialogDescription>
        </DialogHeader>
        <CallerIdManager onVerified={onVerified} />
      </DialogContent>
    </Dialog>
  );
  const chips = (
    <div role="radiogroup" aria-label="Caller ID shown" className="flex flex-wrap gap-2" data-testid={testid}>
      <Chip on={!cur} onClick={() => onChange('')} compact={compact} testid={`${testid}-own`}>Your VoIP number</Chip>
      {list.map((i, k) => <Chip key={i.number} on={cur === i.number} onClick={() => onChange(i.number)} compact={compact} testid={`${testid}-option-${k}`}>{i.label ? `${i.label} · ${pv.phone(i.number)}` : pv.phone(i.number)}</Chip>)}
    </div>
  );
  if (compact) return (
    <div className="mb-3" data-testid={`${testid}-compact`}>
      <div className="flex items-center justify-between mb-1"><span className="text-xs text-[#a1a1aa]">Show as</span>{addBtn}</div>
      {list.length ? chips : null}
      {dialog}
    </div>
  );
  return (
    <Field label="Show as (caller ID people see)" hint={<>Calls are still billed to the VoIP number you call from. {addBtn}</>}>
      {list.length ? chips : <p className="text-sm text-[#a1a1aa]" data-testid={`${testid}-empty`}>Calls show your VoIP number.</p>}
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
