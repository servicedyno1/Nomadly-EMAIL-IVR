import React, { useEffect, useState } from 'react';
import { useApi } from '../../api';
import { MobileOffer } from '../buy/MobileOffer';
import { smsOver, smsCount, smsParts } from '../../smsLimit';

const shown = (x) => ['provisioning', 'active', 'suspended'].includes(x.status);
const nameOf = (x) => `${x.phoneNumber || 'Number coming'} · ${x.kind === 'mobile' ? 'USA mobile number' : 'USA eSIM'}${x.status === 'active' ? '' : x.status === 'provisioning' ? ' (being assigned)' : ' (paused)'}`;

// IVR key that texts the caller from one of the owner's eSIM / mobile numbers; no number → buy one right here.
export function IvrSms({ o, set, prefix }) {
  const mn = useApi('/mobile-numbers');
  const [buying, setBuying] = useState(false);
  const lines = (mn.data?.items || []).filter(shown);
  const loaded = !!mn.data;
  const first = lines[0]?.id;
  const known = lines.some(x => x.id === o.smsFrom);
  useEffect(() => { if (loaded && first && !known) set({ smsFrom: first }); }, [loaded, first, known]); // eslint-disable-line react-hooks/exhaustive-deps
  const bought = () => { setBuying(false); mn.reload(); };
  return (
    <div className="space-y-2" data-testid={`${prefix}-sms`}>
      {loaded && !lines.length ? (
        <div className="space-y-2" data-testid={`${prefix}-sms-none`}>
          <p className="text-sm text-[var(--c-muted)]">You need a texting number to send texts to callers. Texts go to USA callers only.</p>
          {!buying ? <button type="button" onClick={() => setBuying(true)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${prefix}-sms-buy`}>Get a USA mobile number</button>
            : mn.data.available ? <MobileOffer onBought={bought} open /> : <p className="text-sm text-[#fbbf24]" data-testid={`${prefix}-sms-unavailable`}>USA mobile numbers are temporarily unavailable. Try again later.</p>}
        </div>
      ) : (
        <select className="civr-input font-mono" value={o.smsFrom || ''} onChange={e => set({ smsFrom: e.target.value })} aria-label="Send the text from" data-testid={`${prefix}-sms-from`}>
          {lines.map(x => <option key={x.id} value={x.id}>{nameOf(x)}</option>)}
        </select>
      )}
      <textarea rows={2} maxLength={600} className={`civr-input ${smsOver(o.smsText) ? '!border-red-500' : ''}`} value={o.smsText || ''} onChange={e => set({ smsText: e.target.value })} placeholder="Text to send the caller, e.g. Here is our address: …" data-testid={`${prefix}-sms-text`} />
      <div className="text-xs text-[var(--c-muted)]" data-testid={`${prefix}-sms-count`}><span className={smsOver(o.smsText) ? 'text-red-500 font-semibold' : ''}>{smsCount(o.smsText)}{smsOver(o.smsText) ? ' · too long: shorten it to 3 joined texts' : ''}</span>{` · $${(0.05 * smsParts(o.smsText)).toFixed(2)} from your wallet for each text${smsParts(o.smsText) > 1 ? ` (${smsParts(o.smsText)} parts)` : ''}`}</div>
      <div className="grid md:grid-cols-2 gap-2">
        <input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Say after sending (default: We have sent you a text message.)" data-testid={`${prefix}-sms-say`} />
        <select className="civr-input" value={o.after || 'hangup'} onChange={e => set({ after: e.target.value })} aria-label="Then" data-testid={`${prefix}-sms-after`}>
          <option value="hangup">Then hang up</option>
          <option value="menu">Then play the menu again</option>
        </select>
      </div>
    </div>
  );
}
