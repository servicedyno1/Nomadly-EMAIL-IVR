import React from 'react';
import { Loader2, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cp } from './paths';

export const Label = ({ children }) => <div className="civr-label mb-3">{children}</div>;

export function PageHeader({ label, title, sub, children, testid }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8 civr-rise" data-testid={testid}>
      <div>
        {label && <Label>{label}</Label>}
        <h1 className="font-display text-4xl sm:text-5xl font-extrabold leading-[1.05] text-[#f3f4f6]">{title}</h1>
        {sub && <p className="text-sm md:text-base text-[#a1a1aa] mt-3 max-w-2xl">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
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
  return <div className="flex items-center gap-2 text-sm text-[#a1a1aa] py-10" data-testid={testid}><Loader2 className="w-4 h-4 animate-spin" />{label}</div>;
}

export function ErrorNote({ error, testid = 'error-message' }) {
  if (!error) return null;
  return <div className="text-sm text-[#fb7185] border border-[#fb7185]/30 bg-[#fb7185]/5 rounded-xl px-4 py-3" data-testid={testid}>{error.message || String(error)}</div>;
}

export function Empty({ icon: Icon, title, sub, children, testid }) {
  return (
    <div className="civr-card p-10 text-center" data-testid={testid}>
      {Icon && <Icon className="w-8 h-8 mx-auto text-[#a1a1aa] mb-4" />}
      <div className="font-display text-2xl font-bold">{title}</div>
      {sub && <p className="text-sm text-[#a1a1aa] mt-2 max-w-md mx-auto">{sub}</p>}
      {children && <div className="mt-6 flex justify-center gap-2">{children}</div>}
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
        <div className="text-sm text-[#a1a1aa]">Upgrade this number in its Billing tab to unlock it — you only pay the difference for the days left.</div>
      </div>
      <Link to={cp(`/app/numbers/${encodeURIComponent(phone)}?tab=billing`)} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="feature-locked-upgrade-link">Upgrade this number</Link>
    </div>
  );
}

export function Toggle({ checked, onChange, testid, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} data-testid={testid}
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#34d399]' : 'bg-[#2a2a2a]'} disabled:opacity-40`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export function PreviewBanner({ show, livePayments }) {
  if (!show) return null;
  return (
    <div className="text-xs font-mono uppercase tracking-wider text-[#fbbf24] bg-[#fbbf24]/10 border-b border-[#fbbf24]/30 px-4 py-2 text-center" data-testid="preview-mode-banner">
      Preview — purchases and calls are simulated · {livePayments ? 'crypto top-ups are REAL' : 'top-ups too'}
    </div>
  );
}

export function AudioSelect({ value, onChange, audios, testid, placeholder = 'Pick audio…', by = 'audioUrl' }) {
  return (
    <select className="civr-input" value={value || ''} onChange={e => onChange(e.target.value)} data-testid={testid}>
      <option value="">{placeholder}</option>
      {(audios || []).map(a => <option key={a.id} value={a[by]}>{a.name}</option>)}
    </select>
  );
}

export function KeyPicker({ value, onChange, testid }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];
  const toggle = (k) => onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k]);
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {keys.map(k => (
        <button key={k} type="button" onClick={() => toggle(k)} data-testid={`${testid}-${k === '*' ? 'star' : k === '#' ? 'hash' : k}`}
          className={`w-11 h-11 rounded-lg font-mono text-sm border transition-colors ${value.includes(k) ? 'border-[#34d399] text-[#34d399] bg-[#34d399]/10' : 'border-[#2a2a2a] text-[#a1a1aa] hover:text-white'}`}>{k}</button>
      ))}
    </div>
  );
}

export const statusPill = (s) => (['active', 'running', 'completed', 'credited'].includes(s) ? 'civr-pill civr-pill-on' : ['paused', 'scheduled', 'created', 'waiting', 'collecting'].includes(s) ? 'civr-pill civr-pill-warn' : ['cancelled', 'suspended', 'expired', 'failed', 'released'].includes(s) ? 'civr-pill civr-pill-bad' : 'civr-pill');

// Backup numbers rung in order when the main number is busy or doesn't answer (comma separated, up to 4).
export function BackupsField({ value, onChange, testid }) {
  const v = Array.isArray(value) ? value.join(', ') : (value || '');
  return (
    <Field label="Backup numbers if busy (optional)" hint="Up to 4, separated by commas. If nobody answers, the next one rings automatically.">
      <input className="civr-input font-mono" value={v} onChange={e => onChange(e.target.value)} placeholder="+14155550101, +14155550102" data-testid={testid} />
    </Field>
  );
}
