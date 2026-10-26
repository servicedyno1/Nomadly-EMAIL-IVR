import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Inbox as InboxIcon, CheckCheck, MessageSquare, Voicemail, Wallet, Megaphone, Receipt, Phone, Info, Ticket, MessageSquareReply, ChevronRight } from 'lucide-react';
import { cp } from '../paths';
import { api, useApi, when, playUrl } from '../api';
import { useShell } from '../Shell';
import { PageHeader, SkeletonRows, Empty, ErrorNote } from '../ui';
import { usePrivacy } from '../privacy';
import { MissedCalls } from '../MissedCalls';
import { RING_ENDED } from '../Incoming';
import { useLangTick } from '../i18n';
import { useSearch, SearchBox, NoMatches } from '../search';
import { QuickReply, SMS_REPLIES, SmsStatus } from '../QuickReply';
import { OtpLive } from './quick/Otp';

const KINDS = [['', 'All', InboxIcon], ['sms', 'SMS', MessageSquare], ['voicemail', 'Voicemail', Voicemail], ['call', 'Calls', Phone], ['campaign', 'Campaigns', Megaphone], ['wallet', 'Wallet', Wallet], ['billing', 'Billing', Receipt], ['coupon', 'Coupons', Ticket], ['info', 'Other', Info]];
const ICON = Object.fromEntries(KINDS.map(([k, , I]) => [k, I]));
const NAME = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
const lower = (s) => (s === 'SMS' ? s : s.toLowerCase());
const OPENS = { sms: 'Open texts', voicemail: 'Open voicemails', call: 'Open call log', billing: 'Open billing', wallet: 'Open wallet', campaign: 'Open campaigns' };
const opens = (n) => (n.meta?.otp ? 'Open Quick IVR call' : OPENS[n.kind] || 'Open');

// One-tap filter; a small badge shows how many unread items it holds.
function FilterPill({ k, label, on, count, onPick }) {
  const id = k || 'all';
  return (
    <button onClick={() => onPick(k)} className={`civr-pill cursor-pointer ${on ? 'civr-pill-on' : ''}`} data-testid={`inbox-filter-${id}`}>
      {label}
      {count > 0 && <span className="civr-pill-count" data-testid={`inbox-filter-${id}-count`} data-no-translate>{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

// Answer a text right under it: one SMS from the number that received it back to the sender.
function SmsReply({ n, i, pv, onReplied, reload }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = `inbox-item-${i}-reply`;
  const send = async (text) => {
    setBusy(true);
    try {
      const d = await api(`/notifications/${n.id}/reply`, { method: 'POST', body: { text } });
      toast.success(d.reply.status === 'preview' ? 'Reply saved (preview — not sent)' : 'Text sent');
      onReplied(n.id, d.reply); setOpen(false);
      if (d.reply.status === 'sent') setTimeout(reload, 6000);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const r = n.meta?.reply;
  const optedOut = r?.status === 'failed' && r.code === '40300';
  return (
    <div className="relative z-10 mt-2 max-w-xl" data-testid={t}>
      {r && !open && <p className="text-xs text-[#818cf8] break-words" data-testid={`${t}-done`}>{`You replied: “${pv.text(r.text, 'Message hidden')}”`}{r.status === 'preview' ? ' (preview — not sent)' : null}</p>}
      {r && !open && <SmsStatus status={r.status} reason={r.reason} testid={`${t}-status`} />}
      {open ? <div className="mt-2"><QuickReply onSend={send} busy={busy} presets={SMS_REPLIES} autoFocus testid={`${t}-box`} /><button type="button" className="text-xs text-[#a1a1aa] hover:text-white mt-1" onClick={() => setOpen(false)} data-testid={`${t}-cancel`}>Cancel</button></div>
        : !optedOut && <button type="button" onClick={() => setOpen(true)} className={`civr-btn civr-btn-ghost civr-btn-sm ${r ? 'mt-1.5' : ''}`} data-testid={`${t}-button`}><MessageSquareReply className="w-4 h-4" />{r ? 'Reply again' : 'Reply'}</button>}
    </div>
  );
}

export default function Inbox() {
  const { refreshSummary } = useShell();
  const pv = usePrivacy();
  useLangTick();
  const [kind, setKind] = useState('');
  const { data, error, loading, reload, stale, setData } = useApi(`/notifications?limit=100${kind ? `&kind=${kind}` : ''}`);
  const { data: today } = useApi('/coupons/today');
  useEffect(() => { window.addEventListener(RING_ENDED, reload); return () => window.removeEventListener(RING_ENDED, reload); }, [reload]);
  const markRead = async () => {
    try {
      await api('/notifications/read', { method: 'POST', body: kind ? { kind } : {} });
      toast.success(kind ? `${NAME[kind]} marked as read` : 'All caught up');
      reload(); refreshSummary();
    } catch (e) { toast.error(e.message); }
  };
  const patch = (id, fn) => setData(d => (d ? { ...d, notifications: d.notifications.map(x => (x.id === id ? fn(x) : x)) } : d));
  // Opening an item marks it read on the way out (the link itself navigates).
  const openItem = (n) => {
    if (n.read) return;
    patch(n.id, x => ({ ...x, read: true }));
    setData(d => (d ? { ...d, unread: Math.max(0, (d.unread || 0) - 1), unreadByKind: { ...d.unreadByKind, [n.kind]: Math.max(0, (d.unreadByKind?.[n.kind] || 0) - 1) } } : d));
    api('/notifications/read', { method: 'POST', body: { id: n.id } }).then(refreshSummary).catch(() => {});
  };
  const onReplied = (id, reply) => { patch(id, x => ({ ...x, read: true, meta: { ...(x.meta || {}), reply } })); refreshSummary(); };
  const items = data?.notifications || [];
  const unreadOf = (k) => (k ? data?.unreadByKind?.[k] : data?.unread) || 0;
  const s = useSearch(items, n => [n.text, n.kind, NAME[n.kind], n.meta?.coupon]);
  return (
    <div data-testid="inbox-page">
      <PageHeader label="Inbox" title="Inbox" sub="Texts, voicemails, call alerts, campaign reports and wallet updates for your numbers. Tap one to open it where it happened." testid="inbox-header">
        <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={markRead} disabled={!unreadOf(kind)} data-testid="inbox-mark-read-button"><CheckCheck className="w-4 h-4" />{kind ? 'Mark these as read' : 'Mark all read'}{unreadOf(kind) ? <span data-testid="inbox-mark-read-count"> ({unreadOf(kind)})</span> : null}</button>
      </PageHeader>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <SearchBox s={s} placeholder="Search messages" testid="inbox-search" className="lg:w-72 shrink-0" />
        <div className="flex flex-wrap gap-2">{KINDS.map(([k, l]) => <FilterPill key={k || 'all'} k={k} label={l} on={kind === k} count={unreadOf(k)} onPick={setKind} />)}</div>
      </div>
      {(kind === '' || kind === 'call') && <MissedCalls />}
      <ErrorNote error={error} onRetry={reload} className="mb-4" />
      {error && !data ? null : (loading && !data) || stale ? <SkeletonRows rows={5} /> : !items.length ? (kind ? (
        <Empty icon={ICON[kind] || InboxIcon} title={`No ${lower(NAME[kind])} updates yet`} sub="Nothing of this kind has arrived. Everything else is still in All." testid="inbox-empty">
          <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setKind('')} data-testid="inbox-empty-show-all-button">Show everything</button>
        </Empty>
      ) : (
        <Empty icon={InboxIcon} title="Nothing here yet" sub="When someone texts or calls your numbers, it shows up here. Call one of your numbers to see it work." testid="inbox-empty">
          <Link to={cp('/app/numbers')} className="civr-btn civr-btn-primary" data-testid="inbox-empty-numbers-link">Open my numbers</Link>
        </Empty>
      )) : (
        <div className="flex flex-col gap-2">
          <NoMatches s={s} testid="inbox-no-matches" />
          {s.list.map((n, i) => {
            const Icon = ICON[n.kind] || Info;
            const ccid = n.meta?.otp?.callControlId;
            const newestTry = ccid && !s.list.slice(0, i).some(x => x.meta?.otp?.callControlId === ccid);
            return (
              <div key={n.id} className={`civr-card relative p-4 flex gap-4 ${n.read ? '' : 'border-[#818cf8]/40'} ${n.link ? 'civr-card-link' : ''}`} data-testid={`inbox-item-${i}`}>
                {n.link && <Link to={cp(n.link)} onClick={() => openItem(n)} className="absolute inset-0 rounded-[14px]" aria-label={opens(n)} data-testid={`inbox-item-${i}-open`} />}
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${n.read ? 'text-[#a1a1aa]' : 'text-[#818cf8]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm whitespace-pre-line break-words text-[#f4f4f5]" data-testid={`inbox-item-${i}-text`}>{pv.text(n.text, 'Message hidden')}</div>
                  {n.mediaUrl && /\.(mp3|wav|ogg)(\?|$)/i.test(n.mediaUrl) && <audio controls preload="none" src={playUrl(n.mediaUrl)} className="relative z-10 h-9 mt-2" data-testid={`inbox-item-${i}-audio`} />}
                  {n.meta?.coupon && !n.meta.used && !(today?.coupon?.used && today.coupon.code === n.meta.coupon) && <Link to={cp(`/app/buy?coupon=${encodeURIComponent(n.meta.coupon)}`)} className="relative z-10 civr-btn civr-btn-ghost civr-btn-sm mt-2" data-testid={`inbox-item-${i}-use-coupon`}><Ticket className="w-4 h-4" />Use coupon {n.meta.coupon}</Link>}
                  {n.canReply && <SmsReply n={n} i={i} pv={pv} onReplied={onReplied} reload={reload} />}
                  {ccid && Date.now() - new Date(n.createdAt).getTime() < 15 * 60000 && (newestTry ? <OtpLive ccid={ccid} compact testid={`inbox-item-${i}-otp`} />
                    : <p className="text-xs text-[#a1a1aa] mt-2" data-testid={`inbox-item-${i}-otp-superseded`}>An earlier try. The newest code for this call is above.</p>)}
                  <div className="flex items-center gap-3 text-xs text-[#a1a1aa] mt-2">
                    <span>{when(n.createdAt)}</span>
                    {n.link && <span className="inline-flex items-center gap-0.5 text-[#818cf8]/80" data-testid={`inbox-item-${i}-open-hint`}>{opens(n)}<ChevronRight className="w-3 h-3" /></span>}
                  </div>
                </div>
                {!n.read && <span className="w-2 h-2 rounded-full bg-[#818cf8] mt-2 shrink-0" data-testid={`inbox-item-${i}-unread`} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
