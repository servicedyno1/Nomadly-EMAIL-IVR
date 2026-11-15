import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { money, day, enc } from '../../api';
import { cp } from '../../paths';

const TIERS = ['starter', 'standard', 'pro', 'business'];
const INCLUDES = [['callForwarding', 'Forwarding'], ['voicemail', 'Voicemail'], ['ivr', 'Keypad menu'], ['ivrOutbound', 'Quick IVR'], ['bulkCall', 'Bulk IVR'], ['sipCredentials', 'Softphone'], ['callRecording', 'Recording'], ['aiAgent', 'AI agent']];

// Plan details inside a calling-number row: tier, price, main/extra, shared minutes, renewal, what's included, upgrade.
export function NumberPlan({ n, i, catalog, pv }) {
  const next = catalog?.plans?.find(p => TIERS.indexOf(p.id) === TIERS.indexOf(n.plan) + 1 && p.available !== false);
  const used = n.usage?.minutesUsed || 0, inc = n.usage?.minutesIncluded;
  const pct = inc ? Math.min(100, Math.round((used / inc) * 100)) : 0;
  const has = [...INCLUDES.filter(([k]) => n.access?.[k]).map(([, l]) => l), ...(n.plan === 'business' ? ['Fax'] : [])];
  const price = n.isSubNumber ? n.planPrice : (n.renewalPrice ?? n.planPrice);
  return (
    <div className="mt-2 space-y-2" data-testid={`dashboard-number-${i}-plan`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="civr-pill civr-pill-on" data-testid={`dashboard-number-${i}-tier`}>{`${n.planName} plan`}</span>
        {price != null && <span className="font-mono" data-testid={`dashboard-number-${i}-price`}>{`${money(price)}/mo`}</span>}
        <span className="text-[var(--c-muted)]" data-testid={`dashboard-number-${i}-role`}>{n.isSubNumber ? `Extra number on ${pv.phone(n.parentNumber)}` : 'Main number'}</span>
        {n.expiresAt && <span className="inline-flex items-center gap-1 text-[var(--c-muted)]" data-testid={`dashboard-number-${i}-renewal`}><RefreshCw className="w-3 h-3" />{`${n.autoRenew ? 'Renews' : 'Ends'} ${day(n.expiresAt)} · auto-renew ${n.autoRenew ? 'on' : 'off'}`}</span>}
      </div>
      {inc ? (
        <div className="max-w-sm" data-testid={`dashboard-number-${i}-minutes`}>
          <div className="flex justify-between text-xs text-[var(--c-muted)]"><span>{n.usage?.shared ? 'Minutes this month (shared)' : 'Minutes this month'}</span><span className="font-mono">{`${used} / ${inc}`}</span></div>
          <div className="h-1.5 rounded-full bg-[var(--c-border)] mt-1 overflow-hidden"><div className={`h-full rounded-full ${pct >= 90 ? 'bg-rose-600' : pct >= 70 ? 'bg-amber-600' : 'bg-[var(--c-accent)]'}`} style={{ width: `${Math.max(pct, 2)}%` }} /></div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {has.length > 0 && <span className="text-[var(--c-muted)] min-w-0" data-testid={`dashboard-number-${i}-includes`}>{`Includes ${has.join(' · ')}`}</span>}
        {next && !n.isSubNumber && <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}?tab=billing`)} className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 font-semibold text-[var(--c-accent)] hover:underline underline-offset-2" data-testid={`dashboard-number-${i}-upgrade`}>{`Upgrade to ${next.name}`}<ArrowUpRight className="w-3.5 h-3.5" /></Link>}
      </div>
    </div>
  );
}
