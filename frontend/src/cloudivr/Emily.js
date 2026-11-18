import React, { useEffect, useState } from 'react';
import { ChevronDown, SlidersHorizontal, Sparkles } from 'lucide-react';

const EVT = 'civr:emily';
const modeKey = (screen) => `civr-assist-mode-${screen}`;
const readMode = (screen) => { try { return localStorage.getItem(modeKey(screen)) || 'chat'; } catch (_) { return 'chat'; } };
export const emilyEvent = (type, screen) => window.dispatchEvent(new CustomEvent(EVT, { detail: { type, screen } }));

// Chat / Manual choice per setup screen, shared by Emily's panel and the folded form under it.
export function useEmilyMode(screen) {
  const [mode, setModeState] = useState(() => readMode(screen));
  useEffect(() => {
    const on = (e) => { if (e.detail?.screen === screen && e.detail.type === 'mode') setModeState(readMode(screen)); };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, [screen]);
  const setMode = (m) => { try { localStorage.setItem(modeKey(screen), m); } catch (_) { /* private mode */ } setModeState(m); emilyEvent('mode', screen); };
  return [mode, setMode];
}

export const EmilyFace = ({ className = 'w-9 h-9' }) => (
  <span className={`shrink-0 rounded-full civr-assist-icon grid place-items-center relative ${className}`} aria-hidden="true" data-testid="emily-avatar">
    <Sparkles className="w-4 h-4" /><span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#34d399] border-2 border-[var(--c-card)]" />
  </span>
);

// Save pressed with required details empty: unfold the form, name what's missing and jump to the first gap.
// checks: [[filled, label, testid]] → an Error to show (or null when everything is there).
export function missingFields(screen, checks) {
  const miss = checks.filter(([ok]) => !ok);
  if (!miss.length) return null;
  emilyEvent('applied', screen);
  setTimeout(() => {
    miss.forEach(([, , id]) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return; el.classList.add('civr-missing'); const off = () => { el.classList.remove('civr-missing'); el.removeEventListener('input', off); el.removeEventListener('change', off); }; el.addEventListener('input', off); el.addEventListener('change', off); });
    const first = document.querySelector(`[data-testid="${miss[0][2]}"]`);
    if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); first.focus?.({ preventScroll: true }); }
  }, 60);
  const names = miss.map(m => m[1]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return Object.assign(new Error(`Almost there — add ${list} before saving. We opened the form and marked ${names.length > 1 ? 'them' : 'it'} for you.`), { code: 'missing_fields', missing: names });
}

// The detailed settings under Emily: folded while chatting, opened by the customer or as soon as Emily fills them in.
// `open` (optional) starts it unfolded, e.g. when there is already a saved setup to look at. `off` shows the form plainly.
export function FormFold({ screen, open: startOpen = false, off = false, label = 'Review or edit the details yourself', children, testid }) {
  const [mode] = useEmilyMode(screen);
  const [open, setOpen] = useState(startOpen);
  const id = testid || `fold-${screen}`;
  useEffect(() => {
    const on = (e) => { if (e.detail?.screen === screen && e.detail.type === 'applied') setOpen(true); };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, [screen]);
  if (mode !== 'chat' || off) return <>{children}</>;
  return (
    <div className="civr-fold" data-testid={id} data-open={open ? 'yes' : 'no'}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="civr-fold-toggle w-full flex items-center gap-3 text-left min-h-[48px] px-4 rounded-xl border border-[var(--c-border)] hover:bg-[var(--c-card-hover)] transition-colors" data-testid={`${id}-toggle`}>
        <SlidersHorizontal className="w-4 h-4 text-[var(--c-accent)] shrink-0" />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <ChevronDown className={`w-4 h-4 text-[var(--c-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Kept mounted so form state, validation and saving work the same while folded. */}
      <div className={open ? 'pt-6 space-y-6' : 'hidden'} data-testid={`${id}-body`}>{children}</div>
    </div>
  );
}
