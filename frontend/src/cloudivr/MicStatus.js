import React from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { MIC_TEXT } from './mic';

// Browser phone mic line: allowed / not asked yet (button) / blocked (how to fix).
export function MicStatus({ mic }) {
  const [busy, setBusy] = React.useState(false);
  const { state } = mic;
  const ok = state === 'granted';
  const bad = ['denied', 'nomic', 'unsupported'].includes(state);
  const ask = async () => { setBusy(true); try { await mic.ask(); } finally { setBusy(false); } };
  return (
    <div className={`flex items-start gap-2 text-xs mb-3 ${ok ? 'text-[#34d399]' : bad ? 'text-[#fb7185]' : 'text-[#fbbf24]'}`} role="status" data-testid="softphone-mic-status" data-state={state}>
      {ok ? <Mic className="w-4 h-4 shrink-0" /> : <MicOff className="w-4 h-4 shrink-0" />}
      <span className="flex-1">{MIC_TEXT[state] || MIC_TEXT.unknown}</span>
      {!ok && state !== 'unsupported' && (
        <button type="button" onClick={ask} disabled={busy} className="civr-btn civr-btn-ghost civr-btn-sm shrink-0" data-testid="softphone-mic-allow-button">
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}{bad ? 'Check again' : 'Allow microphone'}
        </button>
      )}
    </div>
  );
}
