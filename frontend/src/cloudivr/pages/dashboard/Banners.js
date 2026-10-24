import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket, Send, X } from 'lucide-react';
import { useApi } from '../../api';
import { useShell } from '../../Shell';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';

const pad = (n) => String(n).padStart(2, '0');
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };

// Today's coupon with a live countdown to midnight UTC; hidden once used or expired.
export function CouponBanner() {
  const { data } = useApi('/coupons/today');
  const [now, setNow] = useState(Date.now());
  const c = data?.coupon;
  const live = !!c && !c.used;
  useEffect(() => { if (!live) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  if (!live) return null;
  const left = new Date(c.expiresAt).getTime() - now;
  if (left <= 0) return null;
  return (
    <div className="civr-card civr-rise p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 !border-[#34d399]/40 bg-gradient-to-r from-[#34d399]/10 to-transparent" data-testid="dashboard-coupon-banner">
      <div className="w-11 h-11 rounded-xl bg-[#34d399]/15 flex items-center justify-center shrink-0"><Ticket className="w-5 h-5 text-[#34d399]" /></div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-base">{`Today's coupon: ${c.discount}% off a new number`}</div>
        <div className="text-sm text-[#a1a1aa] mt-1 flex flex-wrap items-center gap-x-2">
          <span>Code</span><span className="font-mono text-[#f3f4f6]" data-testid="dashboard-coupon-code" data-no-translate>{c.code}</span>
          <span>·</span><span>Ends in</span><span className="font-mono text-[#34d399] tabular-nums" data-testid="dashboard-coupon-countdown">{hms(left)}</span>
        </div>
      </div>
      <Link to={cp(`/app/buy?coupon=${encodeURIComponent(c.code)}`)} className="civr-btn civr-btn-primary civr-btn-sm self-start sm:self-auto" data-testid="dashboard-coupon-use">Use it</Link>
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
  const hidden = closed === DISMISS || (() => { try { return localStorage.getItem(DISMISS) === '1'; } catch (_) { return false; } })();
  const isNew = account?.createdAt && Date.now() - new Date(account.createdAt).getTime() < 30 * 86400000;
  if (hidden || !isNew || !catalog?.channelLink) return null;
  const close = () => { try { localStorage.setItem(DISMISS, '1'); } catch (_) { /* private mode */ } setClosed(DISMISS); };
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
