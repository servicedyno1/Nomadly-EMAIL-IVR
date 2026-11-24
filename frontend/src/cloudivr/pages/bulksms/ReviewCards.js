import React, { useState } from 'react';
import { toast } from 'sonner';
import { Star, MailQuestion } from 'lucide-react';
import { api } from '../../api';

const ARRIVED = [['yes', 'Yes, it arrived'], ['spam', 'In spam'], ['no', "Didn't arrive"], ['not_sure', 'Not sure']];

// Same review as the bot: single texts → "did it arrive?" + stars (needed before the next single text); campaigns → stars.
export function ReviewCards({ reviews, onDone }) {
  if (!reviews?.length) return null;
  return <div className="space-y-3 mb-6" data-testid="bulksms-reviews">{reviews.map(r => <ReviewCard key={r.id} r={r} onDone={onDone} />)}</div>;
}

function ReviewCard({ r, onDone }) {
  const [arrived, setArrived] = useState(r.arrived);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const single = r.kind !== 'campaign';
  const post = async (body) => { setBusy(true); try { await api(`/bulksms/reviews/${r.id}`, { method: 'POST', body }); return true; } catch (e) { toast.error(e.message); return false; } finally { setBusy(false); } };
  const pickArrived = async (a) => { if (await post({ arrived: a })) setArrived(a); };
  const send = async () => { if (await post({ stars, ...(comment.trim() ? { comment } : {}) })) { toast.success('Thanks for the review'); onDone(); } };
  return (
    <div className="civr-card p-5 border border-[#818cf8]/40" data-testid={`bulksms-review-${r.id}`}>
      <div className="flex items-start gap-3">
        <MailQuestion className="w-5 h-5 text-[#818cf8] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{single ? `Did your text to ${r.to} arrive?` : `How did “${r.name}” go?`}</div>
          <p className="text-sm text-[var(--c-muted)] mt-1">{single ? 'Answer to keep sending single texts — it also tells us if a line needs fixing.' : 'Your rating helps us keep delivery high.'}</p>
          {single && !arrived && (
            <div className="flex flex-wrap gap-2 mt-3">{ARRIVED.map(([k, l]) => <button key={k} type="button" disabled={busy} onClick={() => pickArrived(k)} className="civr-btn civr-btn-sm" data-testid={`bulksms-review-arrived-${k}`}>{l}</button>)}</div>
          )}
          {(!single || arrived) && (
            <div className="mt-3 space-y-3">
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setStars(n)} aria-label={`${n} stars`} className="p-1 transition-transform hover:scale-110" data-testid={`bulksms-review-star-${n}`}>
                  <Star className={`w-6 h-6 ${n <= stars ? 'fill-[#fbbf24] text-[#fbbf24]' : 'text-[#52525b]'}`} />
                </button>))}
              </div>
              <input className="civr-input w-full" placeholder="Anything to add? (optional)" value={comment} onChange={e => setComment(e.target.value)} data-testid="bulksms-review-comment" />
              <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={!stars || busy} onClick={send} data-testid="bulksms-review-send">Send review</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
