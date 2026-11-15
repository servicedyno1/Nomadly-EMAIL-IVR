import React from 'react';
import { Check } from 'lucide-react';
import { money, useApi } from '../../api';
import { KINDS, CapBadges } from '../../kinds';

// Starting price and what the account already owns, per kind.
export function useKindFacts(catalog, myNums) {
  const { data: mobile } = useApi('/mobile-numbers');
  const { data: fax } = useApi('/fax-numbers');
  const plans = (catalog?.plans || []).filter(p => p.available !== false).map(p => p.price);
  const lines = (myNums?.numbers || []).filter(n => n.status === 'active');
  const texts = (mobile?.items || []).filter(x => !['failed', 'cancelled', 'released'].includes(x.status)).length + lines.filter(n => n.features?.texting?.enabled && n.features?.texting?.available).length;
  const faxes = (fax?.numbers || []).filter(x => x.status !== 'released').length;
  const low = plans.length ? Math.min(...plans) : null;
  return {
    calls: { price: low, owned: lines.length },
    texting: { price: low, owned: texts },
    fax: { price: fax?.price || null, owned: faxes, extra: fax ? `${fax.freePages ?? 25} free pages a month, then ${money(fax.pagePrice ?? 0.05)} a page.` : null },
  };
}

function KindCard({ k, fact, onPick }) {
  return (
    <button type="button" onClick={() => onPick(k.id)} data-testid={`buy-kind-${k.id}`}
      className="civr-card text-left p-6 flex flex-col transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:!border-[var(--c-accent)]">
      <span className="w-11 h-11 rounded-xl bg-[var(--c-accent-soft)] grid place-items-center"><k.Icon className="w-5 h-5 text-[var(--c-accent)]" /></span>
      <span className="mt-4 text-lg font-semibold">{k.title}</span>
      <CapBadges caps={k.caps} className="mt-2" testid={`buy-kind-${k.id}-caps`} />
      <span className="mt-3 text-sm text-[var(--c-text-2)] flex-1">{k.pitch} <span className="text-[var(--c-muted)]">{fact?.extra || k.note}</span></span>
      <span className="mt-4 text-sm min-h-[28px]" data-testid={`buy-kind-${k.id}-price`}>{fact?.price ? <>from <b className="text-xl">{money(fact.price)}</b>/month</> : '\u00a0'}</span>
      {fact?.owned > 0 && <span className="mt-1 text-xs text-[var(--c-muted)]" data-testid={`buy-kind-${k.id}-owned`}>{`You have ${fact.owned}`}</span>}
      <span className="mt-4 civr-btn civr-btn-primary w-full pointer-events-none">Choose</span>
    </button>
  );
}

// Step 1: one question, one answer.
export function KindPicker({ facts, onPick }) {
  return (
    <section className="civr-rise" data-testid="buy-kind-picker">
      <h2 className="text-lg font-semibold">What is the number for?</h2>
      <p className="text-sm text-[var(--c-muted)] mt-1 mb-4">Pick one. You can come back and get another kind any time.</p>
      <div className="grid md:grid-cols-3 gap-4">{KINDS.map(k => <KindCard key={k.id} k={k} fact={facts[k.id]} onPick={onPick} />)}</div>
    </section>
  );
}

// Step 1, answered: one line with a way back.
export function KindChosen({ kind, onChange }) {
  return (
    <div className="civr-card p-4 mb-6 flex flex-wrap items-center gap-3" data-testid="buy-kind-chosen">
      <span className="w-8 h-8 rounded-full bg-[#34d399] text-[#052e1f] grid place-items-center shrink-0"><Check className="w-4 h-4" /></span>
      <span className="font-semibold" data-testid="buy-kind-chosen-name">{kind.name}</span>
      <CapBadges caps={kind.caps} />
      <span className="flex-1" />
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onChange} data-testid="buy-kind-change">Change</button>
    </div>
  );
}
