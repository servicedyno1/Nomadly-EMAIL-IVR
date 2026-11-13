import React from 'react';
import { Link } from 'react-router-dom';
import { Phone, Server, MessageSquare, Printer, Check, ArrowRight } from 'lucide-react';
import { money, useApi } from '../../api';
import { cp } from '../../paths';

export const PURPOSES = [
  ['voice', Phone, 'Voice', 'Calls, menus, voicemail, AI agent'],
  ['sip', Server, 'SIP', 'Connect a desk phone or softphone'],
  ['sms', MessageSquare, 'SMS', 'Send and receive texts'],
  ['fax', Printer, 'Fax', 'Send and receive faxes only'],
];

// What the number is for — several can be picked; each purpose gets the number type built for it.
export function PurposePicker({ value, onChange }) {
  const flip = (id) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div className="mb-6 civr-rise" data-testid="buy-purpose-picker">
      <div className="font-semibold mb-1">What do you need the number for?</div>
      <p className="text-sm text-[#a1a1aa] mb-3">Pick one or more. Voice and SIP share one Business Line; SMS and Fax each get their own number.</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {PURPOSES.map(([id, Icon, label, sub]) => {
          const on = value.includes(id);
          return (
            <button key={id} type="button" onClick={() => flip(id)} aria-pressed={on} data-testid={`buy-purpose-${id}`} data-selected={on ? 'true' : 'false'}
              className={`civr-card text-left p-4 transition-colors ${on ? 'civr-trace' : ''}`}>
              <div className="flex items-center justify-between"><Icon className="w-5 h-5 text-[#818cf8]" />{on && <Check className="w-4 h-4 text-[#818cf8]" />}</div>
              <div className="font-semibold mt-3">{label}</div>
              <div className="text-xs text-[#a1a1aa] mt-1">{sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// SMS purpose → the Texting Number (its own order page).
export function SmsPurposeCard() {
  const { data } = useApi('/mobile-numbers');
  const has = data?.items?.some(x => x.status !== 'failed' && x.status !== 'cancelled');
  return (
    <div className="civr-card p-5 mb-6 flex flex-wrap items-center gap-4" data-testid="buy-sms-card">
      <MessageSquare className="w-6 h-6 text-[#818cf8]" />
      <div className="flex-1 min-w-[220px]">
        <div className="font-semibold">SMS · Texting Number</div>
        <div className="text-sm text-[#a1a1aa] mt-0.5">{`A USA number for texts and verification codes, right in Messages.${data?.price ? ` ${money(data.price)}/month.` : ''}`}</div>
      </div>
      {data && !data.available && !has
        ? <span className="text-sm text-[#a1a1aa]" data-testid="buy-sms-unavailable">Not available right now</span>
        : <Link to={cp(has ? '/app/messages' : '/app/texting-number')} className="civr-btn civr-btn-primary" data-testid="buy-sms-order">{has ? 'Open Messages' : 'Order a Texting Number'}<ArrowRight className="w-4 h-4" /></Link>}
    </div>
  );
}
