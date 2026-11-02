import React, { useState } from 'react';
import { Receipt, Printer, Loader2 } from 'lucide-react';
import { api, money } from '../../api';

const fmt = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Printable receipt in a new tab (the browser's print dialog can save it as PDF).
function printReceipt(r) {
  const w = window.open('', '_blank', 'noopener=no,width=520,height=640');
  if (!w) return;
  const row = (k, v) => `<tr><td style="padding:6px 18px 6px 0;color:#64748b">${esc(k)}</td><td style="padding:6px 0"><b>${esc(v)}</b></td></tr>`;
  w.document.write(`<!doctype html><title>CloudIVR receipt</title><body style="font-family:system-ui,sans-serif;padding:32px;color:#0f172a"><h2 style="margin:0 0 4px">CloudIVR</h2><p style="margin:0 0 24px;color:#64748b">${r.refund ? 'Refund' : 'Payment'} receipt</p><table style="border-collapse:collapse;font-size:15px">${row('Line', `${r.line}${r.phoneNumber ? ` ${r.phoneNumber}` : ''}`)}${row('For', r.kind + (r.oldNumber ? ` (was ${r.oldNumber})` : ''))}${row(r.refund ? 'Refunded' : 'Paid', `$${Number(r.amount).toFixed(2)} ${r.refund ? 'to' : 'from'} your CloudIVR wallet`)}${row('Date', fmt(r.at))}${row('Reference', r.id)}</table><script>setTimeout(()=>print(),300)</script></body>`);
  w.document.close();
}

export function Receipts({ item }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const open = list !== null;
  const toggle = async () => {
    if (open) { setList(null); return; }
    setBusy(true); setErr(null);
    try { setList((await api(`/esim/${item.id}/receipts`)).receipts); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className={open ? "basis-full w-full order-last" : ""} data-testid={`receipts-${item.id}`}>
      <button type="button" onClick={toggle} className="civr-btn civr-btn-ghost civr-btn-sm" aria-expanded={open} data-testid={`receipts-toggle-${item.id}`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}{open ? 'Hide receipts' : 'Receipts'}</button>
      {err && <p className="text-xs text-red-500 mt-1" data-testid={`receipts-error-${item.id}`}>{err}</p>}
      {open && (list.length ? (
        <ul className="mt-2 divide-y divide-[var(--c-border,#1f1f1f)] rounded-xl border border-[var(--c-border,#1f1f1f)]" data-testid={`receipts-list-${item.id}`}>
          {list.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`receipt-${item.id}-${i}`}>
              <span className="flex-1 min-w-0"><span className="font-semibold">{r.kind}</span><span className="text-[var(--c-muted,#a1a1aa)]"> · {fmt(r.at)}</span></span>
              <span className={`font-mono ${r.refund ? 'text-emerald-500' : ''}`}>{r.refund ? '+' : '−'}{money(r.amount)}</span>
              <button type="button" onClick={() => printReceipt(r)} className="w-9 h-9 grid place-items-center rounded-lg text-[var(--c-muted,#a1a1aa)] hover:text-[var(--c-accent,#818cf8)]" aria-label="Print or save receipt" data-testid={`receipt-print-${item.id}-${i}`}><Printer className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-[var(--c-muted,#a1a1aa)] mt-1" data-testid={`receipts-empty-${item.id}`}>No payments yet.</p>)}
    </div>
  );
}
