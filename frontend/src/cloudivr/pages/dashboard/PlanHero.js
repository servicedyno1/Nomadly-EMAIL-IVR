import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, Hash, Settings2, Sparkles } from 'lucide-react';
import { money, day, enc } from '../../api';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';

export const TIERS = ['starter', 'standard', 'pro', 'business'];
const LIVE = ['active', 'suspended'];
export const mainLines = (nums) => (nums || []).filter(n => !n.isSubNumber && LIVE.includes(n.status) && TIERS.includes(n.plan) && !n.faxOnly)
  .sort((a, b) => TIERS.indexOf(b.plan) - TIERS.indexOf(a.plan));

function Meter({ label, used, included, testid }) {
  const pct = included ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const tone = pct >= 90 ? 'bg-rose-600' : pct >= 70 ? 'bg-amber-500' : 'bg-[var(--c-accent)]';
  return (
    <div data-testid={testid}>
      <div className="flex items-baseline justify-between text-sm"><span className="text-[var(--c-muted)]">{label}</span><span className="font-mono tabular-nums" data-testid={`${testid}-value`}>{included ? `${used ?? 0} / ${included}` : 'Pay as you go'}</span></div>
      <div className="h-2 rounded-full bg-[var(--c-border)] mt-2 overflow-hidden"><div className={`h-full rounded-full ${tone} transition-[width] duration-700`} style={{ width: `${included ? Math.max(pct, 2) : 0}%` }} /></div>
    </div>
  );
}

function NoPlan() {
  return (
    <section className="civr-card p-6 md:p-8 civr-rise flex flex-col md:flex-row md:items-center gap-6" data-testid="your-plan-hero">
      <div className="flex-1"><div className="civr-label">Your plan</div><div className="font-display text-2xl font-bold mt-2">No calling plan yet</div><p className="text-sm text-[var(--c-muted)] mt-1">A plan gives you a business number, call minutes, and the tools to answer and make calls: forwarding, voicemail, keypad menus, campaigns and the AI receptionist.</p></div>
      <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="plan-choose-button">Choose a plan<ArrowUpRight className="w-4 h-4" /></Link>
    </section>
  );
}

// The account's plan: tier, price, renewal, allowances and the numbers it includes.
export function PlanHero({ nums, catalog, line, setLine }) {
  const pv = usePrivacy();
  const [all, setAll] = useState(false);
  const lines = mainLines(nums);
  if (!lines.length) return <NoPlan />;
  const n = lines.find(x => x.phoneNumber === line) || lines[0];
  const plan = catalog?.plans?.find(p => p.id === n.plan);
  const next = catalog?.plans?.find(p => TIERS.indexOf(p.id) === TIERS.indexOf(n.plan) + 1 && p.available !== false);
  const extras = (nums || []).filter(x => x.isSubNumber && x.parentNumber === n.phoneNumber && LIVE.includes(x.status));
  const limit = catalog?.extraNumber?.limits?.[n.plan];
  const onPlan = [n, ...extras];
  return (
    <section className="civr-card p-6 md:p-8 civr-rise" data-testid="your-plan-hero">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[14rem]">
          <div className="civr-label">Your plan</div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="font-display text-3xl font-bold" data-testid="plan-tier-badge">{`${n.planName} plan`}</span>
            <span className={`civr-pill ${n.status === 'active' ? 'civr-pill-ok' : 'civr-pill-bad'}`} data-testid="plan-status">{n.status === 'active' ? 'Active' : 'Suspended'}</span>
          </div>
          <div className="text-sm text-[var(--c-muted)] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-[var(--c-text)]" data-testid="plan-price-display">{`${money(n.renewalPrice ?? n.planPrice ?? plan?.price ?? 0)}/month`}</span>
            {n.expiresAt && <span className="inline-flex items-center gap-1" data-testid="plan-renewal-date"><RefreshCw className="w-3.5 h-3.5" />{`${n.autoRenew ? 'Renews' : 'Ends'} ${day(n.expiresAt)}`}</span>}
            <span data-testid="plan-auto-renew-state">{n.autoRenew ? 'Auto-renew on' : 'Auto-renew off'}</span>
          </div>
        </div>
        {lines.length > 1 && (
          <select className="civr-input !h-10 !w-auto" value={n.phoneNumber} onChange={e => setLine(e.target.value)} aria-label="Pick a plan" data-testid="plan-switcher-dropdown">
            {lines.map(l => <option key={l.phoneNumber} value={l.phoneNumber}>{`${l.planName} · ${pv.phone(l.phoneNumber)}`}</option>)}
          </select>
        )}
      </div>
      <div className="grid md:grid-cols-3 gap-6 mt-8">
        <Meter label={n.usage?.shared ? 'Minutes this month (shared)' : 'Minutes this month'} used={n.usage?.minutesUsed} included={n.usage?.minutesIncluded ?? plan?.minutes} testid="plan-minutes-meter" />
        <Meter label="Texts this month" used={n.usage?.smsUsed} included={n.usage?.smsIncluded || plan?.sms} testid="plan-sms-meter" />
        <Meter label="Numbers on this plan" used={onPlan.length} included={limit != null ? limit + 1 : null} testid="plan-numbers-meter" />
      </div>
      <div className="mt-8 rounded-xl border border-[var(--c-border)] divide-y divide-[var(--c-border)]" data-testid="plan-numbers-list">
        {(all ? onPlan : onPlan.slice(0, 3)).map((x, i) => (
          <Link key={x.phoneNumber} to={cp(`/app/numbers/${enc(x.phoneNumber)}`)} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--c-accent)]/5 transition-colors" data-testid={`plan-number-${i}`}>
            <Hash className="w-4 h-4 text-[var(--c-muted)]" /><span className="font-mono text-sm flex-1 truncate">{pv.phone(x.phoneNumber)}</span>
            <span className="text-xs text-[var(--c-muted)]">{i === 0 ? 'Main number' : 'Extra number'}{x.countryName ? ` · ${x.countryName}` : ''}</span>
          </Link>
        ))}
        {onPlan.length > 3 && !all && <button type="button" onClick={() => setAll(true)} className="w-full px-4 py-2.5 text-sm text-[var(--c-accent)] text-left" data-testid="plan-numbers-more">{`Show ${onPlan.length - 3} more`}</button>}
      </div>
      <div className="flex flex-wrap gap-2 mt-6">
        {next && <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}?tab=billing`)} className="civr-btn civr-btn-primary" data-testid="plan-upgrade-cta-button"><Sparkles className="w-4 h-4" />{`Upgrade to ${next.name} · ${money(next.price)}/mo`}</Link>}
        <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}?tab=billing`)} className="civr-btn civr-btn-ghost" data-testid="plan-manage-link"><Settings2 className="w-4 h-4" />Manage plan</Link>
        {limit != null && onPlan.length <= limit && <Link to={cp('/app/buy?extra=1')} className="civr-btn civr-btn-ghost" data-testid="plan-add-number-link"><Hash className="w-4 h-4" />Add an extra number</Link>}
      </div>
    </section>
  );
}
