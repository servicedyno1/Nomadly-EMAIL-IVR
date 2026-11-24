import React, { useState } from 'react';
import { toast } from 'sonner';
import { Upload, ListChecks, Loader2, ArrowRight } from 'lucide-react';
import { api } from '../../api';

const Stat = ({ n, label, tone = '', testid }) => (
  <div className="rounded-lg bg-[#0f0f0f] border border-[#1f1f1f] px-3 py-2" data-testid={testid}><div className={`text-lg font-semibold ${tone}`}>{Number(n || 0).toLocaleString()}</div><div className="text-xs text-[var(--c-muted)]">{label}</div></div>
);

// Step 1 — paste / upload / saved list → parsed + free line-type check (landlines skipped, still listed so nothing is hidden).
export function StepNumbers({ data, onNext }) {
  const [raw, setRaw] = useState('');
  const [saveAs, setSaveAs] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);
  const [res, setRes] = useState(null);
  const min = data.prices.minVolume;
  const check = async (extra = {}) => {
    setBusy(true); setAsk(null);
    try {
      const r = await api('/bulksms/contacts', { method: 'POST', body: { raw, ...(saveAs.trim() ? { saveAs } : {}), ...extra } });
      if (r.needPlusOne) setAsk(r); else setRes(r);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const file = async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5e6) return toast.error('That file is over 5 MB'); setRaw(await f.text()); setRes(null); toast.success(`${f.name} loaded`); };
  const n = raw.split(/[\n,;]+/).filter(x => /\d{7,}/.test(x)).length;
  if (res) return (
    <div data-testid="bulksms-numbers-result">
      <h3 className="font-semibold text-lg">{res.sendable.toLocaleString()} numbers ready to text</h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
        <Stat n={res.sendable} label="Mobiles" tone="text-[#34d399]" testid="bulksms-stat-sendable" />
        <Stat n={res.skipped} label="Landlines (skipped)" testid="bulksms-stat-skipped" />
        <Stat n={res.invalid} label="Invalid" testid="bulksms-stat-invalid" />
        <Stat n={res.duplicates} label="Duplicates" testid="bulksms-stat-duplicates" />
        <Stat n={res.optedOut} label="Opted out" testid="bulksms-stat-optedout" />
      </div>
      {res.skipped > 0 && <p className="text-xs text-[var(--c-muted)] mt-3">Landlines can't get texts, but they are still counted in the price — remove them from your list to save {Math.round(res.skipped * data.prices.plain * 100) / 100 > 0 ? `$${(res.skipped * data.prices.plain).toFixed(2)}` : 'money'}.</p>}
      {res.dropped > 0 && <p className="text-xs text-[#fbbf24] mt-2">{res.dropped.toLocaleString()} numbers over the {data.prices.maxVolume.toLocaleString()} limit were left out.</p>}
      <div className="flex gap-2 mt-6">
        <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setRes(null)} data-testid="bulksms-numbers-change">Change numbers</button>
        <button type="button" className="civr-btn civr-btn-primary" onClick={() => onNext(res)} data-testid="bulksms-numbers-next">Write the message <ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="bulksms-numbers">
      <div><h3 className="font-semibold text-lg">Who gets your text?</h3><p className="text-sm text-[var(--c-muted)]">USA & Canada mobiles, one per line or comma-separated — at least {min.toLocaleString()}.</p></div>
      {!!data.lists?.length && (
        <div className="flex flex-wrap gap-2" data-testid="bulksms-saved-lists">
          {data.lists.map(l => <button key={l.id} type="button" className="civr-btn civr-btn-sm" disabled={busy} onClick={() => check({ listId: l.id })} data-testid={`bulksms-list-${l.id}`}><ListChecks className="w-4 h-4" />{l.name || 'Saved list'} · {l.n.toLocaleString()}</button>)}
        </div>
      )}
      <textarea className="civr-input w-full min-h-[180px] font-mono text-sm" placeholder={'+1 212 555 0123\n+1 416 555 0199'} value={raw} onChange={e => setRaw(e.target.value)} data-testid="bulksms-numbers-input" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="civr-btn civr-btn-sm cursor-pointer" data-testid="bulksms-numbers-upload"><Upload className="w-4 h-4" />Upload CSV / TXT<input type="file" accept=".csv,.txt,text/plain,text/csv" className="hidden" onChange={file} /></label>
        <span className="text-[var(--c-muted)]" data-testid="bulksms-numbers-count">{n ? `${n.toLocaleString()} numbers found` : 'No numbers yet'}</span>
      </div>
      <input className="civr-input w-full sm:w-80" placeholder="Save this list as… (optional)" value={saveAs} onChange={e => setSaveAs(e.target.value)} data-testid="bulksms-numbers-saveas" />
      {ask && (
        <div className="rounded-lg border border-[#fbbf24]/40 p-4 text-sm" data-testid="bulksms-plusone">
          {ask.noCode.toLocaleString()} numbers have no country code. Are they USA / Canada numbers?
          <div className="flex gap-2 mt-3"><button type="button" className="civr-btn civr-btn-primary civr-btn-sm" onClick={() => check({ plusOne: true })} data-testid="bulksms-plusone-add">Yes, add +1</button>{ask.found > 0 && <button type="button" className="civr-btn civr-btn-sm" onClick={() => check({ skipNoCode: true })} data-testid="bulksms-plusone-skip">No, leave them out</button>}</div>
        </div>
      )}
      <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !raw.trim()} onClick={() => check()} data-testid="bulksms-numbers-check">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{busy ? 'Checking numbers…' : 'Check numbers'}</button>
    </div>
  );
}
