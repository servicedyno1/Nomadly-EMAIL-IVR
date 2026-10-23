import React from 'react';

// Shared building blocks for the landing page.
export const ART = { callflow: '/civr/callflow.webp', campaign: '/civr/campaign.webp', globe: '/civr/globe.webp' };

// Button label that slides up to a copy of itself on hover.
export const Slide = ({ children }) => <span className="civr-l-slide"><span>{children}</span><span aria-hidden="true">{children}</span></span>;

export function SectionHead({ n, label, title, sub, testid }) {
  return (
    <div className="max-w-3xl" data-testid={testid}>
      <div className="civr-l-eyebrow">[ {n} ] {label}</div>
      <h2 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl mt-5">{title}</h2>
      {sub && <p className="text-base md:text-lg civr-l-muted mt-5 max-w-2xl">{sub}</p>}
    </div>
  );
}

// "BTC, LTC, ETH, USDT and more" from the catalog's coin list.
export const coinList = (c) => {
  const s = [...new Set((c?.coins || []).map(x => x.replace(/\s*\(.*\)/, '')))];
  return s.length > 4 ? `${s.slice(0, 4).join(', ')} and more` : s.join(', ');
};
export const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');

// Which plans include a feature, e.g. "Every plan", "Pro and up", "Business plan only".
export function planBadge(plans, key) {
  const ps = [...(plans || [])].sort((a, b) => a.price - b.price);
  if (!ps.length) return null;
  const ok = key ? ps.filter(p => p.access?.[key]) : ps;
  if (ok.length === ps.length) return 'Every plan';
  return ok.length === 1 ? `${ok[0].name} plan only` : `${ok[0].name} and up`;
}
