import React from 'react';
import { MessageSquare } from 'lucide-react';
import { money } from '../../api';
import { Toggle } from '../../ui';

// Optional Texting Number bought in the same checkout as the Business Line, first month at the bundle price.
export function TextingAddOn({ offer, value, onChange }) {
  if (!offer?.available) return null;
  const zipBad = value.on && !/^\d{5}$/.test(value.zip);
  return (
    <div className="mt-6 rounded-xl border border-[var(--c-border,#27272a)] p-4" data-testid="checkout-texting-addon">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 mt-0.5 text-[#818cf8] shrink-0" />
        <div className="flex-1">
          <div className="font-semibold text-sm">Add a Texting Number</div>
          <div className="text-xs text-[var(--c-muted)] mt-0.5">{`Send and receive texts in Messages, including verification codes. ${money(offer.bundlePrice)} for the first month when bought together (${offer.bundlePct}% off), then ${money(offer.price)}/month.`}</div>
        </div>
        <Toggle checked={value.on} onChange={on => onChange({ ...value, on })} testid="checkout-texting-toggle" label="Add a Texting Number" />
      </div>
      {value.on && (
        <div className="mt-3 pl-8">
          <label className="text-xs text-[var(--c-muted)] block mb-1" htmlFor="checkout-texting-zip">USA ZIP code for the Texting Number</label>
          <input id="checkout-texting-zip" className="civr-input font-mono !h-10 max-w-[160px]" inputMode="numeric" maxLength={5} placeholder="e.g. 10011" value={value.zip} onChange={e => onChange({ ...value, zip: e.target.value.replace(/\D/g, '') })} data-testid="checkout-texting-zip" />
          {zipBad && value.zip.length > 0 && <div className="text-xs text-[#fbbf24] mt-1" data-testid="checkout-texting-zip-error">Enter a 5-digit ZIP code.</div>}
        </div>
      )}
    </div>
  );
}
