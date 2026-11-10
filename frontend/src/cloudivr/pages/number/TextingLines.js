import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText, ChevronRight } from 'lucide-react';
import { useApi, day, money, enc } from '../../api';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';
import { STATUS } from '../texting/NumberPanel';

export const LIVE_TEXTING = ['verify', 'loa', 'documents', 'admin_docs', 'review', 'active', 'paused'];

const billText = (t) => (t.status !== 'active' && t.status !== 'paused' ? 'Billing starts once texting is on'
  : t.planNumber ? `Included with your plan on ${t.planNumber} · no monthly fee`
  : t.nextBillAt ? `Next bill ${day(t.nextBillAt)} · ${money(t.monthly)}/month` : `${money(t.monthly)}/month`);

function TextingLine({ t, pv }) {
  const s = STATUS[t.status] || { label: t.status };
  return (
    <Link to={cp(`/app/texting?id=${enc(t.id)}`)} className="civr-card p-5 flex items-center gap-4 hover:border-[#818cf8]/50 transition-colors" data-testid={`texting-line-${t.id}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg" data-no-translate data-testid={`texting-line-number-${t.id}`}>{pv.phone(t.phoneNumber)}</span>
          <span className="civr-pill">Landline to Texting</span>
        </div>
        <div className={`text-sm ${s.tone || ''}`} data-testid={`texting-line-status-${t.id}`}>{s.label}</div>
        <div className="text-xs text-[var(--c-muted)]" data-testid={`texting-line-bill-${t.id}`}>{billText(t)}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--c-muted)] shrink-0" />
    </Link>
  );
}

// My numbers: Landline to Texting numbers in their own section, below calling and mobile numbers.
export function TextingLines() {
  const pv = usePrivacy();
  const { data } = useApi('/hosted-sms');
  const items = (data?.items || []).filter(t => LIVE_TEXTING.includes(t.status));
  if (!items.length) return null;
  return (
    <section className="mt-10" data-testid="texting-lines">
      <div className="flex items-center gap-3 mb-4">
        <MessageSquareText className="w-5 h-5 text-[#818cf8]" />
        <h2 className="font-display text-xl font-bold">Landline to Texting</h2>
        <Link to={cp('/app/texting')} className="text-sm text-[var(--c-muted)] hover:text-[#818cf8] ml-auto" data-testid="texting-lines-open">Open texting</Link>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{items.map(t => <TextingLine key={t.id} t={t} pv={pv} />)}</div>
    </section>
  );
}
