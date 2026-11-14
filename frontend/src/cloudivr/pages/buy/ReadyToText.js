import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText, Phone } from 'lucide-react';
import { useApi } from '../../api';
import { cp } from '../../paths';

// Numbers that text with no approval (no ID, no US registration), sold at the Texting plan price.
export function ReadyToText() {
  const { data } = useApi('/texting/ready');
  if (!data?.items?.length) return null;
  return (
    <div className="civr-card p-6 space-y-4" data-testid="ready-to-text">
      <div><div className="font-display text-xl font-bold">Ready-to-text numbers</div>
        <p className="text-sm text-[var(--c-muted)] mt-1">Send and receive texts the day you buy — no ID check and no carrier registration. Calls work too. {data.price ? `$${data.price}/month on the Starter plan.` : 'Starter plan.'}</p></div>
      <div className="flex flex-wrap gap-2">
        {data.items.map(it => (
          <Link key={`${it.country}-${it.type}`} to={cp(`/app/buy?purpose=voice&country=${it.country}&type=${it.type}&plan=${data.plan}`)} className="civr-btn civr-btn-ghost" data-testid={`ready-to-text-${it.country}-${it.type}`}>
            <span>{it.flag}</span>{it.name} · {it.typeName}<MessageSquareText className="w-3.5 h-3.5 text-[#34d399]" />{it.caps.voice && <Phone className="w-3.5 h-3.5 text-[#818cf8]" />}
          </Link>
        ))}
      </div>
    </div>
  );
}
