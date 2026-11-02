import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Star, X, Loader2, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi } from '../../api';
import { cp } from '../../paths';
import { useShell } from '../../Shell';
import { suggestionsFor } from '../../purpose';

// Overview: one slim, dismissible line of next steps picked from the onboarding purposes. Bring it back in Settings.
export function ForYou() {
  const { onboarding, setOnboarding } = useShell();
  const recs = suggestionsFor(onboarding?.purposes);
  const change = () => setOnboarding({ ...onboarding, onboarded: false });
  if (!onboarding || onboarding.suggestionsHidden) return null;
  const hide = () => {
    setOnboarding({ ...onboarding, suggestionsHidden: true });
    api('/prefs/suggestions', { method: 'PUT', body: { hidden: true } }).then(() => toast('Suggestions hidden. You can turn them back on in Settings.')).catch(e => { setOnboarding({ ...onboarding, suggestionsHidden: false }); toast.error(e.message); });
  };
  return (
    <div className="mb-6 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm border-b border-[#1f1f1f] pb-3 civr-rise" data-testid="dashboard-for-you">
      <span className="text-[#a1a1aa] inline-flex items-center gap-1.5"><Lightbulb className="w-4 h-4 text-[#818cf8]" />Suggested</span>
      {recs.length ? recs.map(([label, to], i) => (
        <Link key={to} to={cp(to)} className="font-medium text-[var(--c-text,#f4f4f5)] hover:text-[#818cf8] inline-flex items-center gap-1 min-h-[36px]" data-testid={`dashboard-for-you-${i}`}>{label}<ArrowRight className="w-3.5 h-3.5 opacity-60" /></Link>
      )) : <button type="button" className="text-[var(--c-text,#f4f4f5)] hover:text-[#818cf8] min-h-[36px]" onClick={change} data-testid="dashboard-for-you-start">Tell us what you use CloudIVR for</button>}
      <span className="ml-auto flex items-center gap-1">
        {recs.length > 0 && <button type="button" className="text-xs text-[#a1a1aa] hover:underline min-h-[36px] px-1" onClick={change} data-testid="dashboard-for-you-change">Change</button>}
        <button type="button" onClick={hide} className="w-9 h-9 grid place-items-center rounded-full text-[#a1a1aa] hover:text-[var(--c-text,#f4f4f5)]" aria-label="Hide suggestions" data-testid="dashboard-for-you-dismiss"><X className="w-4 h-4" /></button>
      </span>
    </div>
  );
}

// Asks for a review once a call on your number was answered. 4–5 stars with text show on the landing page.
export function ReviewPrompt() {
  const { data, setData } = useApi('/reviews/mine');
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data?.eligible) return null;
  const close = () => { setData({ ...data, eligible: false }); api('/reviews/dismiss', { method: 'POST', body: {} }).catch(() => {}); };
  const send = async () => {
    setBusy(true);
    try { await api('/reviews', { method: 'POST', body: { rating, text, name } }); toast.success('Thank you for your review!'); setData({ ...data, eligible: false }); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-5 md:p-6 mb-6 civr-rise relative" data-testid="review-prompt">
      <button type="button" onClick={close} className="absolute top-3 right-3 w-9 h-9 grid place-items-center text-[#a1a1aa] hover:text-white" aria-label="Not now" data-testid="review-dismiss"><X className="w-4 h-4" /></button>
      <div className="font-semibold text-lg">Your first call is done — how is CloudIVR so far?</div>
      <div className="flex gap-1 mt-3" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(k => <button key={k} type="button" role="radio" aria-checked={rating === k} aria-label={`${k} star${k > 1 ? 's' : ''}`} onClick={() => setRating(k)} className="w-10 h-10 grid place-items-center transition-transform hover:scale-110" data-testid={`review-star-${k}`}><Star className={`w-7 h-7 ${k <= rating ? 'fill-[#fbbf24] text-[#fbbf24]' : 'text-[#52525b]'}`} /></button>)}
      </div>
      {rating > 0 && (
        <div className="mt-3 grid gap-2 max-w-xl civr-rise">
          <textarea className="civr-input" rows={3} maxLength={280} value={text} onChange={e => setText(e.target.value)} placeholder={rating >= 4 ? 'What do you like most? (may appear on our website)' : 'What should we improve?'} data-testid="review-text" />
          <input className="civr-input" maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="Your name (shown as first name + initial)" data-testid="review-name" />
          <div><button type="button" className="civr-btn civr-btn-primary" disabled={busy} onClick={send} data-testid="review-submit">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send review</button></div>
        </div>
      )}
    </div>
  );
}
