import React, { useState } from 'react';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { api, useApi, money, when } from '../api';
import { PageHeader, Spinner, ErrorNote, Empty } from '../ui';

function Row({ s, i, onDone }) {
  const [credit, setCredit] = useState(10);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (d) => {
    setBusy(true);
    try { await api(`/admin/suggestions/${s.id}/${d}`, { method: 'POST', body: { credit: Number(credit), reply } }); toast.success(d === 'adopt' ? `Adopted · ${money(credit)} credited` : 'Declined'); onDone(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-5 space-y-3" data-testid={`admin-suggestion-${i}`}>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-[#a1a1aa]"><span className="font-mono">{s.email}</span><span>{when(s.createdAt)}</span></div>
      <div className="text-sm whitespace-pre-wrap">{s.text}</div>
      {s.status === 'new' ? <div className="flex flex-col sm:flex-row gap-2">
        <input className="civr-input sm:!w-28 font-mono" type="number" min="0" max="500" step="1" value={credit} onChange={e => setCredit(e.target.value)} aria-label="Credit in USD" data-testid={`admin-suggestion-credit-${i}`} />
        <input className="civr-input flex-1" value={reply} onChange={e => setReply(e.target.value)} placeholder="Optional note to the customer" data-testid={`admin-suggestion-reply-${i}`} />
        <button className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} onClick={() => decide('adopt')} data-testid={`admin-suggestion-adopt-${i}`}><Check className="w-4 h-4" />Adopt & credit</button>
        <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={() => decide('decline')} data-testid={`admin-suggestion-decline-${i}`}><X className="w-4 h-4" />Decline</button>
      </div> : <span className={`civr-pill ${s.status === 'adopted' ? 'civr-pill-on' : ''}`} data-testid={`admin-suggestion-status-${i}`}>{s.status}{s.status === 'adopted' ? ` · ${money(s.credit)}` : ''}</span>}
    </div>
  );
}

// Owner only (CLOUDIVR_ADMIN_EMAILS): read ideas, adopt one and give the author free wallet credit.
export default function AdminSuggestions() {
  const [status, setStatus] = useState('new');
  const { data, error, loading, reload } = useApi(`/admin/suggestions?status=${status}`);
  return (
    <div data-testid="admin-suggestions-page">
      <PageHeader label="Owner" title="Suggestions inbox" sub="Adopt an idea to send the customer free credit and a thank-you in their Inbox." testid="admin-suggestions-header" />
      <div className="flex gap-2 mb-6">{['new', 'adopted', 'declined'].map(s => <button key={s} type="button" onClick={() => setStatus(s)} className={`civr-pill cursor-pointer h-9 ${status === s ? 'civr-pill-on' : ''}`} data-testid={`admin-suggestions-filter-${s}`}>{s}</button>)}</div>
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} testid="admin-suggestions-error" />
        : !data?.suggestions?.length ? <Empty title="Nothing here" sub="New ideas from customers show up here." testid="admin-suggestions-empty" />
        : <div className="space-y-3">{data.suggestions.map((s, i) => <Row key={s.id} s={s} i={i} onDone={reload} />)}</div>}
    </div>
  );
}
