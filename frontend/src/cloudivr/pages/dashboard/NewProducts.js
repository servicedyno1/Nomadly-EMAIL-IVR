import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Captions, MessageSquareText } from 'lucide-react';
import { cp } from '../../paths';

const ITEMS = [
  ['texting', MessageSquareText, 'Landline to Texting', 'Send and receive texts on the landline number you already have. $0.05 per text.', '/app/texting'],
  ['text-call', Captions, 'Text-to-voice calls', 'Type and a natural voice speaks for you; read what they say live.', '/app/text-call'],
];

// Overview: highlights the two newest products.
export function NewProducts() {
  return (
    <div className="grid md:grid-cols-2 gap-4 mb-6" data-testid="dashboard-new-products">
      {ITEMS.map(([id, Icon, title, sub, to]) => (
        <Link key={id} to={cp(to)} className="civr-card civr-card-link p-5 flex items-center gap-4 civr-rise" data-testid={`dashboard-product-${id}`}>
          <span className="w-11 h-11 rounded-xl bg-[#818cf8]/10 text-[#818cf8] flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{title}</span><span className="civr-pill civr-pill-on !text-[10px] !py-0 uppercase tracking-wider">New</span></div>
            <div className="text-sm text-[#a1a1aa] mt-0.5">{sub}</div>
          </div>
          <ArrowRight className="w-4 h-4 text-[#a1a1aa] shrink-0" />
        </Link>
      ))}
    </div>
  );
}
