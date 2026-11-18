import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { api } from '../../api';
import { cp } from '../../paths';

const EXAMPLES = ['I text my US customers appointment reminders', 'Online shop in the UK, order updates by text', 'I need to receive verification codes'];
const ALT = { esim: ['Get the USA eSIM instead', 'Emily suggests the USA eSIM.'], mobile: ['Get a Texting Number instead', 'Emily suggests a Texting Number.'] };

// Calls + texting: Emily picks the texting country (one tap shows its numbers), or points to the eSIM / Texting Number.
export function TextingSuggest({ items, onPick }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const ask = async (q = text) => {
    if (q.trim().length < 8) { setErr('Tell Emily a little more — who will you text, and where are they?'); return; }
    setBusy(true); setErr(''); setOut(null);
    try { setOut(await api('/texting/suggest', { method: 'POST', body: { text: q } })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const it = out && items.find(i => i.country === out.country);
  return (
    <div className="civr-card p-4 sm:p-5" data-testid="texting-suggest">
      <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="w-4 h-4 text-[#1d6fd8]" aria-hidden="true" />Not sure which country? Ask Emily</div>
      <form className="mt-3 flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); ask(); }}>
        <input className="civr-input flex-1" maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder="Who will you text, and where are they?" aria-label="Who will you text" data-testid="texting-suggest-input" />
        <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="texting-suggest-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}Suggest</button>
      </form>
      {!out && !busy && <div className="mt-2 -mx-1 px-1 flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1">{EXAMPLES.map((x, i) => <button key={x} type="button" onClick={() => { setText(x); ask(x); }} className="shrink-0 whitespace-nowrap text-xs rounded-full border px-3 py-1 border-[var(--c-border)] text-[var(--c-muted)] hover:border-current" data-testid={`texting-suggest-example-${i}`}>{x}</button>)}</div>}
      {out && (
        <div className="mt-3 text-sm space-y-3" data-testid="texting-suggest-result" data-country={out.country || ''} data-alt={out.alt || ''}>
          <div>{out.alt ? <span className="font-semibold">{ALT[out.alt][1]}</span> : it && <span className="font-semibold">Emily suggests a {it.name} number.</span>} <span className="text-[var(--c-muted)]">{out.reason}</span></div>
          <div className="flex flex-wrap gap-2">
            {out.alt && <Link to={cp('/app/esim')} className="civr-btn civr-btn-primary" data-testid="texting-suggest-alt">{ALT[out.alt][0]}<ArrowRight className="w-4 h-4" /></Link>}
            {it && <button type="button" onClick={() => { onPick(it); setTimeout(() => document.querySelector('[data-testid="texting-buy-numbers"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }} className={`civr-btn ${out.alt ? 'civr-btn-ghost' : 'civr-btn-primary'}`} data-testid="texting-suggest-show">{`Show ${it.name} numbers`}<ArrowRight className="w-4 h-4" /></button>}
          </div>
        </div>
      )}
      {err && <div className="mt-3 text-sm text-[#dc2626]" role="alert" data-testid="texting-suggest-error">{err}</div>}
    </div>
  );
}
