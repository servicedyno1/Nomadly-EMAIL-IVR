import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageSquare, Loader2 } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { ask } from '../../confirm';
import { cp } from '../../paths';
import { WalletPay, RenewWarning } from '../../WalletPay';

const STATUS = { provisioning: 'Assigning your number…', active: 'Active', suspended: 'Paused · monthly fee due', failed: 'Couldn’t be set up · refunded' };

function MobileLine({ item, reload }) {
  const [busy, setBusy] = useState(false);
  const act = async (path, body, msg) => { setBusy(true); try { await api(`/esim/${item.id}/${path}`, { method: 'POST', body }); toast.success(msg); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const cancel = async () => { if (await ask(`Cancel ${item.phoneNumber}? It stops sending and receiving texts and can’t be recovered.`, { danger: true, ok: 'Cancel number', cancel: 'Keep it', title: 'Cancel this number?' })) act('cancel', {}, 'Cancelled'); };
  const date = String(item.nextBillAt || '').slice(0, 10);
  return (
    <div className="civr-card p-5 space-y-3" data-testid={`mobile-line-${item.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-lg" data-no-translate data-testid={`mobile-line-number-${item.id}`}>{item.phoneNumber || 'Number coming'}</span>
        <span className="civr-pill">US mobile · texting</span>
        <span className="text-sm text-[var(--c-muted)]" data-testid={`mobile-line-status-${item.id}`}>{STATUS[item.status] || item.status}</span>
        {item.status === 'provisioning' && <Loader2 className="w-4 h-4 animate-spin text-[var(--c-muted)]" />}
        <span className="text-xs text-[var(--c-muted)] ml-auto">{item.autoRenew ? `${money(item.price)}/month${date ? ` · next ${date}` : ''}` : `Auto-renew off${date ? ` · ends ${date}` : ''}`}</span>
      </div>
      {item.status === 'provisioning' && <p className="text-sm text-[var(--c-muted)]" data-testid={`mobile-line-pending-${item.id}`}>{`Paid. We asked for a number near ${item.zipcode || 'your ZIP code'}; it appears here as soon as the carrier assigns it.`}</p>}
      {item.note && <p className="text-sm text-[#fbbf24]">{item.note}</p>}
      {item.status === 'active' && <Link to={cp('/app/messages')} className="text-sm underline font-semibold text-[var(--c-accent)] inline-flex items-center gap-2" data-testid={`mobile-line-messages-${item.id}`}><MessageSquare className="w-4 h-4" />Open texts in Messages</Link>}
      <div className="flex flex-wrap items-start gap-2">
        {item.status === 'suspended' && <WalletPay price={item.price} small onWallet={() => act('renew', {}, 'Renewed')} label={`Renew ${money(item.price)}`} testid={`mobile-renew-pay-${item.id}`} walletTestid={`mobile-renew-${item.id}`} />}
        {['active', 'suspended'].includes(item.status) && <button type="button" role="switch" aria-checked={item.autoRenew} disabled={busy} onClick={() => act('auto-renew', { on: !item.autoRenew }, item.autoRenew ? 'Auto-renew off' : 'Auto-renew on')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`mobile-autorenew-${item.id}`}>{item.autoRenew ? 'Auto-renew on' : 'Auto-renew off'}</button>}
        {['active', 'suspended'].includes(item.status) && <button type="button" onClick={cancel} disabled={busy} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`mobile-cancel-${item.id}`}>Cancel number</button>}
      </div>
      <RenewWarning price={item.price} date={item.nextBillAt} on={item.status === 'active' && item.autoRenew} testid={`mobile-renew-warning-${item.id}`} />
    </div>
  );
}

export function MobileLines() {
  const { data, reload } = useApi('/mobile-numbers');
  const waiting = !!data?.items?.some(x => x.status === 'provisioning');
  useEffect(() => { if (!waiting) return undefined; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [waiting, reload]);
  if (!data?.items?.length) return null;
  return (
    <div className="mt-8 space-y-3" data-testid="mobile-lines">
      <h2 className="font-display text-xl font-bold">Mobile numbers for texting</h2>
      {data.items.map(x => <MobileLine key={x.id} item={x} reload={reload} />)}
    </div>
  );
}
