import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Dialog: centered (`side` = right-hand drawer from sm up), bottom sheet on phones. Esc or the backdrop closes it.
export function Modal({ title, sub, onClose, children, footer, wide = false, side = false, testid }) {
  const box = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement;
    box.current?.focus();
    const key = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-testid="confirm-dialog"]')) { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev; back?.focus?.(); };
  }, []);
  const shell = side
    ? 'sm:h-full sm:max-w-xl sm:!rounded-none sm:border-y-0 sm:border-r-0'
    : `${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'} sm:max-h-[88dvh]`;
  return (
    <div className={`fixed inset-0 z-[60] flex items-end bg-black/70 backdrop-blur-sm ${side ? 'sm:justify-end sm:items-stretch' : 'sm:items-center justify-center sm:p-4'}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close.current(); }} data-testid={`${testid}-backdrop`}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`civr-card !bg-[#0e0e10] w-full max-h-[92dvh] flex flex-col !rounded-b-none sm:!rounded-[14px] civr-rise shadow-2xl shadow-black/60 outline-none ${shell}`} data-testid={testid}>
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-[#1f1f1f]">
          <div className="min-w-0">
            <div className="font-display text-xl sm:text-2xl font-bold truncate" data-testid={`${testid}-title`}>{title}</div>
            {sub && <div className="text-sm text-[#a1a1aa] mt-1">{sub}</div>}
          </div>
          <button type="button" onClick={() => close.current()} className="w-11 h-11 -mr-3 -mt-2 shrink-0 flex items-center justify-center rounded-full text-[#a1a1aa] hover:text-white hover:bg-white/5 transition-colors" aria-label="Close" data-testid={`${testid}-close-button`}><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 flex-1">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-4 border-t border-[#1f1f1f] flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export const initials = (name, phone) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return w.length ? (w[0][0] + (w[1]?.[0] || '')).toUpperCase() : String(phone || '#').slice(-2);
};

export function Avatar({ name, phone, className = '' }) {
  return <span className={`w-10 h-10 shrink-0 rounded-xl bg-[#818cf8]/10 text-[#a5b4fc] border border-[#818cf8]/20 flex items-center justify-center font-mono text-xs font-semibold ${className}`} aria-hidden="true">{initials(name, phone)}</span>;
}
