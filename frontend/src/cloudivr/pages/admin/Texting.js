import React, { useState } from 'react';
import { Loader2, Upload, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api';
import { Act, Load, Pill, fmt, dt } from './common';

const ST = { admin_docs: ['Bill to collect', 'warn'], documents: ['Waiting for customer', ''], verify: ['Code check', ''], review: ['With the carrier', 'on'], active: ['Active', 'ok'], paused: ['Paused (unpaid)', 'warn'], rejected: ['Rejected', 'bad'], cancelled: ['Cancelled', ''] };
const FILTERS = [['admin_docs', 'Bill to collect'], ['review', 'With carrier'], ['documents', 'Waiting for customer'], ['active', 'Active'], ['', 'All']];

function Submit({ item, done }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { const form = new FormData(); files.forEach(f => form.append('files', f)); await api(`/admin/hosted/${item.id}/documents`, { method: 'POST', form }); toast.success('Sent to Telnyx for review'); setFiles([]); done(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`admin-hosted-submit-${item.id}`}>
      <label className="civr-btn civr-btn-ghost civr-btn-sm cursor-pointer"><Upload className="w-4 h-4" />{files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'Add bill / photos'}
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => setFiles([...e.target.files].slice(0, 6))} data-testid={`admin-hosted-files-${item.id}`} />
      </label>
      <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={!files.length || busy} onClick={send} data-testid={`admin-hosted-send-${item.id}`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Sign LOA & submit to Telnyx</button>
    </div>
  );
}

function Message({ item }) {
  const [t, setT] = useState('');
  const [open, setOpen] = useState(false);
  const send = async () => { try { await api(`/admin/hosted/${item.id}/message`, { method: 'POST', body: { text: t } }); toast.success('Message sent to the customer'); setT(''); setOpen(false); } catch (e) { toast.error(e.message); } };
  if (!open) return <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => { setT('Please reply with a photo or screenshot of your phone account (carrier app or website) showing the account holder name, service address and this number.'); setOpen(true); }} data-testid={`admin-hosted-message-${item.id}`}>Message customer</button>;
  return <div className="w-full flex flex-wrap gap-2"><textarea className="civr-input flex-1 min-w-[16rem] text-sm" rows={2} value={t} onChange={e => setT(e.target.value)} data-testid={`admin-hosted-message-text-${item.id}`} /><button type="button" className="civr-btn civr-btn-primary civr-btn-sm" onClick={send} data-testid={`admin-hosted-message-send-${item.id}`}>Send</button></div>;
}

function Row({ x, reload }) {
  const [label, tone] = ST[x.status] || [x.status, ''];
  const h = x.holder || {};
  return (
    <div className="civr-card p-4 space-y-3" data-testid={`admin-hosted-${x.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <b className="tabular-nums">{x.phoneNumber}</b><Pill tone={tone}>{label}</Pill>{x.noBill && <Pill tone="warn">No bill (+$50)</Pill>}
        <span className="text-xs text-[#a1a1aa]">{x.email || x.chatId} · paid {fmt(x.paid)} · {x.mode === 'code' ? 'with code' : 'no code'} · started {dt(x.createdAt)}</span>
      </div>
      {x.holder && <div className="text-sm text-[#d4d4d8]">Holder: <b>{h.name}</b>{h.business ? ` (${h.business})` : ''} · {[h.address, h.city, h.state, h.zip].filter(Boolean).join(', ')} · carrier {h.carrier || '—'}{h.account ? ` · acct ${h.account}` : ''}</div>}
      {x.note && <div className="text-sm text-[#fbbf24]">{x.note}</div>}
      {x.status === 'review' && <div className="text-xs text-[#a1a1aa]">Submitted {dt(x.docsAt)}{x.submittedBy ? ` by ${x.submittedBy}` : ''} · usually approved by {String(x.expectedBy || '').slice(0, 10)}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {['admin_docs', 'documents'].includes(x.status) && x.holder && <Submit item={x} done={reload} />}
        {!['active', 'cancelled', 'rejected'].includes(x.status) && <Message item={x} />}
        {['verify', 'documents', 'admin_docs', 'review'].includes(x.status) && <Act label="Reject & refund" danger path={`/admin/hosted/${x.id}/reject`} done={reload} testid={`admin-hosted-reject-${x.id}`} />}
      </div>
    </div>
  );
}

export default function Texting() {
  const [st, setSt] = useState('admin_docs');
  return (
    <div className="space-y-4" data-testid="admin-texting">
      <p className="text-sm text-[#a1a1aa]">Customers without a phone bill pay $50 extra. Collect a photo/screenshot of their carrier account (name, service address, number), upload it here and submit — we merge the files into one PDF and attach the signed authorization letter. Telnyx usually approves in 1–3 business days.</p>
      <div className="flex gap-2 flex-wrap">{FILTERS.map(([k, l]) => <button key={k || 'all'} type="button" className={`civr-btn civr-btn-sm ${st === k ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setSt(k)} data-testid={`admin-texting-filter-${k || 'all'}`}>{l}</button>)}</div>
      <Load path={`/admin/hosted?status=${st}`} testid="admin-texting-list">
        {(d, reload) => d.items.length ? <div className="space-y-3">{d.items.map(x => <Row key={x.id} x={x} reload={reload} />)}</div> : <p className="text-sm text-[#a1a1aa]" data-testid="admin-texting-empty">Nothing here.</p>}
      </Load>
    </div>
  );
}
