import React, { useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Inbox as InboxIcon, CheckCheck, MessageSquare, Voicemail, Wallet, Megaphone, Receipt, Phone, Info, Ticket } from 'lucide-react';
import { cp } from '../paths';
import { api, useApi, when, playUrl } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Spinner, Empty, ErrorNote } from '../ui';
import { usePrivacy } from '../privacy';
import { MissedCalls } from '../MissedCalls';

const KINDS = [['', 'All', InboxIcon], ['sms', 'SMS', MessageSquare], ['voicemail', 'Voicemail', Voicemail], ['call', 'Calls', Phone], ['campaign', 'Campaigns', Megaphone], ['wallet', 'Wallet', Wallet], ['billing', 'Billing', Receipt], ['coupon', 'Coupons', Ticket], ['info', 'Other', Info]];
const ICON = Object.fromEntries(KINDS.map(([k, , I]) => [k, I]));

export default function Inbox() {
  const { refreshSummary } = useShell();
  const pv = usePrivacy();
  const [kind, setKind] = useState('');
  const { data, error, loading, reload } = useApi(`/notifications?limit=100${kind ? `&kind=${kind}` : ''}`);
  const { data: today } = useApi('/coupons/today');
  const markRead = async () => { try { await api('/notifications/read', { method: 'POST' }); toast.success('All caught up'); reload(); refreshSummary(); } catch (e) { toast.error(e.message); } };
  const items = data?.notifications || [];
  return (
    <div data-testid="inbox-page">
      <PageHeader label="Inbox" title="Inbox" sub="Texts, voicemails, call alerts, campaign reports and wallet updates for your numbers." testid="inbox-header">
        <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={markRead} disabled={!data?.unread} data-testid="inbox-mark-read-button"><CheckCheck className="w-4 h-4" />Mark all read{data?.unread ? ` (${data.unread})` : ''}</button>
      </PageHeader>
      <div className="flex flex-wrap gap-2 mb-6">{KINDS.map(([k, l]) => <button key={k || 'all'} onClick={() => setKind(k)} className={`civr-pill cursor-pointer ${kind === k ? 'civr-pill-on' : ''}`} data-testid={`inbox-filter-${k || 'all'}`}>{l}</button>)}</div>
      {(kind === '' || kind === 'call') && <MissedCalls />}
      <ErrorNote error={error} />
      {loading && !data ? <Spinner /> : !items.length ? <Empty icon={InboxIcon} title="Nothing here yet" sub="When someone texts or calls your numbers, it shows up here." testid="inbox-empty" /> : (
        <div className="space-y-2">
          {items.map((n, i) => {
            const Icon = ICON[n.kind] || Info;
            return (
              <div key={n.id} className={`civr-card p-4 flex gap-4 ${n.read ? '' : 'border-[#34d399]/40'}`} data-testid={`inbox-item-${i}`}>
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${n.read ? 'text-[#a1a1aa]' : 'text-[#34d399]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm whitespace-pre-line break-words text-[#f4f4f5]" data-testid={`inbox-item-${i}-text`}>{pv.text(n.text, 'Message hidden')}</div>
                  {n.mediaUrl && /\.(mp3|wav|ogg)(\?|$)/i.test(n.mediaUrl) && <audio controls preload="none" src={playUrl(n.mediaUrl)} className="h-9 mt-2" data-testid={`inbox-item-${i}-audio`} />}
                  {n.meta?.coupon && !n.meta.used && !(today?.coupon?.used && today.coupon.code === n.meta.coupon) && <Link to={cp(`/app/buy?coupon=${encodeURIComponent(n.meta.coupon)}`)} className="civr-btn civr-btn-ghost civr-btn-sm mt-2" data-testid={`inbox-item-${i}-use-coupon`}><Ticket className="w-4 h-4" />Use coupon {n.meta.coupon}</Link>}
                  <div className="text-xs text-[#a1a1aa] mt-2">{when(n.createdAt)}</div>
                </div>
                {!n.read && <span className="w-2 h-2 rounded-full bg-[#34d399] mt-2 shrink-0" data-testid={`inbox-item-${i}-unread`} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
