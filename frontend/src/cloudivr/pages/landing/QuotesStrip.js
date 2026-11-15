import React from 'react';
import { Star } from 'lucide-react';
import { useApi } from '../../api';

// One quiet row of real customer reviews under the hero; hidden until there is at least one.
export function QuotesStrip() {
  const { data } = useApi('/public/reviews');
  const list = (data?.reviews || []).filter(r => r.rating >= 4 && r.text).slice(0, 3);
  if (!list.length) return null;
  return (
    <section aria-label="What customers say" className="bg-white border-t border-slate-100" data-testid="quotes-strip">
      <ul className="max-w-7xl mx-auto px-6 md:px-8 py-8 grid gap-6 md:grid-cols-3">
        {list.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex flex-col gap-2" data-testid={`quote-${i}`}>
            <span className="flex gap-0.5 text-amber-500" aria-label={`${r.rating} out of 5 stars`}>{Array.from({ length: r.rating }).map((_, k) => <Star key={k} className="w-4 h-4 fill-current" aria-hidden="true" />)}</span>
            <q className="text-base text-slate-800 leading-relaxed line-clamp-2">{r.text}</q>
            <span className="text-sm text-slate-600" data-testid={`quote-${i}-name`}>{r.name || 'CloudIVR customer'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
