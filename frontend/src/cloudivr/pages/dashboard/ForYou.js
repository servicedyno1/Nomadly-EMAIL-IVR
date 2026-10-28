import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Star, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi } from '../../api';
import { cp } from '../../paths';
import { useShell } from '../../Shell';
import { suggestionsFor } from '../../purpose';

// Overview: the 3 next steps picked from the onboarding purposes.
export function ForYou() {
  const { onboarding, setOnboarding } = useShell();
  const recs = suggestionsFor(onboarding?.purposes);
  const change = () => setOnboarding({ ...onboarding, onboarded: false });
  if (!onboarding) return null;
  if (!recs.length) return <button type="button" className="text-sm text-[#a1a1aa] hover:underline mb-4 min-h-[44px]" onClick={change} data-testid="dashboard-for-you-start">Tell us what you use CloudIVR for — we’ll put the right tools first</button>;
  return (
    <div className="mb-6" data-testid="dashboard-for-you">
      <div className="flex items-center justify-between gap-3 mb-3"><div className="civr-label">Recommended for you</div><button type="button" className="text-xs text-[#a1a1aa] hover:underline min-h-[44px]" onClick={change} data-testid="dashboard-for-you-change">Change what I use CloudIVR for</button></div>
      <div className="grid md:grid-cols-3 gap-3">
        {recs.map(([label, to], i) => (
          <Link key={to} to={cp(to)} className="civr-card civr-card-link p-4 flex items-center gap-3 civr-rise" style={{ animationDelay: `${i * 60}ms` }} data-testid={`dashboard-for-you-${i}`}>
            <span className="w-8 h-8 rounded-full border-2 border-[#818cf8] text-[#818cf8] grid place-items-center text-sm font-semibold shrink-0">{i + 1}</span>
            <span className="flex-1 font-semibold">{label}</span><ArrowRight className="w-4 h-4 text-[#a1a1aa]" />
          </Link>
        ))}
      </div>
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
