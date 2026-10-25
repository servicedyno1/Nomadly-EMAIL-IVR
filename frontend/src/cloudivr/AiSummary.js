import React, { useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Loader2 } from 'lucide-react';
import { api, enc } from './api';
import { usePrivacy } from './privacy';
import { useShell } from './Shell';

const MOOD = { positive: ['Positive', 'civr-pill civr-pill-on'], neutral: ['Neutral', 'civr-pill'], negative: ['Negative', 'civr-pill civr-pill-bad'] };
export const summaryPrice = (l, rate) => Math.max(1, Math.ceil((Number(l.duration) || 0) / 60)) * rate;

function Done({ s, id }) {
  const pv = usePrivacy();
  const [label, cls] = MOOD[s.sentiment] || MOOD.neutral;
  return (
    <div className="mt-1.5 rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/5 p-2.5 space-y-1.5 w-full" data-testid={id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-[#a78bfa]" />
        <span className={cls} data-testid={`${id}-sentiment`}>{label}</span>
        {s.mood && <span className="civr-pill" data-testid={`${id}-mood`} dir="auto">{s.mood}</span>}
      </div>
      <p className="text-[#e4e4e7] break-words" dir="auto" data-testid={`${id}-text`}>{pv.on ? 'Summary hidden' : s.summary}</p>
      {!pv.on && s.actionItems?.length > 0 && <ul className="list-disc pl-4 text-[#a1a1aa] space-y-0.5" data-testid={`${id}-actions`}>{s.actionItems.map((a, k) => <li key={k} dir="auto">{a}</li>)}</ul>}
    </div>
  );
}

// AI summary + mood of a voicemail / recorded call, or a "Summarize" button (number logs, plan with AI summaries).
export function AiSummaryCell({ l, i, testid, phone, canRun }) {
  const { catalog } = useShell() || {};
  const [s, setS] = useState(l.aiSummary);
  const [busy, setBusy] = useState(false);
  const id = `${testid}-ai-summary-${i}`;
  if (s?.status === 'done') return <Done s={s} id={id} />;
  if (s?.status === 'working') return <p className="mt-1.5 text-[#a1a1aa] flex items-center gap-1.5" data-testid={`${id}-working`}><Loader2 className="w-3 h-3 animate-spin" />AI summary on the way…</p>;
  if (!l.canSummarize || !canRun || !phone) return null;
  const rate = catalog?.rates?.aiSummaryPerMin ?? 0.1;
  const run = async () => {
    setBusy(true);
    try { const d = await api(`/numbers/${enc(phone)}/logs/${enc(l.id)}/summarize`, { method: 'POST' }); setS(d.aiSummary); if (d.aiSummary?.status === 'done') toast.success('Summary ready'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1">
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !min-h-[32px] !text-xs" disabled={busy} onClick={run} data-testid={`${id}-button`}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-[#a78bfa]" />}{`Summarize · $${summaryPrice(l, rate).toFixed(2)}`}
      </button>
      {s?.status === 'no_funds' && <span className="text-[#fbbf24]" data-testid={`${id}-no-funds`}>Not summarised — wallet too low.</span>}
      {(s?.status === 'failed' || s?.status === 'empty') && s.detail && <span className="text-[#a1a1aa]" data-testid={`${id}-failed`}>{s.detail}</span>}
    </div>
  );
}
