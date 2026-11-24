import React, { useState } from 'react';
import { toast } from 'sonner';
import { Send, Loader2, Info } from 'lucide-react';
import { api, money } from '../../api';

// One-off text. Same rules as the bot: a few free intro texts, each reviewed before the next; then $1 a text with $20
// in the wallet. Lists of numbers sent one by one are refused and pointed to a campaign (cheaper and built for it).
export function SingleText({ data, onSent, hasReview }) {
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [optOut, setOptOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const s = data.single || {};
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/bulksms/send-one', { method: 'POST', body: { to, text, optOut } });
      toast.success(r.charged ? `Sent — ${money(r.charged)} charged, ${money(r.balance)} left` : 'Sent');
      setText(''); setTo(''); onSent();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-5 sm:p-6 space-y-4 max-w-2xl" data-testid="bulksms-single">
      <div className="flex items-start gap-2 text-sm" data-testid="bulksms-single-price">
        <Info className="w-4 h-4 mt-0.5 text-[#818cf8] shrink-0" />
        {s.paid ? <span>Single texts are {money(s.price)} each and need at least {money(s.minBalance)} in your wallet. Sending to many people? A <b>campaign</b> is {money(data.prices.plain)} a text.</span>
          : <span>{s.freeLeft ? `${s.freeLeft} free ${s.freeLeft === 1 ? 'text' : 'texts'} to try it — after each one we ask if it arrived.` : 'Your free texts are used.'} Then single texts are {money(1)} each — sending to many people? A <b>campaign</b> is {money(data.prices.plain)} a text.</span>}
      </div>
      {hasReview && <p className="text-sm text-[#fbbf24]" data-testid="bulksms-single-review-first">Please answer the review above — it keeps your texts arriving.</p>}
      <input className="civr-input w-full sm:w-72" placeholder="+1 USA / Canada mobile" value={to} onChange={e => setTo(e.target.value)} data-testid="bulksms-single-to" />
      <textarea className="civr-input w-full min-h-[110px]" maxLength={612} placeholder="Your message" value={text} onChange={e => setText(e.target.value)} data-testid="bulksms-single-text" />
      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={optOut} onChange={e => setOptOut(e.target.checked)} data-testid="bulksms-single-optout" />Add “Reply STOP to opt out”</label>
      {err && <p className="text-sm text-[#fb7185]" role="alert" data-testid="bulksms-single-error">{err}</p>}
      <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !to.trim() || !text.trim()} onClick={send} data-testid="bulksms-single-send">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send text</button>
    </div>
  );
}
