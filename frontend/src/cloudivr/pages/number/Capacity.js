import React from 'react';
import { PhoneIncoming, PhoneOutgoing, MessageSquare, Printer, Clock } from 'lucide-react';

// What a line can really do, as colour-coded labels: calls in, calls out, texts, fax.
const ITEMS = [
  ['callsIn', 'Calls in', PhoneIncoming, 'var(--cap-in, #34d399)'],
  ['callsOut', 'Calls out', PhoneOutgoing, 'var(--cap-out, #60a5fa)'],
  ['texts', 'Texts', MessageSquare, 'var(--cap-text, #f472b6)'],
  ['fax', 'Fax', Printer, 'var(--cap-fax, #fbbf24)'],
];

export function Capacity({ capacity, testid }) {
  if (!capacity) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {ITEMS.filter(([k]) => capacity[k]).map(([k, label, Icon, color]) => {
        const pending = capacity[k] === 'pending';
        return (
          <span key={k} title={pending ? 'Outgoing calls switch on in a few minutes, once the carrier confirms this caller ID' : `${label} supported`}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium border transition-transform hover:-translate-y-px"
            style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 9%, transparent)` }} data-testid={`${testid}-${k}`}>
            {pending ? <Clock className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}{pending ? `${label} · setting up` : label}
          </span>
        );
      })}
    </div>
  );
}
