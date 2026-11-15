// Printable CloudIVR invoice / receipt (the browser's print dialog can save it as PDF).
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => { const v = Number(n || 0); return `$${v > 0 && v < 0.01 ? v.toFixed(4).replace(/0+$/, '') : v.toFixed(2)}`; };
export const KIND = { invoice: 'Invoice', receipt: 'Receipt', credit_note: 'Credit note' };

export function printInvoice(inv) {
  const w = window.open('', '_blank', 'width=760,height=900');
  if (!w) return;
  const date = new Date(inv.issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const b = inv.billTo || {}, s = inv.seller || {};
  const rows = (inv.items || []).map(i => `<tr><td>${esc(i.description)}</td><td class="r">${usd(i.amount)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(KIND[inv.kind] || 'Invoice')} ${esc(inv.number)}</title><style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;margin:0;padding:48px;max-width:720px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:3px solid #4f46e5;padding-bottom:20px}
  .brand{font-size:26px;font-weight:800;letter-spacing:-.02em}.brand span{color:#4f46e5}.muted{color:#64748b;font-size:13px;line-height:1.5}
  h1{font-size:20px;margin:0;text-align:right}.meta{text-align:right}.cols{display:flex;gap:48px;margin:28px 0}
  .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:6px}
  table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;border-bottom:1px solid #e2e8f0;padding:8px 0}
  td{padding:12px 0;border-bottom:1px solid #f1f5f9}.r{text-align:right}.tot td{font-weight:700;font-size:16px;border:0;padding-top:16px}
  .stamp{display:inline-block;margin-top:24px;padding:6px 14px;border:2px solid ${inv.kind === 'credit_note' ? '#0891b2' : '#16a34a'};color:${inv.kind === 'credit_note' ? '#0891b2' : '#16a34a'};border-radius:999px;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
  .foot{margin-top:40px;font-size:12px;color:#94a3b8}@media print{body{padding:24px}}</style></head><body>
  <div class="top"><div><div class="brand">Cloud<span>IVR</span></div><div class="muted">${esc(s.site || 'cloudivr.net')}<br>${esc(s.address || '')}</div></div>
  <div class="meta"><h1>${esc(KIND[inv.kind] || 'Invoice')}</h1><div class="muted">No. <b>${esc(inv.number)}</b><br>Date ${esc(date)}</div></div></div>
  <div class="cols"><div><div class="lbl">Billed to</div><div><b>${esc(b.name || b.email || '')}</b></div><div class="muted">${b.name ? esc(b.email || '') : ''}${b.name && b.email && b.address ? '<br>' : ''}${esc(b.address || '')}${b.vat ? `<br>VAT ${esc(b.vat)}` : ''}</div></div>
  <div><div class="lbl">Payment</div><div>${esc(inv.paidWith || '')}</div><div class="muted">${esc(inv.currency || 'USD')}</div></div></div>
  <table><thead><tr><th>Description</th><th class="r">Amount</th></tr></thead><tbody>${rows}<tr class="tot"><td>${inv.kind === 'credit_note' ? 'Total refunded' : 'Total paid'}</td><td class="r">${usd(inv.total)}</td></tr></tbody></table>
  <div class="stamp">${inv.kind === 'credit_note' ? 'Refunded' : 'Paid'}</div>
  <div class="foot">Thank you for choosing CloudIVR · ${esc(s.site || 'cloudivr.net')}</div>
  <script>setTimeout(function(){print()},350)</script></body></html>`);
  w.document.close();
}
