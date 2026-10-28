import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Loader2, Download, Smartphone, PhoneCall, XCircle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api, money } from './api';
import { useShell } from './Shell';

const csv = (rows) => ['phone,status,line,carrier,owner name', ...rows.map(r => [r.phone, r.status, r.line || '', r.carrier || '', r.name || ''].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n');
const phonesOf = (text) => String(text || '').split(/[\s,;]+/).filter(x => x.replace(/\D/g, '').length > 6);

function Summary({ job, testid }) {
  const res = job.results || [];
  const live = res.filter(r => r.status === 'active');
  const count = (k) => live.filter(r => r.line === k).length;
  const other = live.length - count('mobile') - count('landline');
  const dead = res.filter(r => r.status === 'invalid').length;
  const names = live.filter(r => r.name).map(r => r.name);
  return (
    <>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="civr-pill civr-pill-ok" data-testid={`${testid}-mobile`}><Smartphone className="w-3.5 h-3.5" />{count('mobile')} mobile</span>
        <span className="civr-pill" data-testid={`${testid}-landline`}><PhoneCall className="w-3.5 h-3.5" />{count('landline')} landline</span>
        {other > 0 && <span className="civr-pill">{other} other live</span>}
        <span className="civr-pill civr-pill-bad" data-testid={`${testid}-dead`}><XCircle className="w-3.5 h-3.5" />{dead} dead</span>
        <span className="text-[#a1a1aa] self-center" data-testid={`${testid}-charge`}>Charged {money(job.charge)}{job.refund ? ` · ${money(job.refund)} refunded` : ''}{job.cached ? ` · ${job.cached} already checked (free)` : ''}</span>
      </div>
      {names.length > 0 && <div className="mt-3 text-xs text-[#a1a1aa]" data-testid={`${testid}-names`}>Owner names found: {names.slice(0, 6).join(', ')}{names.length > 6 ? '…' : ''}</div>}
    </>
  );
}

// "Check these numbers before you call": quote → pay from wallet → live progress → summary + clean-up.
// Pass `numbers` (pasted text) or `source` ({ scope: 'contacts' } / { listId }). Numbers checked in the last 30 days are free.
export function LeadCheck({ numbers, source, onClean, cleanLabel = 'Keep only live numbers', testid = 'lead-check', className = '' }) {
  const { refreshSummary } = useShell() || {};
  const list = numbers !== undefined ? [...new Set(phonesOf(numbers))] : null;
  const body = list ? { numbers: list } : source;
  const sig = JSON.stringify(body || null);
  const [quote, setQuote] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => { setCleaned(false); }, [job?.id]);
  const fails = useRef(0);
  useEffect(() => {
    if (!body || (list && !list.length)) { setQuote(null); return undefined; }
    if (job?.status === 'done' && list && list.every(p => job.results.some(r => r.phone.replace(/\D/g, '').endsWith(p.replace(/\D/g, '').slice(-10))))) return undefined;
    let live = true;
    const t = setTimeout(() => api('/leads/quote', { method: 'POST', body }).then(q => { if (live) { setQuote(q); setJob(null); } }).catch(() => {}), 400);
    return () => { live = false; clearTimeout(t); };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!job || job.status !== 'running') return undefined;
    const t = setTimeout(() => api(`/leads/check/${job.id}`).then(j => { fails.current = 0; setJob(j); if (j.status === 'done') refreshSummary?.(); })
      .catch(() => { fails.current += 1; setJob(fails.current >= 5 ? { ...job, status: 'failed' } : { ...job }); }), 1200);
    return () => clearTimeout(t);
  }, [job, refreshSummary]);
  if (!quote?.count && !job) return null;
  const start = async (recheck = false) => {
    setBusy(true);
    try { const r = await api('/leads/check', { method: 'POST', body: { ...body, recheck } }); fails.current = 0; setJob(r.status === 'done' ? await api(`/leads/check/${r.id}`) : { ...r, done: r.cached || 0 }); refreshSummary?.(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const tail = (p) => p.replace(/\D/g, '').slice(-10);
  const inList = list ? new Set(list.map(tail)) : null;
  const res = (job?.results || []).filter(r => !inList || inList.has(tail(r.phone)));
  const dead = res.filter(r => r.status === 'invalid');
  const clean = async () => { setBusy(true); try { await onClean(res.filter(r => r.status !== 'invalid'), dead, job); setCleaned(true); } finally { setBusy(false); } };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(res)], { type: 'text/csv' })); a.download = 'lead-check.csv'; a.click(); };
  const n = quote?.count || 0;
  return (
    <div className={`civr-card p-4 mt-3 ${className}`} data-testid={testid}>
      {!job ? (
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[#34d399]" />
          <div className="flex-1 min-w-[12rem] text-sm">
            <b data-testid={`${testid}-title`}>Check {n} number{n === 1 ? '' : 's'} before calling</b>
            <div className="text-[#a1a1aa]">Finds dead lines, mobile vs landline, carrier and owner name · {money(quote.rate)} each · numbers we can’t check are refunded</div>
            {quote.cached > 0 && <div className="text-[#34d399] text-xs mt-1" data-testid={`${testid}-cached`}>{quote.cached} checked in the last 30 days — free{quote.fresh ? `, only ${quote.fresh} new to pay for` : ''}</div>}
          </div>
          <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} onClick={() => start(false)} data-testid={`${testid}-start`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{quote.fresh ? `Check for ${money(quote.price)}` : 'Show results · free'}</button>
        </div>
      ) : job.status === 'running' ? (
        <div data-testid={`${testid}-progress`}>
          <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Checking {job.done} of {job.total}…</div>
          <div className="h-1.5 rounded-full bg-[#262626] mt-2 overflow-hidden"><div className="h-full bg-[#34d399] transition-all duration-700" style={{ width: `${(job.done / job.total) * 100}%` }} /></div>
        </div>
      ) : job.status === 'failed' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid={`${testid}-failed`}>
          <span className="text-[#fbbf24] flex-1">Connection lost while checking. The check keeps running — tap Try again to see it; you won’t be charged twice.</span>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => { fails.current = 0; setJob({ ...job, status: 'running' }); }} data-testid={`${testid}-retry`}><RotateCcw className="w-4 h-4" />Try again</button>
        </div>
      ) : (
        <div data-testid={`${testid}-result`}>
          <Summary job={{ ...job, results: res }} testid={testid} />
          <div className="flex flex-wrap gap-2 mt-3">
            {dead.length > 0 && onClean && !cleaned && <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} onClick={clean} data-testid={`${testid}-clean`}>{cleanLabel} ({dead.length})</button>}
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={download} data-testid={`${testid}-download`}><Download className="w-4 h-4" />Download results</button>
            {job.cached > 0 && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={() => start(true)} data-testid={`${testid}-recheck`}><RotateCcw className="w-4 h-4" />Check all again · {money(job.total * (quote?.rate || 0.015))}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
