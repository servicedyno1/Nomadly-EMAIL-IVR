import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { IdCard, Loader2, ShieldCheck } from 'lucide-react';
import { api, money } from '../api';

const hoursLeft = (d) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 3600000));

export function useCardCheck() {
  const [state, setState] = useState(null);
  const load = useCallback(() => api('/card-check').then(setState).catch(() => {}), []);
  const [params] = useSearchParams();
  const back = params.get('identity') === 'done';
  useEffect(() => {
    (back ? api('/compliance/identity/refresh', { method: 'POST' }).catch(() => {}) : Promise.resolve()).then(load);
  }, [back, load]);
  const open = state && ['required', 'review'].includes(state.status);
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [open, load]);
  return [state, load];
}

async function startCheck(setBusy) {
  setBusy(true);
  try {
    const r = await api('/compliance/identity', { method: 'POST', body: { returnTo: 'wallet' } });
    if (r.url) window.location.assign(r.url);
    else if (r.status === 'verified') window.location.reload();
  } catch (e) { toast.error(e.message || 'Could not start the ID check'); setBusy(false); }
}

// Shown across the app while a card top-up is held for the cardholder ID check.
export function CardCheckBanner() {
  const [s] = useCardCheck();
  const [busy, setBusy] = useState(false);
  if (!s || !['required', 'review'].includes(s.status) || !(s.heldUsd > 0)) return null;
  const review = s.status === 'review';
  return (
    <div className="mx-4 md:mx-8 mt-4 civr-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 border border-[#fbbf24]/40" data-testid="card-check-banner">
      {review ? <ShieldCheck className="w-5 h-5 text-[#fbbf24] shrink-0" /> : <IdCard className="w-5 h-5 text-[#fbbf24] shrink-0" />}
      <div className="flex-1 text-sm" data-testid="card-check-banner-text">
        {review
          ? <>Your ID was received. We are confirming it matches your card — <span className="font-mono">{money(s.heldUsd)}</span> stays on hold until then.</>
          : <><b>Verify your ID to use your card top-up.</b> <span className="font-mono">{money(s.heldUsd)}</span> is on hold. The name on your ID must match the card. Without a check{s.deadline ? <> in the next <b data-testid="card-check-hours-left">{hoursLeft(s.deadline)} h</b></> : ''}, the payment is refunded to your card.{s.attempts > 0 && <> Attempt {s.attempts} of {s.maxAttempts} did not pass — try again with a clear photo.</>}</>}
      </div>
      {!review && <button className="civr-btn civr-btn-primary shrink-0" disabled={busy} onClick={() => startCheck(setBusy)} data-testid="card-check-verify-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Verify ID</button>}
    </div>
  );
}

export const HeldNote = ({ held }) => (held > 0
  ? <div className="text-xs text-[#fbbf24] mt-2" data-testid="wallet-held-amount">+ {money(held)} on hold until your ID check</div>
  : null);
