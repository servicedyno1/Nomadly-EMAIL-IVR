import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket, Send, X, Gift, PhoneOutgoing, RefreshCw, ArrowUpCircle } from 'lucide-react';
import { useOffer } from '../../offers';
import { useApi } from '../../api';
import { useShell } from '../../Shell';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { recall, remember } from '../../consent';

const pad = (n) => String(n).padStart(2, '0');
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };

const OFFER_ICON = { number: Ticket, renew: RefreshCw, upgrade: ArrowUpCircle, topup: Gift, firstTopup: Gift };
// Today's personal offer with a live countdown to midnight UTC; dismissible (stays hidden until the next offer), hidden once used.
export function CouponBanner() {
  const { offer, dismiss } = useOffer();
  const [now, setNow] = useState(Date.now());
  const live = !!offer && !offer.used && !offer.dismissed;
  useEffect(() => { if (!live) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  if (!live) return null;
  const left = new Date(offer.expiresAt).getTime() - now;
  if (left <= 0) return null;
  const Icon = OFFER_ICON[offer.kind] || Ticket;
  return (
    <div className="civr-card civr-rise civr-offer p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 relative" data-testid="dashboard-coupon-banner" data-offer-kind={offer.kind}>
      <div className="w-11 h-11 rounded-xl bg-[var(--c-accent-soft)] flex items-center justify-center shrink-0"><Icon className="w-5 h-5 text-[var(--c-accent)]" /></div>
      <div className="flex-1 min-w-0 pr-8 sm:pr-0">
        <div className="text-xs uppercase tracking-[0.14em] text-[var(--c-accent)] font-semibold">Today’s offer for you</div>
        <div className="font-semibold text-base mt-1" data-testid="dashboard-offer-title">{offer.title}</div>
        <div className="text-sm text-[var(--c-muted)] mt-1" data-testid="dashboard-offer-text">{offer.text}</div>
        <div className="text-xs text-[var(--c-muted)] mt-2 flex flex-wrap items-center gap-x-2">
          {offer.code && <><span>Code</span><span className="font-mono text-[var(--c-text)]" data-testid="dashboard-coupon-code" data-no-translate>{offer.code}</span><span>·</span></>}
          <span>Ends in</span><span className="font-mono text-[var(--c-accent)] tabular-nums" data-testid="dashboard-coupon-countdown">{hms(left)}</span>
        </div>
      </div>
      <Link to={cp(offer.cta.to)} className="civr-btn civr-btn-primary civr-btn-sm self-start sm:self-auto" data-testid="dashboard-coupon-use">{offer.cta.label}</Link>
      <button type="button" onClick={dismiss} className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--c-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-accent-soft)]" aria-label="Dismiss offer" data-testid="dashboard-coupon-dismiss"><X className="w-4 h-4" /></button>
    </div>
  );
}

const dismissKey = (account) => `civr.channelCard.${account?.id || 'me'}`;
// One-time welcome card pointing new accounts (first 30 days) to the Telegram channel; dismissal is per account.
export function ChannelCard() {
  const { catalog } = useShell();
  const { account } = useCivrAuth();
  const DISMISS = dismissKey(account);
  const [closed, setClosed] = useState(null); // key closed in this session (the account loads after the first render)
  const hidden = closed === DISMISS || recall(DISMISS) === '1';
  const isNew = account?.createdAt && Date.now() - new Date(account.createdAt).getTime() < 30 * 86400000;
  if (hidden || !isNew || !catalog?.channelLink) return null;
  const close = () => { remember('preferences', DISMISS, '1'); setClosed(DISMISS); };
  return (
    <div className="civr-card civr-rise p-5 sm:p-6 mb-6 flex items-start sm:items-center gap-4" data-testid="dashboard-channel-card">
      <div className="w-11 h-11 rounded-xl bg-[#38bdf8]/15 flex items-center justify-center shrink-0"><Send className="w-5 h-5 text-[#38bdf8]" /></div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-base">Welcome to CloudIVR</div>
        <div className="text-sm text-[#a1a1aa] mt-1">Join our Telegram channel for new countries, features, daily coupons and service updates.</div>
        <a href={catalog.channelLink} target="_blank" rel="noopener noreferrer" onClick={close} className="civr-btn civr-btn-ghost civr-btn-sm mt-3" data-testid="dashboard-channel-join"><Send className="w-4 h-4" />Join the channel</a>
      </div>
      <button type="button" onClick={close} className="w-11 h-11 -mt-2 -mr-2 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5 shrink-0" aria-label="Dismiss" data-testid="dashboard-channel-dismiss"><X className="w-4 h-4" /></button>
    </div>
  );
}

// Accounts without a calling number get one free Quick IVR call from our number (same offer as the bot).
export function TrialCard() {
  const shell = useShell();
  if (!shell?.summary?.ivrTrial) return null;
  return (
    <div className="civr-card civr-rise p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 !border-[#818cf8]/40 bg-gradient-to-r from-[#818cf8]/10 to-transparent" data-testid="dashboard-trial-card">
      <div className="w-11 h-11 rounded-xl bg-[#818cf8]/15 flex items-center justify-center shrink-0"><Gift className="w-5 h-5 text-[#818cf8]" /></div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-base">Make your free call — hear CloudIVR on your own phone</div>
        <div className="text-sm text-[#a1a1aa] mt-1">Type a message, enter your phone number, and we ring you in seconds. Press a key to see what your callers and leads will experience. No number or wallet needed.</div>
      </div>
      <Link to={cp('/app/quick-call')} className="civr-btn civr-btn-primary civr-btn-sm self-start sm:self-auto" data-testid="dashboard-trial-cta"><PhoneOutgoing className="w-4 h-4" />Call me now</Link>
    </div>
  );
}

export function TrialLink({ testid }) {
  const shell = useShell();
  if (!shell?.summary?.ivrTrial) return null;
  return <Link to={cp('/app/quick-call')} className="civr-btn civr-btn-ghost" data-testid={testid}><Gift className="w-4 h-4" />Try a free Quick IVR call</Link>;
}
