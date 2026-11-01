import React, { useState } from 'react';
import { toast } from 'sonner';
import { Mail, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { EMAIL_OK } from '../landing/EsimCheckout';

// The install QR goes to the app and to an email; the owner can send it again to any address.
export function EmailQr({ item, reload }) {
  const [email, setEmail] = useState(item.qrEmail || '');
  const [busy, setBusy] = useState(false);
  if (!['active', 'suspended'].includes(item.status) || !item.hasQr) return null;
  const send = async () => {
    setBusy(true);
    try { const r = await api(`/esim/${item.id}/email-qr`, { method: 'POST', body: { email: email.trim() } }); toast.success(`QR code sent to ${r.email}`); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2" data-testid={`esim-email-qr-${item.id}`}>
      {item.qrEmailedAt && <p className="text-xs text-[var(--c-muted)]" data-testid={`esim-qr-emailed-${item.id}`}>{`QR code emailed to ${item.qrEmail}`}</p>}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="w-full sm:w-72"><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email for the QR code" className="civr-input !h-9 text-sm" data-testid={`esim-qr-email-input-${item.id}`} /></div>
        <button type="button" onClick={send} disabled={busy || !EMAIL_OK.test(email.trim())} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`esim-qr-email-send-${item.id}`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}{item.qrEmailedAt ? 'Email it again' : 'Email the QR code'}</button>
      </div>
    </div>
  );
}
