import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { enc } from '../../api';
import { cp } from '../../paths';

// What the customer told the plan helper, carried into setting up the number they bought.
const KEY = 'civr.setupIntent';
export const USE_PLAN = { calls: 'starter', menu: 'pro', campaigns: 'pro', ai: 'business' };
const STEPS = {
  menu: ['We prepared a “press 1 for sales” call menu for this number.', 'Review the call menu'],
  ai: ['We started an AI receptionist for this number.', 'Review the AI receptionist'],
  campaigns: ['Your first calling campaign is ready to set up with this number.', 'Start a campaign'],
};

export const saveIntent = (use, phone) => { try { localStorage.removeItem('civr.helperUse'); if (STEPS[use]) localStorage.setItem(KEY, JSON.stringify({ use, phone, at: Date.now() })); } catch (_) { /* ignore */ } };
// Helper answer picked on the website before signing up, so Get a Business Line starts with it.
const USE_KEY = 'civr.helperUse';
export const rememberUse = (use) => { try { localStorage.setItem(USE_KEY, JSON.stringify({ use, at: Date.now() })); } catch (_) { /* ignore */ } };
export const rememberedUse = () => { try { const x = JSON.parse(localStorage.getItem(USE_KEY) || 'null'); return x && USE_PLAN[x.use] && Date.now() - x.at < 7 * 86400000 ? x.use : null; } catch (_) { return null; } };
export const clearIntent = () => { try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } };
function readIntent(phone) {
  try {
    const x = JSON.parse(localStorage.getItem(KEY) || 'null');
    return x && STEPS[x.use] && Date.now() - x.at < 3 * 86400000 && (!x.phone || x.phone === phone) ? x : null;
  } catch (_) { return null; }
}

export function setupPath(use, phone) {
  const p = enc(phone);
  if (use === 'menu') return `/app/numbers/${p}?tab=ivr&prep=menu`;
  if (use === 'ai') return `/app/ai-agents/new?number=${p}&prep=1`;
  if (use === 'campaigns') return `/app/campaigns/new?callerId=${p}`;
  return `/app/numbers/${p}`;
}

// Shown on a newly bought number until the customer opens the prepared setup or dismisses it.
export function SetupIntentBanner({ phone }) {
  const [x, setX] = useState(() => readIntent(phone));
  if (!x) return null;
  const [text, cta] = STEPS[x.use];
  const done = () => { clearIntent(); setX(null); };
  return (
    <div className="civr-card p-4 mb-4 flex flex-wrap items-center gap-3" data-testid="setup-intent-banner">
      <Sparkles className="w-5 h-5 text-[#818cf8]" />
      <div className="flex-1 min-w-[200px] text-sm">{text} <span className="text-[var(--c-muted)]">Nothing goes live until you save it.</span></div>
      <Link to={cp(setupPath(x.use, phone))} onClick={done} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="setup-intent-open">{cta}</Link>
      <button type="button" onClick={done} className="p-1.5 text-[var(--c-muted)]" aria-label="Dismiss" data-testid="setup-intent-dismiss"><X className="w-4 h-4" /></button>
    </div>
  );
}
