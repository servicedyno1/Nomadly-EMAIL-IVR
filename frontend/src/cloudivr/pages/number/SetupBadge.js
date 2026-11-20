import React, { useEffect } from 'react';
import { Clock } from 'lucide-react';

// "Setting up" progress for a new number (server sends { step, eta, note } — see js/setup-status.js).
export function SetupBadge({ setup, testid, detail = false }) {
  if (!setup) return null;
  const pill = (
    <span className="civr-pill civr-pill-warn inline-flex items-center gap-1.5" title={`${setup.step} · ${setup.eta}${setup.note ? ` — ${setup.note}` : ''}`} data-testid={`${testid}-pill`}>
      <Clock className="w-3.5 h-3.5 animate-pulse" />{`Setting up · ${setup.eta}`}
    </span>
  );
  if (!detail) return pill;
  return (
    <div className="flex flex-col gap-1.5 items-start" data-testid={testid}>
      {pill}
      <span className="text-xs text-[var(--c-muted)]" data-testid={`${testid}-step`}>{setup.step}{setup.note ? ` · ${setup.note}` : ''}</span>
    </div>
  );
}

// Refresh while something is setting up, so the badge clears on its own.
export function useSetupPoll(active, reload, ms = 30000) {
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [active, reload, ms]);
}
