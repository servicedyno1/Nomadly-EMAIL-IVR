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
const dismissKey = (account) => `civr.channelCard.${account?.id || 'me'}`;

// One slim banner at the top of Overview: today's offer (countdown to midnight UTC) or, when there's none, the
// welcome + Telegram channel link for new accounts. One X hides it (the offer until the next one, the welcome for good).
export function TopBanner() {
  const { offer, dismiss } = useOffer();
  const { catalog } = useShell();
  const { account } = useCivrAuth();
  const [now, setNow] = useState(Date.now());
  const [closed, setClosed] = useState(false);
  const DISMISS = dismissKey(account);
  const live = !!offer && !offer.used && !offer.dismissed && new Date(offer.expiresAt).getTime() > now;
  useEffect(() => { if (!live) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  const isNew = account?.createdAt && Date.now() - new Date(account.createdAt).getTime() < 30 * 86400000;
  const welcome = !closed && isNew && !!catalog?.channelLink && recall(DISMISS) !== '1';
  if (!live && !welcome) return null;
  const close = () => { if (live) dismiss(); remember('preferences', DISMISS, '1'); setClosed(true); };
  const Icon = live ? (OFFER_ICON[offer.kind] || Ticket) : Send;
  return (
    <div className="civr-card civr-rise civr-offer px-4 py-3 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="dashboard-top-banner" data-offer-kind={live ? offer.kind : 'welcome'}>
      <Icon className="w-5 h-5 text-[var(--c-accent)] shrink-0" />
      {live ? (
        <div className="flex-1 min-w-[12rem] text-sm" data-testid="dashboard-coupon-banner">
          <span className="font-semibold" data-testid="dashboard-offer-title">{offer.title}</span>
          <span className="text-[var(--c-muted)]"> · <span data-testid="dashboard-offer-text">{offer.text}</span></span>
          <span className="text-xs text-[var(--c-muted)] whitespace-nowrap"> · {offer.code && <><span className="font-mono text-[var(--c-text)]" data-testid="dashboard-coupon-code" data-no-translate>{offer.code}</span> · </>}ends in <span className="font-mono text-[var(--c-accent)] tabular-nums" data-testid="dashboard-coupon-countdown">{hms(new Date(offer.expiresAt).getTime() - now)}</span></span>
        </div>
      ) : (
        <div className="flex-1 min-w-[12rem] text-sm" data-testid="dashboard-channel-card"><span className="font-semibold">Welcome to CloudIVR</span><span className="text-[var(--c-muted)]"> · Join our Telegram channel for new countries, features, daily coupons and service updates.</span></div>
      )}
      {live ? <Link to={cp(offer.cta.to)} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="dashboard-coupon-use">{offer.cta.label}</Link>
        : <a href={catalog.channelLink} target="_blank" rel="noopener noreferrer" onClick={close} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="dashboard-channel-join"><Send className="w-4 h-4" />Join the channel</a>}
      <button type="button" onClick={close} className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--c-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-accent-soft)]" aria-label="Dismiss" data-testid="dashboard-top-banner-dismiss"><X className="w-4 h-4" /></button>
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
