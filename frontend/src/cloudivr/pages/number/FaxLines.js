import React from 'react';
import { Link } from 'react-router-dom';
import { Printer, ChevronRight } from 'lucide-react';
import { useApi, day, money } from '../../api';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';

// My numbers: fax-only numbers in their own section.
export function FaxLines() {
  const pv = usePrivacy();
  const { data } = useApi('/fax-numbers');
  const items = (data?.numbers || []).filter(n => n.status !== 'released');
  if (!items.length) return null;
  return (
    <section className="mt-10" data-testid="fax-lines">
      <div className="flex items-center gap-3 mb-4">
        <Printer className="w-5 h-5 text-[#818cf8]" />
        <h2 className="font-display text-xl font-bold">Fax numbers</h2>
        <Link to={cp('/app/fax')} className="text-sm text-[var(--c-muted)] hover:text-[#818cf8] ml-auto" data-testid="fax-lines-open">Open fax</Link>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map(n => (
          <Link key={n.phoneNumber} to={cp('/app/fax')} className="civr-card p-5 flex items-center gap-4 hover:border-[#818cf8]/50 transition-colors" data-testid={`fax-number-line-${n.phoneNumber.replace(/\D/g, '')}`}>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-lg" data-no-translate>{pv.phone(n.phoneNumber)}</span><span className="civr-pill">Fax only</span></div>
              <div className={`text-sm ${n.status === 'past_due' ? 'text-amber-500' : 'text-emerald-500'}`}>{n.status === 'past_due' ? 'Paused · top up to renew' : 'Receiving faxes'}</div>
              <div className="text-xs text-[var(--c-muted)]">{`${money(n.price)}/month · ${n.autoRenew ? 'renews' : 'ends'} ${day(n.expiresAt)}`}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--c-muted)] shrink-0" />
          </Link>
        ))}
      </div>
    </section>
  );
}
