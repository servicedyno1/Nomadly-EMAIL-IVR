import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Field, Toggle } from '../../ui';
import { useSave, TextingOffNote } from './SettingsTabs';
import { Assist } from '../../Assist';

const DEFAULT = 'Sorry we missed your call. We’ll call you back as soon as we can.';

// Opt-in: one text to callers whose call nobody answered (max one per caller per day).
export default function MissedTextBackTab({ num, reload }) {
  const cur = num.features?.missedTextBack || {};
  const [text, setText] = useState(cur.text || DEFAULT);
  const [save, busy] = useSave(num, 'missed-text-back', reload);
  const noSms = num.capabilities?.sms === false;
  const put = (enabled) => save({ enabled, text }, 'PUT', enabled ? 'Missed-call text is on' : 'Missed-call text is off');
  return (
    <div className="civr-card p-6 max-w-2xl space-y-6" data-testid="textback-card">
      <div>
        <div className="font-display text-2xl font-bold">Text back missed callers</div>
        <p className="text-sm text-[#a1a1aa] mt-1">When nobody answers, the caller gets one text from this number, at most once a day. Texts use your plan’s texts, then the extra-text rate. It only works once texting is approved on this number (US numbers also need the 10DLC registration).</p>
      </div>
      {!noSms && <TextingOffNote num={num} testid="textback-texting-off" />}
      {noSms ? <p className="text-sm text-[#fbbf24]" data-testid="textback-no-sms">This number can’t send texts.</p> : <>
        <div className="flex items-center justify-between gap-4"><span className="text-sm">Send a text after a missed call</span><Toggle checked={!!cur.enabled} disabled={busy} onChange={put} testid="textback-toggle" label="Send a text after a missed call" /></div>
        <Assist screen="textback" title="Write this text by chatting" hello="Tell me about your business — I’ll write a short, friendly text." examples={['Friendly text for a hair salon with our booking link', 'Shorter, and mention we reply within an hour', 'Write it in Spanish']} current={{ text }} onApply={(p) => { if (p.text !== undefined) setText(p.text); }} labels={{ text: 'Text' }} testid="textback-assist" />
        <Field label="Text" hint={`${text.length}/300`}><textarea rows={3} maxLength={300} className="civr-input" value={text} onChange={e => setText(e.target.value)} data-testid="textback-text-input" /></Field>
        <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => put(!!cur.enabled)} data-testid="textback-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save text</button>
      </>}
    </div>
  );
}
