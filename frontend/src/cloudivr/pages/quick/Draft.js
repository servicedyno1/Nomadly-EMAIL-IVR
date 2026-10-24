import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useCivrAuth } from '../../AuthContext';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
const hasContent = (f) => !!(f?.targets?.trim() || f?.script?.text?.trim() || f?.audioId || f?.transferTo?.trim() || f?.menu?.length);

// Keeps the unsent Quick IVR setup per account in this browser and offers it back on the next visit.
export function useDraft(f) {
  const { account } = useCivrAuth();
  const key = `civr.quickDraft.${account?.id || 'me'}`;
  const [saved, setSaved] = useState(null);
  useEffect(() => { const d = read(key); setSaved(hasContent(d) ? d : null); }, [key]);
  useEffect(() => {
    if (!hasContent(f)) return;
    try { localStorage.setItem(key, JSON.stringify({ ...f, scheduleAt: '', savedAt: Date.now() })); } catch (_) { /* private mode */ }
  }, [f, key]);
  const clear = () => { try { localStorage.removeItem(key); } catch (_) { /* private mode */ } setSaved(null); };
  return { saved: hasContent(f) ? null : saved, clear };
}

export function DraftBanner({ draft, onResume }) {
  const d = draft.saved;
  if (!d) return null;
  const resume = () => { const { savedAt, ...rest } = d; onResume(rest); };
  return (
    <div className="civr-card civr-rise p-4 flex flex-wrap items-center gap-3" data-testid="quick-draft-banner">
      <div className="w-9 h-9 rounded-lg bg-[#34d399]/10 flex items-center justify-center shrink-0"><RotateCcw className="w-4 h-4 text-[#34d399]" /></div>
      <div className="flex-1 min-w-[12rem] text-sm">
        <div className="font-semibold">Resume last draft</div>
        <div className="text-[#a1a1aa]">You left a call setup here without placing it.</div>
      </div>
      <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" onClick={resume} data-testid="quick-draft-resume">Resume</button>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={draft.clear} data-testid="quick-draft-discard">Discard</button>
    </div>
  );
}
