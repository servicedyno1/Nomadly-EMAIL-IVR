import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PenLine, Type, Check, Loader2 } from 'lucide-react';
import { api, useApi } from '../../api';

// Signature for the carrier registration: draw it, or type your full name; both need consent.
export function SignatureField() {
  const { data, reload } = useApi('/profile/legal');
  const saved = data?.profile?.signature;
  const [mode, setMode] = useState('type');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const pad = useRef(null);
  useEffect(() => { if (!name && data?.profile?.fullName) setName(data.profile.fullName); }, [data, name]);
  if (!data?.profile) return null;
  const save = async () => {
    setBusy(true);
    try {
      await api('/profile/legal/signature', { method: 'PUT', body: { consent: agree, typedName: name, ...(mode === 'draw' ? { png: pad.current.toDataURL('image/png') } : {}) } });
      toast.success('Signature saved'); reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-[var(--c-border)] p-4 space-y-3" data-testid="signature-field">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Your signature for the carrier</div>
        {saved && <span className="civr-pill" data-testid="signature-saved"><Check className="w-3 h-3" /> Saved ({saved.mode})</span>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('type')} className={`civr-pill ${mode === 'type' ? 'ring-1 ring-[#818cf8]' : ''}`} data-testid="signature-mode-type"><Type className="w-3 h-3" /> Type</button>
        <button type="button" onClick={() => setMode('draw')} className={`civr-pill ${mode === 'draw' ? 'ring-1 ring-[#818cf8]' : ''}`} data-testid="signature-mode-draw"><PenLine className="w-3 h-3" /> Draw</button>
      </div>
      {mode === 'type'
        ? <input className="civr-input w-full italic" value={name} onChange={e => setName(e.target.value)} placeholder="Your full legal name" data-testid="signature-typed-input" />
        : <DrawPad ref={pad} onDraw={() => setDrawn(true)} />}
      <label className="flex items-start gap-2 text-xs text-[var(--c-muted)]">
        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5" data-testid="signature-consent-checkbox" />
        I agree to sign electronically. My signature is sent with my details to the carrier to register my numbers.
      </label>
      <button type="button" className="civr-btn" disabled={busy || !agree || (mode === 'type' ? name.trim().length < 3 : !drawn)} onClick={save} data-testid="signature-save-button">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}{saved ? 'Replace signature' : 'Save signature'}
      </button>
    </div>
  );
}

const DrawPad = React.forwardRef(function DrawPad({ onDraw }, ref) {
  const last = useRef(null);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [(e.clientX - r.left) * (ref.current.width / r.width), (e.clientY - r.top) * (ref.current.height / r.height)]; };
  const down = (e) => { last.current = pos(e); ref.current.setPointerCapture(e.pointerId); };
  const move = (e) => {
    if (!last.current) return;
    const c = ref.current.getContext('2d'), p = pos(e);
    c.strokeStyle = '#142878'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(...last.current); c.lineTo(...p); c.stroke();
    last.current = p; onDraw();
  };
  useEffect(() => { const c = ref.current.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, ref.current.width, ref.current.height); }, [ref]);
  return <canvas ref={ref} width={600} height={160} className="w-full h-32 rounded-lg bg-white touch-none cursor-crosshair" onPointerDown={down} onPointerMove={move} onPointerUp={() => { last.current = null; }} data-testid="signature-draw-pad" />;
});
