import React, { useEffect, useState } from 'react';
import { useApi } from '../../api';
import { MobileOffer } from '../buy/MobileOffer';
import { Plus, X, Repeat } from 'lucide-react';
import { smsOver, smsCount, smsParts } from '../../smsLimit';

const shown = (x) => ['provisioning', 'active', 'suspended'].includes(x.status);
const nameOf = (x) => `${x.phoneNumber || 'Number coming'} · ${x.kind === 'mobile' ? 'Texting Number' : 'USA eSIM'}${x.status === 'active' ? '' : x.status === 'provisioning' ? ' (being assigned)' : ' (paused)'}`;

// IVR key that texts the caller from one of the owner's eSIM / mobile numbers; no number → buy one right here.
export function IvrSms({ o, set, prefix, hideText }) {
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
          {!buying ? <button type="button" onClick={() => setBuying(true)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${prefix}-sms-buy`}>Order a Texting Number</button>
            : mn.data.available ? <MobileOffer onBought={bought} open /> : <p className="text-sm text-[#fbbf24]" data-testid={`${prefix}-sms-unavailable`}>Texting Numbers are temporarily unavailable. Try again later.</p>}
        </div>
      ) : (
        <select className="civr-input font-mono" value={o.smsFrom || ''} onChange={e => set({ smsFrom: e.target.value })} aria-label="Send the text from" data-testid={`${prefix}-sms-from`}>
          {lines.map(x => <option key={x.id} value={x.id}>{nameOf(x)}</option>)}
        </select>
      )}
      {!hideText && <SmsVersions o={o} set={set} prefix={prefix} />}
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

// One text, or up to 5 versions that rotate: each caller gets the next one in turn.
function SmsVersions({ o, set, prefix }) {
  const list = o.smsTexts?.length > 1 ? o.smsTexts : [o.smsText || ''];
  const put = (l) => set({ smsTexts: l.length > 1 ? l : undefined, smsText: l[0] || '' });
  const many = list.length > 1;
  return (
    <div className="space-y-2" data-testid={`${prefix}-sms-versions`}>
      {many && <div className="flex items-center gap-1.5 text-xs text-[var(--c-accent)]" data-testid={`${prefix}-sms-rotate-note`}><Repeat className="w-3.5 h-3.5" />{`Rotating ${list.length} versions — each caller gets the next one in turn.`}</div>}
      {list.map((t, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-start gap-2">
            {many && <span className="font-mono text-xs text-[var(--c-muted)] w-5 pt-2.5">{String.fromCharCode(65 + i)}</span>}
            <textarea rows={2} maxLength={600} className={`civr-input flex-1 ${smsOver(t) ? '!border-red-500' : ''}`} value={t} onChange={e => put(list.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i ? 'Another version of the text' : 'Text to send the caller, e.g. Here is our address: …'} data-testid={i ? `${prefix}-sms-text-${i}` : `${prefix}-sms-text`} />
            {many && <button type="button" onClick={() => put(list.filter((_, j) => j !== i))} className="p-2 text-[var(--c-muted)] hover:text-[#fb7185]" aria-label={`Remove version ${String.fromCharCode(65 + i)}`} data-testid={`${prefix}-sms-remove-${i}`}><X className="w-4 h-4" /></button>}
          </div>
          <div className="text-xs text-[var(--c-muted)]" data-testid={i ? `${prefix}-sms-count-${i}` : `${prefix}-sms-count`}><span className={smsOver(t) ? 'text-red-500 font-semibold' : ''}>{smsCount(t)}{smsOver(t) ? ' · too long: shorten it to 3 joined texts' : ''}</span>{` · $${(0.05 * smsParts(t)).toFixed(2)} from your wallet for each text${smsParts(t) > 1 ? ` (${smsParts(t)} parts)` : ''}`}</div>
        </div>
      ))}
      {list.length < 5 && <button type="button" onClick={() => put([...list, ''])} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${prefix}-sms-add-version`}><Plus className="w-4 h-4" />{many ? 'Add another version' : 'Add a version to rotate'}</button>}
    </div>
  );
}
