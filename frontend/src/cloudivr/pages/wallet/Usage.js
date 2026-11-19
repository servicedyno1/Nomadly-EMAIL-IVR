import React from 'react';
import { Phone, Bot, Megaphone, MessageSquare, Printer, ScanSearch, Globe, ArrowDownRight, ArrowUpRight, BarChart3, Receipt } from 'lucide-react';
import { useApi, money } from '../../api';
import { Flag } from '../../Pickers';
import { SkeletonRows, ErrorNote, Empty } from '../../ui';

const day = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtMin = (m) => m >= 1 ? `${Math.round(m)} min` : m > 0 ? `${Math.round(m * 60)}s` : '0';
const r2 = (n) => Math.round(n * 100) / 100;

const COUNTRY_FLAGS = { 'US/CA': 'US', GB: 'GB', AU: 'AU', DE: 'DE', FR: 'FR', IN: 'IN', CN: 'CN', JP: 'JP', MX: 'MX', BR: 'BR', ES: 'ES', IT: 'IT', NL: 'NL' };

function Stat({ icon: Icon, label, value, sub, accent, testid }) {
  return (
    <div className="civr-card p-4 flex items-start gap-3" data-testid={testid}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${accent || 'bg-[var(--c-accent)]/10 text-[var(--c-accent)]'}`}><Icon className="w-4.5 h-4.5" /></div>
      <div>
        <div className="text-xs text-[var(--c-muted)] mb-0.5">{label}</div>
        <div className="text-lg font-semibold leading-tight" data-testid={`${testid}-value`}>{value}</div>
        {sub && <div className="text-xs text-[var(--c-muted)] mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mt-6">
      <h3 className="text-sm font-medium text-[var(--c-muted)] mb-3 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

export function Usage() {
  const { data, error, loading } = useApi('/wallet/usage');

  if (loading) return <SkeletonRows rows={6} testid="usage-loading" />;
  if (error) return <ErrorNote error={error} testid="usage-error" />;
  if (!data || !data.summary) return null;

  const { cycle, summary: s, byNumber, byCountry, details } = data;
  const hasActivity = s.totalSpend > 0 || details.length > 0;

  return (
    <div className="space-y-6" data-testid="usage-page">
      {/* Billing cycle header */}
      <div className="flex items-center gap-2 text-sm text-[var(--c-muted)]" data-testid="usage-cycle">
        <BarChart3 className="w-4 h-4" />
        <span>Billing period: <strong className="text-[var(--c-fg)]">{day(cycle.start)}</strong> — <strong className="text-[var(--c-fg)]">{day(cycle.end)}</strong></span>
      </div>

      {!hasActivity ? (
        <Empty icon={Receipt} title="No usage yet" sub="Charges and call activity will appear here once you start using your numbers." testid="usage-empty" />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="usage-summary">
            <Stat icon={Phone} label="Calls" value={s.calls} sub={s.callSpend > 0 ? money(s.callSpend) : null} testid="usage-stat-calls" />
            <Stat icon={Bot} label="AI receptionist" value={fmtMin(s.aiMinutes)} sub={s.aiSpend > 0 ? money(s.aiSpend) : null} accent="bg-purple-500/10 text-purple-400" testid="usage-stat-ai" />
            <Stat icon={Megaphone} label="AI campaigns" value={fmtMin(s.campaignMinutes)} sub={s.campaignSpend > 0 ? money(s.campaignSpend) : null} accent="bg-amber-500/10 text-amber-400" testid="usage-stat-campaigns" />
            <Stat icon={MessageSquare} label="SMS sent" value={s.smsCount} sub={s.smsSpend > 0 ? money(s.smsSpend) : null} accent="bg-emerald-500/10 text-emerald-400" testid="usage-stat-sms" />
            {s.faxCount > 0 && <Stat icon={Printer} label="Fax" value={s.faxCount} sub={s.faxSpend > 0 ? money(s.faxSpend) : null} accent="bg-sky-500/10 text-sky-400" testid="usage-stat-fax" />}
            {s.lookupCount > 0 && <Stat icon={ScanSearch} label="Lookups" value={s.lookupCount} sub={s.lookupSpend > 0 ? money(s.lookupSpend) : null} accent="bg-rose-500/10 text-rose-400" testid="usage-stat-lookups" />}
            <Stat icon={Receipt} label="Total spend" value={money(s.totalSpend)} sub={s.connectionFees > 0 ? `incl. ${money(s.connectionFees)} connection fees` : null} accent="bg-[var(--c-accent)]/10 text-[var(--c-accent)]" testid="usage-stat-total" />
          </div>

          {/* Per number breakdown */}
          {byNumber.length > 0 && (
            <Section title="By number">
              <div className="civr-card divide-y divide-[var(--c-border)]" data-testid="usage-by-number">
                {byNumber.map((n, i) => (
                  <div key={n.phone} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm" data-testid={`usage-number-${i}`}>
                    <span className="font-mono min-w-[10rem] flex-1" data-no-translate>{n.phone}</span>
                    {n.calls > 0 && <span className="text-[var(--c-muted)]"><Phone className="w-3.5 h-3.5 inline mr-1" />{n.calls}</span>}
                    {n.ai > 0 && <span className="text-purple-400"><Bot className="w-3.5 h-3.5 inline mr-1" />{money(n.ai)}</span>}
                    {n.campaign > 0 && <span className="text-amber-400"><Megaphone className="w-3.5 h-3.5 inline mr-1" />{money(n.campaign)}</span>}
                    {n.sms > 0 && <span className="text-emerald-400"><MessageSquare className="w-3.5 h-3.5 inline mr-1" />{n.sms}</span>}
                    {n.fax > 0 && <span className="text-sky-400"><Printer className="w-3.5 h-3.5 inline mr-1" />{n.fax}</span>}
                    {n.lookup > 0 && <span className="text-rose-400"><ScanSearch className="w-3.5 h-3.5 inline mr-1" />{n.lookup}</span>}
                    <span className="font-medium w-20 text-right">{money(n.spend + n.ai + n.campaign)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* By country */}
          {byCountry.length > 0 && (
            <Section title="By destination">
              <div className="civr-card divide-y divide-[var(--c-border)]" data-testid="usage-by-country">
                {byCountry.map((c, i) => (
                  <div key={c.country} className="flex items-center gap-3 p-3 text-sm" data-testid={`usage-country-${i}`}>
                    <Flag code={COUNTRY_FLAGS[c.country] || c.country} />
                    <span className="flex-1">{c.country}</span>
                    <span className="text-[var(--c-muted)]">{c.calls} call{c.calls !== 1 ? 's' : ''}</span>
                    <span className="font-medium w-20 text-right">{money(c.spend)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Detail history */}
          {details.length > 0 && (
            <Section title="Activity log">
              <div className="civr-card divide-y divide-[var(--c-border)] max-h-[28rem] overflow-y-auto" data-testid="usage-details">
                {details.map((d, i) => {
                  const isCredit = d.amount > 0;
                  return (
                    <div key={d.id || i} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm" data-testid={`usage-detail-${i}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isCredit ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[var(--c-border)] text-[var(--c-muted)]'}`}>
                        {isCredit ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{d.description || d.type}</span>
                      {d.destination && <span className="text-xs text-[var(--c-muted)] font-mono" data-no-translate>{d.destination}</span>}
                      {d.country && <span className="flex items-center gap-1 text-xs text-[var(--c-muted)]"><Globe className="w-3 h-3" />{d.country}</span>}
                      <span className={`font-mono text-sm w-20 text-right ${isCredit ? 'text-emerald-400' : ''}`}>{isCredit ? '+' : '-'}{money(Math.abs(d.amount))}</span>
                      <span className="text-xs text-[var(--c-muted)] w-24 text-right">{day(d.at)}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
