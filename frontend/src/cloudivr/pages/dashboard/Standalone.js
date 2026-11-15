import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ShieldCheck, Printer, Plane, Smartphone, ScanSearch, Plus, ArrowUpRight } from 'lucide-react';
import { useApi } from '../../api';
import { cp } from '../../paths';

// Bought on their own, outside any calling plan. [key, label, Icon, path, price, count key]
const SERVICES = [
  ['usa-texting', 'USA Texting Number', MessageSquare, 'texting-number', '$50/mo, unlimited texts', 'mobile'],
  ['landline-texting', 'Landline texting & 10DLC', ShieldCheck, 'texting', '$49 once + carrier fees', 'texting'],
  ['fax', 'Fax number', Printer, 'fax', '$9/mo', 'fax'],
  ['travel-esim', 'Travel eSIM', Plane, 'travel-esim', 'Priced per country', 'travel'],
  ['usa-esim', 'USA eSIM', Smartphone, 'esim', 'Monthly', 'esim'],
  ['lookup', 'Number & email lookup', ScanSearch, 'lookup', 'From $0.0015 per check', null],
];

export function Standalone({ summary }) {
  const { data: fax } = useApi('/fax');
  const { data: travel } = useApi('/travel-esim/orders');
  const { data: esim } = useApi('/esim');
  const counts = {
    mobile: summary?.numbers?.mobile || 0, texting: summary?.numbers?.texting || 0,
    fax: (fax?.numbers || []).filter(n => ['active', 'suspended'].includes(n.status)).length,
    travel: (travel?.orders || []).filter(o => o.status === 'active').length,
    esim: (esim?.items || []).filter(x => x.kind !== 'mobile' && ['provisioning', 'awaiting_imei', 'active', 'suspended'].includes(x.status)).length,
  };
  return (
    <section className="mt-10" data-testid="standalone-services-section">
      <h2 className="font-display text-xl font-bold">Standalone services</h2>
      <p className="text-sm text-[var(--c-muted)] mt-1">Bought separately from your plan and paid from the same wallet.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {SERVICES.map(([key, label, Icon, to, price, ck], i) => {
          const n = ck ? counts[ck] : 0;
          return (
            <Link key={key} to={cp(`/app/${to}`)} className="civr-card civr-card-link p-5 flex items-center gap-4 civr-rise" style={{ animationDelay: `${i * 40}ms` }} data-testid={`standalone-service-card-${key}`}>
              <span className="civr-chip civr-chip-green civr-chip-lg" aria-hidden><Icon className="w-4 h-4" /></span>
              <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{label}</span><span className="block text-xs text-[var(--c-muted)]">{price}</span></span>
              {n > 0 ? <span className="civr-pill civr-pill-ok shrink-0" data-testid={`standalone-service-card-${key}-count`}>{`${n} active`}</span>
                : ck ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--c-accent)] shrink-0" data-testid={`standalone-service-card-${key}-add`}><Plus className="w-3.5 h-3.5" />Add</span>
                  : <ArrowUpRight className="w-4 h-4 text-[var(--c-muted)] shrink-0" />}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
