import React, { useState } from 'react';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { api } from '../../api';

const EXAMPLES = ['Clinic in Texas, insurers fax us claims', 'Law firm in London, courts send us faxes', 'Accountant in Germany, tax office faxes'];

// Fax only: Emily picks the fax country from who will fax them; one tap searches it.
export function FaxSuggest({ onPick }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const ask = async (q = text) => {
    if (q.trim().length < 8) { setErr('Tell Emily a little more — who will fax you, and where are they?'); return; }
    setBusy(true); setErr(''); setOut(null);
    try { setOut(await api('/fax-numbers/suggest', { method: 'POST', body: { text: q } })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-4 sm:p-5 mb-4" data-testid="fax-suggest">
      <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="w-4 h-4 text-[#1d6fd8]" aria-hidden="true" />Not sure which country? Ask Emily</div>
      <form className="mt-3 flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); ask(); }}>
        <input className="civr-input flex-1" maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder="Who will fax you, and where are they?" aria-label="Who will fax you" data-testid="fax-suggest-input" />
        <button className="civr-btn civr-btn-ghost" disabled={busy} data-testid="fax-suggest-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}Suggest</button>
      </form>
      {!out && !busy && <div className="mt-2 -mx-1 px-1 flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1">{EXAMPLES.map((x, i) => <button key={x} type="button" onClick={() => { setText(x); ask(x); }} className="shrink-0 whitespace-nowrap text-xs rounded-full border px-3 py-1 border-[var(--c-border)] text-[var(--c-muted)] hover:border-current" data-testid={`fax-suggest-example-${i}`}>{x}</button>)}</div>}
      {out?.country && (
        <div className="mt-3 text-sm space-y-3" data-testid="fax-suggest-result" data-country={out.country}>
          <div><span className="font-semibold">Emily suggests a {out.name} fax number.</span> <span className="text-[var(--c-muted)]">{out.reason}</span></div>
          <button type="button" onClick={() => onPick(out.country)} className="civr-btn civr-btn-primary" data-testid="fax-suggest-show">{`Show ${out.name} fax numbers`}<ArrowRight className="w-4 h-4" /></button>
        </div>
      )}
      {err && <div className="mt-3 text-sm text-[#dc2626]" role="alert" data-testid="fax-suggest-error">{err}</div>}
    </div>
  );
}
