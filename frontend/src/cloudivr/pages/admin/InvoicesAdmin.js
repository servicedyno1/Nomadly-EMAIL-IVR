import React, { useState } from 'react';
import { Printer, Search } from 'lucide-react';
import { Load, fmt, dt } from './common';
import { KIND, printInvoice } from '../../invoicePrint';

// Every CloudIVR invoice, receipt and credit note (app and chat orders alike).
export default function InvoicesAdmin() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  return (
    <div className="space-y-4" data-testid="admin-invoices">
      <form className="flex gap-2 max-w-xl" onSubmit={e => { e.preventDefault(); setTerm(q.trim()); }}>
        <input className="civr-input flex-1" value={q} onChange={e => setQ(e.target.value)} placeholder="Invoice no., account ID, email, name or number" data-testid="admin-invoices-search" />
        <button type="submit" className="civr-btn civr-btn-primary civr-btn-sm" data-testid="admin-invoices-search-button"><Search className="w-4 h-4" />Search</button>
      </form>
      <Load path={`/admin/invoices${term ? `?q=${encodeURIComponent(term)}` : ''}`} testid="admin-invoices-list">{(d) => (
        <div className="civr-card divide-y divide-[var(--c-border)]">
          <div className="p-4 text-sm text-[#a1a1aa]" data-testid="admin-invoices-total">{d.total} document{d.total === 1 ? '' : 's'}{d.total > 200 ? ' · showing the latest 200' : ''}</div>
          {d.invoices.map((inv, i) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 text-sm" data-testid={`admin-invoice-row-${i}`}>
              <span className="font-mono w-40">{inv.number}</span>
              <span className="w-32 text-[#a1a1aa]">{dt(inv.issuedAt)}</span>
              <span className="flex-1 min-w-[14rem]">{inv.title || inv.items?.[0]?.description}<span className="block text-xs text-[#a1a1aa]">{inv.billTo?.name}{inv.billTo?.email ? ` · ${inv.billTo.email}` : ''} · #{inv.chatId}</span></span>
              <span className="civr-pill">{KIND[inv.kind]}</span>
              <span className="w-24 text-right tabular-nums">{fmt(inv.total)}</span>
              <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => printInvoice(inv)} aria-label={`Print ${inv.number}`} title="Print" data-testid={`admin-invoice-row-${i}-print`}><Printer className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}</Load>
    </div>
  );
}
