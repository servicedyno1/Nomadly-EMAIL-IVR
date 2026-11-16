import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageSquare, Loader2, Phone, PhoneIncoming } from 'lucide-react';
import { useShell } from '../../Shell';
import { DIAL_FROM } from '../../Softphone';
import { api, money, useApi } from '../../api';
import { ask } from '../../confirm';
import { cp } from '../../paths';
import { WalletPay, RenewWarning } from '../../WalletPay';
import { NewNumber } from '../esim/NewNumber';
import { renewText } from '../esim/RenewPick';
import { Receipts } from '../esim/Receipts';
import { CapBadges } from '../../kinds';
import { LineAutoRenew } from '../esim/LineAutoRenew';

const STATUS = { provisioning: 'Assigning your number…', active: 'Active', suspended: 'Paused · monthly fee due', failed: 'Couldn’t be set up · refunded' };

export function MobileLine({ item, reload, noRenew = false }) {
  const { openPhone } = useShell();
  const [busy, setBusy] = useState(false);
  const act = async (path, body, msg) => { setBusy(true); try { await api(`/esim/${item.id}/${path}`, { method: 'POST', body }); toast.success(msg); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const cancel = async () => { if (await ask(`Cancel ${item.phoneNumber}? It stops sending and receiving texts and can’t be recovered.`, { danger: true, ok: 'Cancel number', cancel: 'Keep it', title: 'Cancel this number?' })) act('cancel', {}, 'Cancelled'); };
  return (
    <div className="civr-card p-5 space-y-3" data-testid={`mobile-line-${item.id}`}>
      {!noRenew && <div className="flex flex-wrap items-center gap-3">
        {noRenew ? <span className="font-mono text-lg" data-no-translate data-testid={`mobile-line-number-${item.id}`}>{item.phoneNumber || 'Number coming'}</span> : <Link to={cp(`/app/esim/${item.id}`)} className="font-mono text-lg hover:text-[var(--c-accent)]" data-no-translate data-testid={`mobile-line-number-${item.id}`}>{item.phoneNumber || 'Number coming'}</Link>}
        <CapBadges caps={['calls', 'texts']} testid={`mobile-line-caps-${item.id}`} /><span className="civr-pill">USA · unlimited texts</span>
        <span className="text-sm text-[var(--c-muted)]" data-testid={`mobile-line-status-${item.id}`}>{STATUS[item.status] || item.status}</span>
        {item.status === 'provisioning' && <Loader2 className="w-4 h-4 animate-spin text-[var(--c-muted)]" />}
        <span className="text-xs text-[var(--c-muted)] ml-auto" data-testid={`mobile-renew-info-${item.id}`}>{renewText(item, money)}</span>
      </div>}
      {item.status === 'provisioning' && <p className="text-sm text-[var(--c-muted)]" data-testid={`mobile-line-pending-${item.id}`}>{`Paid. We asked for a number near ${item.zipcode || 'your ZIP code'}; it appears here as soon as the carrier assigns it.`}</p>}
      {item.note && <p className="text-sm text-[#fbbf24]">{item.note}</p>}
      {item.status === 'active' && <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link to={cp('/app/messages')} className="text-sm underline font-semibold text-[var(--c-accent)] inline-flex items-center gap-2" data-testid={`mobile-line-messages-${item.id}`}><MessageSquare className="w-4 h-4" />Open texts in Messages</Link>
        <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent(DIAL_FROM, { detail: { from: item.phoneNumber } })); openPhone(); }} className="text-sm underline font-semibold text-[var(--c-accent)] inline-flex items-center gap-2" data-testid={`mobile-line-call-${item.id}`}><Phone className="w-4 h-4" />Call from this number</button>
      </div>}
      {item.status === 'active' && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--c-line)] p-3 opacity-70" aria-disabled="true" data-testid={`mobile-line-ring-${item.id}`}>
        <PhoneIncoming className="w-4 h-4 text-[var(--c-muted)]" /><span className="text-sm font-semibold">Ring in CloudIVR</span>
        <span className="civr-pill" data-testid={`mobile-line-ring-status-${item.id}`}>Not active yet</span>
        <span className="text-xs text-[var(--c-muted)] basis-full">Calls to this number can’t ring in your browser yet: we’re waiting for the carrier to switch on call routing. Outgoing calls from the browser phone already work.</span>
      </div>}
      {!noRenew && <LineAutoRenew item={item} reload={reload} testid={`mobile-autorenew-${item.id}`} className="rounded-xl border border-[var(--c-line,#2a2a2a)] p-3" />}
      <div className="flex flex-wrap items-start gap-2">
        {item.status === 'suspended' && <WalletPay price={item.price} small onWallet={() => act('renew', {}, 'Renewed')} label={`Renew ${money(item.price)}`} testid={`mobile-renew-pay-${item.id}`} walletTestid={`mobile-renew-${item.id}`} />}
        <NewNumber item={item} reload={reload} />
        <Receipts item={item} />
        {['active', 'suspended'].includes(item.status) && <button type="button" onClick={cancel} disabled={busy} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`mobile-cancel-${item.id}`}>Cancel number</button>}
      </div>
      <RenewWarning price={item.price} date={item.nextBillAt} on={item.status === 'active' && item.autoRenew && item.price > 0} testid={`mobile-renew-warning-${item.id}`} />
    </div>
  );
}

export function MobileLines({ noEmpty = false }) {
  const { data, reload } = useApi('/mobile-numbers');
  const waiting = !!data?.items?.some(x => x.status === 'provisioning');
  useEffect(() => { if (!waiting) return undefined; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [waiting, reload]);
  if (!data?.items?.length) return data?.available && !noEmpty ? (
    <div className="civr-card p-5 mt-8 flex flex-wrap items-center gap-3" data-testid="mobile-lines-empty">
      <MessageSquare className="w-5 h-5 text-[#818cf8]" />
      <div className="flex-1 min-w-[200px]"><div className="font-semibold">Send and receive texts in CloudIVR</div><div className="text-sm text-[var(--c-muted)]">{`Get a Texting Number: a USA number for texts and verification codes, right in Messages. ${money(data.price)}/month.`}</div></div>
      <Link to={cp('/app/buy?purpose=texting&country=US')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="mobile-lines-empty-buy">Order a Texting Number</Link>
    </div>
  ) : null;
  return (
    <div className="mt-8 space-y-3" data-testid="mobile-lines">
      <h2 className="font-display text-xl font-bold">Your Texting Numbers <span className="text-sm font-normal text-[var(--c-muted)]">· texts in Messages, calls from the browser phone</span></h2>
      {data.items.map(x => <MobileLine key={x.id} item={x} reload={reload} />)}
    </div>
  );
}
