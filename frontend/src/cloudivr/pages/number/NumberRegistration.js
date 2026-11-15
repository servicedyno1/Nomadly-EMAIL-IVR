import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Loader2, Send, Undo2, ShieldCheck } from 'lucide-react';
import { api, enc } from '../../api';
import { ask } from '../../confirm';
import { cp } from '../../paths';
import { DocumentUpload } from '../buy/Paperwork';

// Paid number whose country needs carrier details: asked only now, after payment. Cancel = full refund.
export function NumberRegistration({ n, reload }) {
  const r = n.registration;
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { if (r?.needsDetails && r.level === 2) api(`/numbers/documents?country=${n.country}`).then(setDocs).catch(() => {}); }, [r?.needsDetails, r?.level, n.country]);
  if (!r || !['needs_details', 'pending'].includes(r.status)) return null;
  const send = async () => {
    setBusy('send');
    try { await api(`/numbers/${enc(n.phoneNumber)}/registration`, { method: 'POST', body: {} }); toast.success('Details sent — the carrier usually approves within 1–2 business days'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const cancel = async () => {
    if (!(await ask(`Cancel ${n.phoneNumber}? It is released and what you paid goes back to your wallet.`, { ok: 'Cancel and refund', cancel: 'Keep it', title: 'Cancel number', danger: true }))) return;
    setBusy('cancel');
    try { const d = await api(`/numbers/${enc(n.phoneNumber)}/registration/cancel`, { method: 'POST', body: {} }); toast.success(`Cancelled — $${Number(d.refunded).toFixed(2)} refunded to your wallet`); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="civr-card p-5 mt-4 space-y-3 civr-rise" data-testid="number-registration-card">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-[#818cf8] mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold" data-testid="number-registration-title">{r.needsDetails ? 'One more step to switch it on' : 'Waiting for the carrier’s approval'}</div>
          <p className="text-[var(--c-muted)] mt-1">{r.needsDetails
            ? `Your number is paid and reserved. The carrier needs a few details first${r.level === 2 ? ' — add an ID or company document below' : ''}. We use your saved legal details${r.refundBy ? `; without them it is refunded automatically on ${String(r.refundBy).slice(0, 10)}` : ''}.`
            : 'Your details are with the carrier. We’ll let you know as soon as it’s live.'}</p>
        </div>
      </div>
      {r.needsDetails && r.level === 2 && <DocumentUpload country={n.country} status={docs} onChange={setDocs} />}
      <div className="flex flex-wrap items-center gap-2">
        {r.needsDetails && <button type="button" className="civr-btn civr-btn-primary" onClick={send} disabled={!!busy} data-testid="number-registration-send">{busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send details</button>}
        <button type="button" className="civr-btn" onClick={cancel} disabled={!!busy} data-testid="number-registration-cancel">{busy === 'cancel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}Cancel for a refund</button>
        {r.needsDetails && <Link to={cp('/app/settings')} className="text-xs text-[#818cf8] underline underline-offset-2" data-testid="number-registration-legal-link">Edit legal details</Link>}
      </div>
    </div>
  );
}
