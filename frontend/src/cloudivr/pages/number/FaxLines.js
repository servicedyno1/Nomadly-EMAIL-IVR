import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { day, money } from '../../api';
import { cp } from '../../paths';

import { CapBadges } from '../../kinds';

const FAX_STATUS = { past_due: ['Paused · top up to renew', 'text-amber-500'], pending_registration: ['Waiting for the carrier’s approval', 'text-amber-500'] };

// A fax-only number on My numbers; opens the Fax page.
export function FaxLine({ n, pv }) {
  const [label, tone] = FAX_STATUS[n.status] || ['Receiving faxes', 'text-emerald-500'];
  return (
    <Link to={cp('/app/fax')} className="civr-card p-5 flex items-center gap-4 hover:border-[#818cf8]/50 transition-colors" data-testid={`fax-number-line-${n.phoneNumber.replace(/\D/g, '')}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-lg" data-no-translate>{pv.phone(n.phoneNumber)}</span><CapBadges caps={['fax']} /></div>
        <div className={`text-sm ${tone}`}>{label}</div>
        <div className="text-xs text-[var(--c-muted)]">{`${money(n.price)}/month · ${n.autoRenew ? 'renews' : 'ends'} ${day(n.expiresAt)}`}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--c-muted)] shrink-0" />
    </Link>
  );
}
