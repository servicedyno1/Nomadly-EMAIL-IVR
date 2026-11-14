import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Captions, Globe, Printer, ScanSearch, Sparkles } from 'lucide-react';
import { cp } from '../../paths';
import { openWhatsNew } from '../../WhatsNew';

const ITEMS = [
  ['intl-texting', Globe, 'International Texting', '/app/international-texting'],
  ['lookup', ScanSearch, 'Number lookup', '/app/lookup'],
  ['text-call', Captions, 'Text-to-voice calls', '/app/text-call'],
  ['fax', Printer, 'Fax', '/app/fax'],
];

// Overview: one slim "What's new" strip with the newest products (replaces the old stack of promo cards).
export function NewProducts() {
  return (
    <div className="mt-6 mb-6 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm border-y border-[var(--c-border,#1f1f1f)] py-3 civr-rise" data-testid="dashboard-new-products">
      <span className="text-[#a1a1aa] inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-[#818cf8]" />New</span>
      {ITEMS.map(([id, Icon, title, to]) => (
        <Link key={id} to={cp(to)} className="font-medium text-[var(--c-text,#f4f4f5)] hover:text-[#818cf8] inline-flex items-center gap-1.5 min-h-[36px]" data-testid={`dashboard-product-${id}`}><Icon className="w-4 h-4 opacity-70" />{title}<ArrowRight className="w-3.5 h-3.5 opacity-60" /></Link>
      ))}
      <button type="button" onClick={openWhatsNew} className="ml-auto text-xs text-[#a1a1aa] hover:underline min-h-[36px] px-1" data-testid="dashboard-whats-new-button">See what’s new</button>
    </div>
  );
}
