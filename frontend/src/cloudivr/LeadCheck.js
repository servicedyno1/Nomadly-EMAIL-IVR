import React, { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Download, Smartphone, PhoneCall, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from './api';
import { useShell } from './Shell';

const RATE = 0.015;
const csv = (rows) => ['phone,status,line,carrier,owner name', ...rows.map(r => [r.phone, r.status, r.line || '', r.carrier || '', r.name || ''].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n');

// "Check these numbers before you call": price → pay from wallet → live progress → summary + clean-up action.
export function LeadCheck({ numbers, onClean, cleanLabel = 'Keep only live numbers', testid = 'lead-check' }) {
  const { refreshSummary } = useShell() || {};
  const list = [...new Set(String(numbers || '').split(/[\s,;]+/).map(x => x.trim()).filter(x => x.replace(/\D/g, '').length > 6))];
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setJob(null); }, [numbers]);
  useEffect(() => {
    if (!job || job.status !== 'running') return undefined;
    const t = setTimeout(() => api(`/leads/check/${job.id}`).then(j => { setJob(j); if (j.status === 'done') refreshSummary?.(); }).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [job, refreshSummary]);
  if (!list.length) return null;
  const price = (list.length * RATE).toFixed(2);
  const start = async () => {
    setBusy(true);
    try { const r = await api('/leads/check', { method: 'POST', body: { numbers: list } }); setJob({ ...r, status: 'running', done: 0 }); refreshSummary?.(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const res = job?.results || [];
  const live = res.filter(r => r.status === 'active');
  const count = (k) => live.filter(r => r.line === k).length;
  const dead = res.filter(r => r.status === 'invalid');
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(res)], { type: 'text/csv' })); a.download = 'lead-check.csv'; a.click(); };
  return (
    <div className="civr-card p-4 mt-3" data-testid={testid}>
      {!job ? (
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[#34d399]" />
          <div className="flex-1 min-w-[12rem] text-sm"><b>Check {list.length} number{list.length > 1 ? 's' : ''} before calling</b><div className="text-[#a1a1aa]">Finds dead lines, mobile vs landline, carrier and owner name · ${RATE} each · numbers we can’t check are refunded</div></div>
          <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} onClick={start} data-testid={`${testid}-start`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Check for ${price}</button>
        </div>
      ) : job.status === 'running' ? (
        <div data-testid={`${testid}-progress`}>
          <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Checking {job.done} of {job.total}…</div>
          <div className="h-1.5 rounded-full bg-[#262626] mt-2 overflow-hidden"><div className="h-full bg-[#34d399] transition-all duration-700" style={{ width: `${(job.done / job.total) * 100}%` }} /></div>
        </div>
      ) : (
        <div data-testid={`${testid}-result`}>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="civr-pill civr-pill-ok"><Smartphone className="w-3.5 h-3.5" />{count('mobile')} mobile</span>
            <span className="civr-pill"><PhoneCall className="w-3.5 h-3.5" />{count('landline')} landline</span>
            {live.length - count('mobile') - count('landline') > 0 && <span className="civr-pill">{live.length - count('mobile') - count('landline')} other live</span>}
            <span className="civr-pill civr-pill-bad"><XCircle className="w-3.5 h-3.5" />{dead.length} dead</span>
            <span className="text-[#a1a1aa] self-center">Charged ${Number(job.charge).toFixed(2)}{job.refund ? ` · $${job.refund.toFixed(2)} refunded` : ''}</span>
          </div>
          {live.some(r => r.name) && <div className="mt-3 text-xs text-[#a1a1aa]" data-testid={`${testid}-names`}>Owner names found: {live.filter(r => r.name).slice(0, 6).map(r => r.name).join(', ')}{live.filter(r => r.name).length > 6 ? '…' : ''}</div>}
          <div className="flex flex-wrap gap-2 mt-3">
            {dead.length > 0 && onClean && <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" onClick={() => onClean(res.filter(r => r.status !== 'invalid'), dead)} data-testid={`${testid}-clean`}>{cleanLabel} ({dead.length} removed)</button>}
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={download} data-testid={`${testid}-download`}><Download className="w-4 h-4" />Download results</button>
          </div>
        </div>
      )}
    </div>
  );
}
