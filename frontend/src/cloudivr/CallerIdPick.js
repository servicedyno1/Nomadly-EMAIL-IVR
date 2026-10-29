import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi } from './api';
import { Field } from './ui';
import { usePrivacy } from './privacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { CallerIdManager } from './pages/number/CallerIds';

// "Show as": the number people see. Empty = the CloudIVR number placing the call; otherwise one the user verified.
export function ShowAsSelect({ value, onChange, testid, compact = false }) {
  const pv = usePrivacy();
  const { data, reload } = useApi('/caller-ids');
  const [open, setOpen] = useState(false);
  const list = (data?.items || []).filter(i => i.status === 'verified').map(i => i.number);
  const onVerified = (n) => { reload(); if (n) { onChange(n); setOpen(false); } };
  const addBtn = <button type="button" className="text-[#818cf8] hover:underline inline-flex items-center gap-1 min-h-[44px]" onClick={() => setOpen(true)} data-testid={`${testid}-add-button`}><Plus className="w-3.5 h-3.5" />Add or verify a number</button>;
  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="civr !min-h-0 content-start max-w-2xl" data-testid={`${testid}-dialog`}>
        <DialogHeader>
          <DialogTitle>Your own caller IDs</DialogTitle>
          <DialogDescription>Verify a number you own with a code, or request one we review by hand. $25 each, charged only when it’s accepted. Calls are still billed from your CloudIVR number.</DialogDescription>
        </DialogHeader>
        <CallerIdManager onVerified={onVerified} />
      </DialogContent>
    </Dialog>
  );
  const select = (
    <select className={`civr-input font-mono ${compact ? '!h-9 text-xs' : ''}`} value={list.includes(value) ? value : ''} onChange={e => onChange(e.target.value)} disabled={!list.length} aria-label="Caller ID shown" data-testid={testid}>
      <option value="">Same as calling number</option>
      {list.map(n => <option key={n} value={n}>{pv.phone(n)}</option>)}
    </select>
  );
  if (compact) return (
    <div className="mb-3" data-testid={`${testid}-compact`}>
      <div className="flex items-center justify-between mb-1"><span className="text-xs text-[#a1a1aa]">Show as</span>{addBtn}</div>
      {list.length ? select : null}
      {dialog}
    </div>
  );
  return (
    <Field label="Show as (caller ID people see)" hint={list.length ? <>Calls are still billed to the calling number. {addBtn}</> : <>Verify a number you own to show it instead. {addBtn}</>}>
      {select}
      {dialog}
    </Field>
  );
}
