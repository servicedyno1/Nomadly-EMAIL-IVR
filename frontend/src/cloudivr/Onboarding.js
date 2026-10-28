import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { api, useApi } from './api';
import { cp } from './paths';
import { PURPOSES, suggestionsFor } from './purpose';

// Shared onboarding state (purposes + per-number setup plans).
export function useOnboarding() { return useApi('/prefs/onboarding'); }

// First-run: "What will you use CloudIVR for?" → a tailored 3-step plan. Skippable.
export function Onboarding({ data, setData }) {
  const [pick, setPick] = useState([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const open = !!data && !data.onboarded;
  useEffect(() => { if (open) { setPick(data.purposes || []); setStep(0); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const save = async (purposes) => {
    setBusy(true);
    try { const d = await api('/prefs/onboarding', { method: 'PUT', body: { purposes } }); if (!purposes.length) setData({ ...data, ...d }); else { setSaved(d); setStep(1); } } catch { setData({ ...data, onboarded: true }); } finally { setBusy(false); }
  };
  const finish = () => setData({ ...data, ...saved, onboarded: true });
  const toggle = (id) => setPick(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const recs = suggestionsFor(pick);
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="onb-title" data-testid="onboarding">
      <div className="civr-card w-full max-w-2xl p-6 md:p-10 civr-rise max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-6" aria-hidden="true">{[0, 1].map(i => <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i <= step ? 'w-10 bg-[#6366f1]' : 'w-5 bg-[#3f3f46]'}`} />)}</div>
        {step === 0 ? (
          <>
            <h2 id="onb-title" className="civr-page-title text-3xl">What will you use CloudIVR for?</h2>
            <p className="text-[#a1a1aa] mt-2">Pick all that fit — we’ll put the right tools first. You can change this anytime from your Overview.</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-7" data-testid="onboarding-purposes">
              {PURPOSES.map(([id, Icon, label, sub], i) => {
                const on = pick.includes(id);
                return (
                  <button key={id} type="button" onClick={() => toggle(id)} aria-pressed={on} style={{ animationDelay: `${i * 50}ms` }}
                    className={`civr-rise text-left p-4 rounded-xl border-2 flex items-start gap-3 transition-colors ${on ? 'border-[#818cf8] bg-[#818cf8]/10' : 'border-[#262626] hover:border-[#3a3a3a]'}`} data-testid={`onboarding-purpose-${id}`}>
                    <span className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${on ? 'bg-[#6366f1] text-white' : 'bg-[#1f1f1f] text-[#818cf8]'}`}>{on ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}</span>
                    <span><span className="block font-semibold">{label}</span><span className="block text-sm text-[#a1a1aa]">{sub}</span></span>
                  </button>
                );
              })}
            </div>
            <div className="sticky -bottom-6 md:-bottom-10 -mx-6 md:-mx-10 px-6 md:px-10 py-4 mt-6 bg-[var(--c-card)] border-t border-[var(--c-border)] flex flex-wrap items-center justify-between gap-3">
              <button type="button" className="text-sm text-[#a1a1aa] hover:underline min-h-[44px]" onClick={() => save([])} disabled={busy} data-testid="onboarding-skip">Skip for now</button>
              <button type="button" className="civr-btn civr-btn-primary" disabled={!pick.length || busy} onClick={() => save(pick)} data-testid="onboarding-continue">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Continue <ArrowRight className="w-4 h-4" /></button>
            </div>
          </>
        ) : (
          <>
            <span className="w-12 h-12 rounded-full bg-[#34d399]/15 text-[#34d399] grid place-items-center civr-pop"><Sparkles className="w-6 h-6" /></span>
            <h2 id="onb-title" className="civr-page-title text-3xl mt-5">Your plan to get going</h2>
            <p className="text-[#a1a1aa] mt-2">Three steps picked for you. They also stay on your Overview and at the top of the menu.</p>
            <ol className="mt-7 space-y-3" data-testid="onboarding-plan">
              {recs.map(([label, to], i) => (
                <li key={to} className="civr-rise" style={{ animationDelay: `${i * 90}ms` }}>
                  <Link to={cp(to)} onClick={finish} className="civr-card civr-card-link p-4 flex items-center gap-4" data-testid={`onboarding-step-${i}`}>
                    <span className="w-8 h-8 rounded-full border-2 border-[#818cf8] text-[#818cf8] grid place-items-center font-semibold text-sm shrink-0">{i + 1}</span>
                    <span className="flex-1 font-semibold">{label}</span><ArrowRight className="w-4 h-4 text-[#a1a1aa]" />
                  </Link>
                </li>
              ))}
            </ol>
            <div className="flex justify-end mt-8"><button type="button" className="civr-btn civr-btn-ghost" onClick={finish} data-testid="onboarding-done">Go to my Overview</button></div>
          </>
        )}
      </div>
    </div>
  );
}

// Sidebar "For you" links, from the picked purposes.
export function ForYouNav({ purposes }) {
  const recs = suggestionsFor(purposes);
  if (!recs.length) return null;
  return (
    <div className="mb-6" data-testid="nav-group-for-you">
      <div className="civr-side-label px-3 mb-2 text-[11px] font-semibold uppercase tracking-widest text-[#a1a1aa]">For you</div>
      {recs.map(([label, to], i) => <Link key={to} to={cp(to)} className="civr-nav-link" data-testid={`nav-for-you-${i}`}><Sparkles className="w-4 h-4" />{label}</Link>)}
    </div>
  );
}
