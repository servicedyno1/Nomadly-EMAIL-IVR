import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Plus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api, enc } from './api';
import { useLang } from './i18n';
import { showUpgrade } from './Upgrade';
import { AudioAddDialog, EmptyAudio, useAudioAdd } from './AudioAdd';

// True on phone-sized screens (below Tailwind's md breakpoint); follows rotation/resizes.
export function useIsPhone(query = '(max-width: 767px)') {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const f = (e) => setM(e.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return m;
}

// Long lists: show the first `step` items, then `step` more per tap. `resetKey` (e.g. the active filter) starts over.
export function usePaged(items, step = 20, resetKey) {
  const [n, setN] = useState(step);
  useEffect(() => { setN(step); }, [step, resetKey]);
  const list = items || [];
  return { shown: list.slice(0, n), rest: Math.max(0, list.length - n), more: () => setN(v => v + step) };
}

export function ShowMore({ rest, onClick, testid = 'show-more-button' }) {
  if (!rest) return null;
  return <button type="button" onClick={onClick} className="civr-btn civr-btn-ghost civr-btn-sm w-full mt-4" data-testid={testid}>{`Show ${rest} more`}</button>;
}

// Scrolling tab row: scrolls only as far as needed to show the active tab (so the first tab isn't clipped when the row
// barely overflows); edge fades hint at more tabs on the left / right.
export function TabStrip({ active, children, className = 'mb-8', testid }) {
  const ref = useRef(null);
  const [end, setEnd] = useState(true);
  const [start, setStart] = useState(true);
  const { ver } = useLang() || {};
  const check = useCallback(() => { const s = ref.current; if (s) { setEnd(s.scrollLeft + s.clientWidth >= s.scrollWidth - 4); setStart(s.scrollLeft <= 4); } }, []);
  useEffect(() => {
    const s = ref.current, el = s?.querySelector('[aria-selected="true"]');
    if (s && el) {
      const sb = s.getBoundingClientRect(), eb = el.getBoundingClientRect(), pad = 24;
      if (eb.left < sb.left) s.scrollLeft -= sb.left - eb.left + pad;
      else if (eb.right > sb.right) s.scrollLeft += eb.right - sb.right + pad;
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [active, check, ver]);
  return (
    <div className={`civr-tabstrip ${end ? 'at-end' : ''} ${start ? 'at-start' : ''} ${className}`}>
      <div ref={ref} onScroll={check} className="civr-scroll-x flex gap-1 overflow-x-auto border-b border-[#1f1f1f]" role="tablist" data-testid={testid}>{children}</div>
    </div>
  );
}

export const Label = ({ children }) => <div className="civr-label mb-3">{children}</div>;

export function PageHeader({ label, title, sub, children, testid }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8 civr-rise" data-testid={testid}>
      <div className="min-w-0">
        {label && <Label>{label}</Label>}
        <h1 className="civr-page-title text-[28px] sm:text-[32px]" data-testid={testid ? `${testid}-title` : undefined}>{title}</h1>
        {sub && <p className="text-sm md:text-[15px] text-[#a1a1aa] mt-2 max-w-2xl">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-[#d4d4d8] mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[#a1a1aa] mt-1.5">{hint}</span>}
    </label>
  );
}

export function Spinner({ label = 'Loading…', testid = 'loading-indicator' }) {
  return <div className="flex items-center gap-2 text-sm text-[#a1a1aa] py-10" aria-busy="true" data-testid={testid}><Loader2 className="w-4 h-4 animate-spin" />{label}</div>;
}

// `onRetry` adds a "Try again" button (pass the page's reload).
export function ErrorNote({ error, testid = 'error-message', onRetry, className = '' }) {
  if (!error) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#fb7185] border border-[#fb7185]/30 bg-[#fb7185]/5 rounded-xl px-4 py-3 ${className}`} role="alert" data-testid={testid}>
      <span className="flex-1 min-w-0">{error.message || String(error)}</span>
      {onRetry && <button type="button" onClick={onRetry} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${testid}-retry-button`}><RotateCcw className="w-4 h-4" />Try again</button>}
    </div>
  );
}

// Dashed sheet with the page's icon on each line and a "+" badge.
function EmptyArt({ icon: Icon }) {
  return (
    <div className="civr-empty-art" aria-hidden="true" data-testid="empty-art">
      {[0, 1, 2].map(k => <i key={k}><Icon className="w-4 h-4 shrink-0" /></i>)}
      <span className="civr-empty-plus"><Plus className="w-5 h-5" /></span>
    </div>
  );
}

// Empty state: short line + next-step button(s) as children. `bare` drops the card (for use inside another card).
export function Empty({ icon: Icon, title, sub, children, testid, bare = false }) {
  return (
    <div className={`${bare ? 'py-12' : 'civr-card px-6 py-14 md:py-20'} text-center civr-rise`} data-testid={testid}>
      {Icon && <EmptyArt icon={Icon} />}
      <div className={`font-semibold tracking-tight ${bare ? 'text-lg' : 'text-xl md:text-2xl'}`}>{title}</div>
      {sub && <p className="text-sm md:text-[15px] text-[#a1a1aa] mt-3 max-w-md mx-auto">{sub}</p>}
      {children && <div className="mt-8 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

// Grey placeholder shapes while a list or page loads (keeps testid "loading-indicator" like Spinner).
export const Skel = ({ className = '' }) => <span className={`civr-skel block ${className}`} />;

export function SkeletonRows({ rows = 4, card = true, testid = 'loading-indicator' }) {
  return (
    <div className={card ? 'civr-card p-6' : ''} aria-busy="true" aria-label="Loading" data-testid={testid}>
      <div className="flex flex-col gap-6">{Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skel className="w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 flex flex-col gap-2"><Skel className="h-3.5 w-2/5" /><Skel className="h-3 w-1/4" /></div>
          <Skel className="h-6 w-16 rounded-full hidden sm:block" />
        </div>
      ))}</div>
    </div>
  );
}

export function SkeletonCard({ lines = 3, className = '', testid = 'loading-indicator' }) {
  return (
    <div className={`civr-card p-6 flex flex-col gap-4 ${className}`} aria-busy="true" aria-label="Loading" data-testid={testid}>
      <Skel className="h-6 w-40" />
      {Array.from({ length: lines }, (_, i) => <Skel key={i} className={`h-3.5 ${['w-full', 'w-5/6', 'w-2/3', 'w-1/2'][i % 4]}`} />)}
    </div>
  );
}

// Full-page placeholder: header, a row of cards, then a list.
export function SkeletonPage({ cards = 3, rows = 3, header = true, testid = 'loading-indicator' }) {
  return (
    <div aria-busy="true" aria-label="Loading" data-testid={testid}>
      {header && <div className="mb-8 space-y-3"><Skel className="h-3 w-24" /><Skel className="h-10 w-72 max-w-full" /><Skel className="h-4 w-[28rem] max-w-full" /></div>}
      {cards > 0 && <div className="grid lg:grid-cols-3 gap-4 mb-4">{Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} lines={2} testid={`skeleton-card-${i}`} />)}</div>}
      {rows > 0 && <SkeletonRows rows={rows} testid="skeleton-rows" />}
    </div>
  );
}

// `need` = name of the cheapest plan that includes the feature (e.g. "Pro").
export function Locked({ feature, phone, need }) {
  return (
    <div className="civr-card p-8 flex flex-col md:flex-row md:items-center gap-4" data-testid="feature-locked">
      <Lock className="w-6 h-6 text-[#fbbf24]" />
      <div className="flex-1">
        <div className="font-semibold" data-testid="feature-locked-title">{need ? `${feature} is on the ${need} plan and up` : `${feature} needs a higher plan`}</div>
        <div className="text-sm text-[#a1a1aa]">Upgrade this number to unlock it — your renewal date stays the same, and within 14 days of buying 25% of your current plan price comes off.</div>
      </div>
      <button type="button" onClick={() => showUpgrade({ feature, need, phone })} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="feature-locked-upgrade-link">{need ? `See what ${need} adds` : 'See plans'}</button>
    </div>
  );
}

export function Toggle({ checked, onChange, testid, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} data-testid={testid}
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-2.5 ${checked ? 'bg-[#818cf8]' : 'bg-[#2a2a2a] ring-1 ring-inset ring-[#71717a]/60'} disabled:opacity-40`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

// Saves the moment it is flipped (PATCH /numbers/:phone/switch) and offers Undo in the toast. `onSaved(reply)` gets the
// server reply (fresh `number`, aiAgentTurnedOff / ivrTurnedOff) before `reload` runs.
export function useSwitch({ num, feature, checked, label, reload, onSaved }) {
  const [opt, setOpt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOpt(null); }, [checked]);
  const flip = async (v, undo) => {
    setOpt(v); setBusy(true);
    try {
      const d = await api(`/numbers/${enc(num.phoneNumber)}/switch`, { method: 'PATCH', body: { feature, enabled: v } });
      onSaved?.(d);
      const extra = d.aiAgentTurnedOff ? ' · AI voice agent switched off' : d.ivrTurnedOff ? ' · keypad menu switched off' : '';
      toast.success(`${label} ${v ? 'on' : 'off'}${extra}`, { id: `switch:${num.phoneNumber}:${feature}`, ...(undo ? {} : { action: { label: 'Undo', onClick: () => flip(!v, true) } }) });
      reload?.();
    } catch (e) { setOpt(null); toast.error(e.message); } finally { setBusy(false); }
  };
  return { value: opt ?? checked, busy, flip: (v) => flip(v, false) };
}

export function InstantToggle({ testid, disabled, ...rest }) {
  const s = useSwitch(rest);
  return <Toggle checked={s.value} disabled={disabled || s.busy} onChange={s.flip} testid={testid} label={rest.label} />;
}

export function PreviewBanner({ show, livePayments }) {
  if (!show) return null;
  return (
    <div role="region" aria-label="Preview mode notice" className="text-xs font-mono uppercase tracking-wider text-[#fbbf24] bg-[#fbbf24]/10 border-b border-[#fbbf24]/30 px-4 py-2 text-center" data-testid="preview-mode-banner">
      Preview — purchases and calls are simulated · {livePayments ? 'crypto top-ups are REAL' : 'top-ups too'}
    </div>
  );
}

// Same-named clips get their length and date so they can be told apart ("Payment Notification · 0:24 · 28 Oct 7:10 PM").
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export function audioLabel(a, all) {
  if ((all || []).filter(x => x.name === a.name).length < 2) return a.name;
  const when = a.createdAt ? new Date(a.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const voice = /^tts-([a-z]+)/i.exec(a.originalName || '')?.[1];
  return [a.name, voice ? `${voice[0].toUpperCase()}${voice.slice(1)} voice` : '', a.duration ? clock(a.duration) : '', when].filter(Boolean).join(' · ');
}

// `audios` undefined = still loading. With `onAdded` (reload the list), an empty library offers upload / text-to-voice in place.
export function AudioSelect({ value, onChange, audios, testid, placeholder = 'Pick audio…', by = 'audioUrl', onAdded, compact }) {
  const add = useAudioAdd();
  const added = (a) => { onAdded(a); onChange(a[by]); };
  const dialog = onAdded && <AudioAddDialog {...add} onClose={add.close} onAdded={added} testid={testid} />;
  if (!audios) return <select className="civr-input" disabled aria-label="Loading audio" data-testid={testid}><option>Loading audio…</option></select>;
  if (!audios.length && onAdded) return <>{<EmptyAudio start={add.start} compact={compact} testid={testid} />}{dialog}</>;
  return (
    <div className="space-y-1">
      <select className="civr-input" value={value || ''} onChange={e => onChange(e.target.value)} aria-label={placeholder.replace(/…$/, '')} data-testid={testid}>
        <option value="">{placeholder}</option>
        {audios.map(a => <option key={a.id} value={a[by]}>{audioLabel(a, audios)}</option>)}
      </select>
      {onAdded && <button type="button" className="text-xs text-[#818cf8] hover:underline inline-flex items-center gap-1 min-h-[32px]" onClick={() => add.start('upload')} data-testid={`${testid}-add-new-button`}><Plus className="w-3.5 h-3.5" />New audio</button>}
      {dialog}
    </div>
  );
}

export function KeyPicker({ value, onChange, testid }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];
  const toggle = (k) => onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k]);
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {keys.map(k => (
        <button key={k} type="button" onClick={() => toggle(k)} data-testid={`${testid}-${k === '*' ? 'star' : k === '#' ? 'hash' : k}`}
          className={`w-11 h-11 rounded-lg font-mono text-sm border transition-colors ${value.includes(k) ? 'border-[#818cf8] text-[#818cf8] bg-[#818cf8]/10' : 'border-[#2a2a2a] text-[#a1a1aa] hover:text-white'}`}>{k}</button>
      ))}
    </div>
  );
}

export const statusPill = (s) => (['active', 'running', 'completed', 'credited', 'paid', 'paid_late'].includes(s) ? 'civr-pill civr-pill-ok' : ['paused', 'scheduled', 'created', 'waiting', 'collecting', 'test'].includes(s) ? 'civr-pill civr-pill-warn' : ['cancelled', 'suspended', 'expired', 'failed', 'released'].includes(s) ? 'civr-pill civr-pill-bad' : 'civr-pill');

// Backup numbers rung in order when the main number is busy or doesn't answer (comma separated, up to 4).
export function BackupsField({ value, onChange, testid }) {
  const v = Array.isArray(value) ? value.join(', ') : (value || '');
  return (
    <Field label="Backup numbers if busy (optional)" hint="Up to 4, separated by commas. If nobody answers, the next one rings automatically.">
      <input className="civr-input font-mono" value={v} onChange={e => onChange(e.target.value)} placeholder="+14155550101, +14155550102" data-testid={testid} />
    </Field>
  );
}
