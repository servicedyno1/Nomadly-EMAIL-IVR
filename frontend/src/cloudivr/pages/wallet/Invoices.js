import React from 'react';
import { FileText, Printer } from 'lucide-react';
import { money, useApi } from '../../api';
import { KIND, printInvoice } from '../../invoicePrint';

const day = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const TONE = { invoice: 'civr-pill-on', receipt: '', credit_note: 'civr-pill-warn' };

// Billing → Invoices & receipts: every order, renewal, top-up and refund on the account.
export function Invoices() {
  const { data } = useApi('/billing/invoices');
  const list = data?.invoices || [];
  return (
    <section className="civr-card mt-8" data-testid="invoices">
      <div className="p-5 border-b border-[var(--c-border)]">
        <div className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" />Invoices &amp; receipts</div>
        <p className="text-sm text-[var(--c-muted)] mt-1">One for every order, renewal, top-up and refund. Open one to print it or save it as a PDF.</p>
      </div>
      {!data ? <p className="p-5 text-sm text-[var(--c-muted)]">Loading…</p> : list.length ? (
        <div className="divide-y divide-[var(--c-border)] max-h-[32rem] overflow-y-auto">
          {list.map((inv, i) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-testid={`invoice-row-${i}`}>
              <span className="flex-1 min-w-[12rem]"><span className="block text-sm">{inv.items?.[0]?.description}</span><span className="text-xs text-[var(--c-muted)] font-mono" data-testid={`invoice-row-${i}-number`}>{inv.number} · {day(inv.issuedAt)}</span></span>
              <span className={`civr-pill ${TONE[inv.kind] || ''}`}>{KIND[inv.kind]}</span>
              <span className="w-24 text-right tabular-nums font-medium" data-testid={`invoice-row-${i}-total`}>{inv.kind === 'credit_note' || inv.kind === 'receipt' ? '+' : ''}{money(inv.total)}</span>
              <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => printInvoice(inv)} data-testid={`invoice-row-${i}-print`}><Printer className="w-4 h-4" />View</button>
            </div>
          ))}
        </div>
      ) : <p className="p-5 text-sm text-[var(--c-muted)]" data-testid="invoices-empty">No invoices yet. They appear here after your first order or top-up.</p>}
    </section>
  );
}
