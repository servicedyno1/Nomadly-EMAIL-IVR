import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { money, useApi } from '../../api';
import { cp } from '../../paths';

// Order shortcut for the Texting Number, hidden once the account has one.
export function TextingNumberCta({ testid = 'texting-number-cta', className = '' }) {
  const { data } = useApi('/mobile-numbers');
  if (!data?.available || data.items?.some(x => x.status !== 'failed' && x.status !== 'cancelled')) return null;
  return (
    <div className={`civr-card p-5 flex flex-wrap items-center gap-4 ${className}`} data-testid={testid}>
      <MessageSquare className="w-6 h-6 text-[#818cf8]" />
      <div className="flex-1 min-w-[220px]">
        <div className="font-semibold">Send and receive texts in CloudIVR</div>
        <div className="text-sm text-[var(--c-muted)] mt-0.5">{`Get a Texting Number: a USA number for texts and verification codes, right in Messages. ${money(data.price)}/month.`}</div>
      </div>
      <Link to={cp('/app/texting-number')} className="civr-btn civr-btn-primary" data-testid={`${testid}-order`}>Order a Texting Number<ArrowRight className="w-4 h-4" /></Link>
    </div>
  );
}
