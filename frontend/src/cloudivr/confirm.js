import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';

// Styled replacement for window.confirm (matches the app, translated by the page translator).
//   if (!(await ask('Delete this agent?', { danger: true, ok: 'Delete agent' }))) return;
let show = null;
export function ask(message, { ok = 'Confirm', cancel = 'Cancel', danger = false, title = null } = {}) {
  return new Promise((resolve) => {
    if (!show) { resolve(window.confirm(message)); return; }
    show({ message, ok, cancel, danger, title, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const box = useRef(null);
  const back = useRef(null);
  useEffect(() => {
    // One question at a time: a second ask while one is open is answered "no".
    show = (r) => setReq(cur => { if (cur) { r.resolve(false); return cur; } back.current = document.activeElement; return r; });
    return () => { show = null; };
  }, []);
  const close = (answer) => {
    setReq(cur => { cur?.resolve(answer); return null; });
    setTimeout(() => back.current?.focus?.(), 0);
  };
  useEffect(() => {
    if (!req) return undefined;
    // Destructive questions focus "Cancel" so a stray Enter never deletes anything.
    box.current?.querySelector(req.danger ? '[data-testid="confirm-dialog-cancel"]' : '[data-testid="confirm-dialog-ok"]')?.focus();
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Tab') {
        const f = [...(box.current?.querySelectorAll('button') || [])];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [req]);
  if (!req) return null;
  const Icon = req.danger ? AlertTriangle : HelpCircle;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }} data-testid="confirm-dialog-backdrop">
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="civr-confirm-msg" className="civr-card !bg-[#111] w-full max-w-md p-6 civr-rise shadow-2xl shadow-black/60" data-testid="confirm-dialog">
        <div className="flex gap-3">
          <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${req.danger ? 'text-[#fb7185]' : 'text-[#34d399]'}`} />
          <div className="min-w-0">
            {req.title && <div className="font-semibold text-[#f3f4f6] mb-1" data-testid="confirm-dialog-title">{req.title}</div>}
            <p id="civr-confirm-msg" className="text-sm leading-relaxed text-[#d4d4d8]" data-testid="confirm-dialog-message">{req.message}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" className="civr-btn civr-btn-ghost" onClick={() => close(false)} data-testid="confirm-dialog-cancel">{req.cancel}</button>
          <button type="button" className={`civr-btn ${req.danger ? 'civr-btn-danger' : 'civr-btn-primary'}`} onClick={() => close(true)} data-testid="confirm-dialog-ok">{req.ok}</button>
        </div>
      </div>
    </div>
  );
}
