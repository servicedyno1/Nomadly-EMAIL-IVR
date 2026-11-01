import React, { useEffect, useState } from 'react';
import { useApi } from '../../api';
import { MobileOffer } from '../buy/MobileOffer';

const shown = (x) => ['provisioning', 'active', 'suspended'].includes(x.status);
const nameOf = (x) => `${x.phoneNumber || 'Number coming'} · ${x.kind === 'mobile' ? 'Mobile number' : 'CloudIVR eSIM'}${x.status === 'active' ? '' : x.status === 'provisioning' ? ' (being assigned)' : ' (paused)'}`;

// IVR key that texts the caller from one of the owner's eSIM / mobile numbers; no number → buy one right here.
export function IvrSms({ o, set, prefix }) {
  const es = useApi('/esim'), mn = useApi('/mobile-numbers');
  const [buying, setBuying] = useState(false);
  const lines = [...(es.data?.items || []), ...(mn.data?.items || [])].filter(shown);
  const loaded = es.data && mn.data;
  const first = lines[0]?.id;
  const known = lines.some(x => x.id === o.smsFrom);
  useEffect(() => { if (loaded && first && !known) set({ smsFrom: first }); }, [loaded, first, known]); // eslint-disable-line react-hooks/exhaustive-deps
  const bought = () => { setBuying(false); mn.reload(); };
  return (
    <div className="space-y-2" data-testid={`${prefix}-sms`}>
      {loaded && !lines.length ? (
        <div className="space-y-2" data-testid={`${prefix}-sms-none`}>
          <p className="text-sm text-[var(--c-muted)]">You need a texting number to send texts to callers. Texts go to US callers only.</p>
          {!buying ? <button type="button" onClick={() => setBuying(true)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${prefix}-sms-buy`}>Get a US mobile number</button>
            : mn.data.available ? <MobileOffer onBought={bought} open /> : <p className="text-sm text-[#fbbf24]" data-testid={`${prefix}-sms-unavailable`}>US mobile numbers are temporarily unavailable. Try again later.</p>}
        </div>
      ) : (
        <select className="civr-input font-mono" value={o.smsFrom || ''} onChange={e => set({ smsFrom: e.target.value })} aria-label="Send the text from" data-testid={`${prefix}-sms-from`}>
          {lines.map(x => <option key={x.id} value={x.id}>{nameOf(x)}</option>)}
        </select>
      )}
      <textarea rows={2} maxLength={1000} className="civr-input" value={o.smsText || ''} onChange={e => set({ smsText: e.target.value })} placeholder="Text to send the caller, e.g. Here is our address: …" data-testid={`${prefix}-sms-text`} />
      <div className="text-xs text-[var(--c-muted)]" data-testid={`${prefix}-sms-count`}>{`${(o.smsText || '').length}/1000 · $0.05 from your wallet for each text`}</div>
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
