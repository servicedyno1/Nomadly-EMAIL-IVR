import React, { useState } from 'react';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { api } from './api';

const EXAMPLES = ['Dental clinic, 3 front-desk phones', 'I call leads from a list every day', 'Solo consultant, just need a US number'];

// "Tell Emily about your business" → she suggests the cheapest plan that fits, with a one-line reason.
// `dark` matches the in-app theme; the landing page is light. onPick(planId) selects/highlights the plan.
export function PlanSuggest({ onPick, dark = false, testid = 'plan-suggest' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const ask = async (q = text) => {
    if (q.trim().length < 8) { setErr('Tell Emily a little more — what does your business do, and how do you use the phone?'); return; }
    setBusy(true); setErr(''); setOut(null);
    try { const d = await api('/public/plan-suggest', { method: 'POST', body: { text: q } }); setOut(d); onPick?.(d.plan); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const box = dark ? 'civr-card' : 'rounded-2xl border border-slate-200 bg-white';
  const muted = dark ? 'text-[var(--c-muted)]' : 'text-slate-500';
  return (
    <div className={`${box} p-4 sm:p-5`} data-testid={testid}>
      <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="w-4 h-4 text-[#1d6fd8]" aria-hidden="true" />Not sure which plan? Ask Emily</div>
      <form className="mt-3 flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); ask(); }}>
        <input className={dark ? 'civr-input flex-1' : 'flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-900'} maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder="Describe your business in one sentence…" aria-label="Describe your business" data-testid={`${testid}-input`} />
        <button className={dark ? 'civr-btn civr-btn-primary' : 'inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-60'} disabled={busy} data-testid={`${testid}-button`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}Suggest a plan</button>
      </form>
      {!out && !busy && <div className="mt-2 flex flex-wrap gap-2">{EXAMPLES.map((x, i) => <button key={x} type="button" onClick={() => { setText(x); ask(x); }} className={`text-xs rounded-full border px-3 py-1 ${dark ? 'border-[var(--c-border)] text-[var(--c-muted)]' : 'border-slate-200 text-slate-600'} hover:border-current`} data-testid={`${testid}-example-${i}`}>{x}</button>)}</div>}
      {out && (
        <div className="mt-3 text-sm" data-testid={`${testid}-result`} data-plan={out.plan}>
          <span className="font-semibold">Emily suggests {out.name} (${out.price}/mo).</span> <span className={muted}>{out.reason}</span>
          {out.alsoLike && <div className={`text-xs mt-1 ${muted}`} data-testid={`${testid}-also`}>Later you might like: {out.alsoLike}</div>}
        </div>
      )}
      {err && <div className="mt-3 text-sm text-[#dc2626]" role="alert" data-testid={`${testid}-error`}>{err}</div>}
    </div>
  );
}
