import React from 'react';
import { PROOF } from './ownerProof';

export function Quotes() {
  if (!PROOF.quotes?.length) return null;
  return (
    <section className="py-16 md:py-24" data-testid="proof-quotes">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 grid md:grid-cols-3 gap-6">
        {PROOF.quotes.slice(0, 3).map((q, i) => (
          <figure key={i} className="v2-surface p-8" data-testid={`proof-quote-${i}`}><blockquote className="text-lg leading-relaxed">{`“${q.text}”`}</blockquote><figcaption className="v2-muted text-sm mt-5">{`${q.name} · ${q.role}, ${q.company}`}</figcaption></figure>
        ))}
      </div>
    </section>
  );
}
