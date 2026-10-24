import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { EyeOff } from 'lucide-react';

// Private mode: one tap hides phone numbers, contacts and message text on screen; the same tap shows them again.
const KEY = 'civr.private';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };

// "+1 ••• ••• 0100" — keeps the country prefix and the last 4 digits.
export function maskPhone(p) {
  const s = String(p || '');
  if (!s) return s;
  const d = s.replace(/\D/g, '');
  if (d.length < 5) return '•••';
  const cc = /^[17]/.test(d) ? d.slice(0, 1) : d.slice(0, 2);
  return `+${cc} ••• ••• ${d.slice(-4)}`;
}

const OFF = { on: false, toggle: () => {}, phone: (p) => p, text: (t) => t, input: '' };
const PrivacyCtx = createContext(OFF);
export const usePrivacy = () => useContext(PrivacyCtx);

export function PrivacyProvider({ children }) {
  const [on, setOn] = useState(read);
  const toggle = useCallback(() => setOn(v => { const next = !v; try { localStorage.setItem(KEY, next ? '1' : '0'); } catch (_) { /* private browsing */ } return next; }), []);
  // Keep every open tab in step.
  useEffect(() => {
    const sync = (e) => { if (e.key === KEY) setOn(e.newValue === '1'); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const value = useMemo(() => ({
    on, toggle,
    phone: (p) => (on && p ? maskPhone(p) : p),
    text: (t, hidden = 'Hidden') => (on && t ? hidden : t),
    input: on ? 'civr-secure' : '', // dots instead of digits while typing
  }), [on, toggle]);
  return <PrivacyCtx.Provider value={value}>{children}</PrivacyCtx.Provider>;
}

export function PrivateBanner() {
  const { on, toggle } = usePrivacy();
  if (!on) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-[#c4b5fd] bg-[#a78bfa]/10 border-b border-[#a78bfa]/30 px-4 py-1.5 text-center" data-testid="private-mode-banner">
      <EyeOff className="w-3.5 h-3.5 shrink-0" />Private mode on — numbers, contacts and messages are hidden.
      <button type="button" onClick={toggle} className="min-h-[32px] px-2 font-semibold underline underline-offset-2 hover:text-white" data-testid="private-mode-banner-show-button">Show them</button>
    </div>
  );
}
