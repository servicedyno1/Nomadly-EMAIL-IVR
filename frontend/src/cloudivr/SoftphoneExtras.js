import React, { useState } from 'react';
import { toast } from 'sonner';
import { StickyNote } from 'lucide-react';
import { api, enc } from './api';
import { Toggle } from './ui';
import { usePrivacy } from './privacy';

// "Call me first": we ring the owner's mobile from the selected CloudIVR number, then connect them on key 1.
export function CallMeFirst({ on, onChange, myPhone, setMyPhone, allowed }) {
  const pv = usePrivacy();
  return (
    <div className="rounded-xl border border-[#222] p-3 mb-3" data-testid="softphone-call-me-first">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Call me first</div>
          <div className="text-xs text-[#a1a1aa]">{allowed ? 'We ring your mobile, then connect the call' : 'Needs the Pro plan or higher on this number'}</div>
        </div>
        <Toggle checked={on && allowed} disabled={!allowed} onChange={onChange} testid="softphone-call-me-first-toggle" />
      </div>
      {on && allowed && (
        <input className={`civr-input !h-9 font-mono text-xs mt-3 ${pv.input}`} inputMode="tel" autoComplete="off" value={myPhone} onChange={e => setMyPhone(e.target.value)} placeholder="My mobile, e.g. +14155550111" aria-label="My mobile" data-testid="softphone-my-mobile-input" />
      )}
    </div>
  );
}

// Notes for the current or last call; saved to the number and matched to its call-log row.
export function CallNoteBox({ phone, peer, direction }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/numbers/${enc(phone)}/notes`, { method: 'POST', body: { text, peer: peer || undefined, direction } });
      toast.success('Note saved — you’ll find it in this number’s Logs tab');
      setText('');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 pt-3 border-t border-[#1f1f1f]" data-testid="softphone-note-box">
      <label className="flex items-center gap-1.5 text-xs font-medium text-[#d4d4d8] mb-1.5"><StickyNote className="w-3.5 h-3.5 text-[#fbbf24]" />Notes for this call</label>
      <textarea rows={2} maxLength={2000} className="civr-input text-xs" value={text} onChange={e => setText(e.target.value)} placeholder="What was this call about?" data-testid="softphone-note-input" />
      <button className="civr-btn civr-btn-ghost civr-btn-sm w-full mt-2" disabled={busy || !text.trim()} onClick={save} data-testid="softphone-note-save-button">Save note</button>
    </div>
  );
}
