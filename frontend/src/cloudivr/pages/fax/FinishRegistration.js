import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Loader2, Send, Undo2 } from 'lucide-react';
import { api, enc, money } from '../../api';
import { ask } from '../../confirm';
import { cp } from '../../paths';
import { PaperworkNote } from '../buy/Paperwork';

const LEVEL = { name_address: 1, documents: 2 };

// Paid fax number not live yet: send the carrier details (only now, after payment) or cancel for a full refund.
export function FinishRegistration({ n, reload }) {
  const r = n.registration, id = n.phoneNumber.replace(/\D/g, '');
  const level = LEVEL[r.paperwork] || 0;
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { if (r.needsDetails && level === 2) api(`/numbers/documents?country=${n.country}`).then(setDocs).catch(() => {}); }, [r.needsDetails, level, n.country]);
  const send = async () => {
    setBusy('send');
    try { await api(`/fax-numbers/${enc(n.phoneNumber)}/details`, { method: 'POST', body: {} }); toast.success('Details sent — the carrier usually approves within a few days'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const cancel = async () => {
    if (!(await ask(`Cancel ${n.phoneNumber}? It is released and ${money(n.price)} goes back to your wallet.`, { ok: 'Cancel and refund', cancel: 'Keep it', title: 'Cancel fax number', danger: true }))) return;
    setBusy('cancel');
    try { const d = await api(`/fax-numbers/${enc(n.phoneNumber)}/cancel`, { method: 'POST', body: {} }); toast.success(`Cancelled — ${money(d.refunded)} refunded to your wallet`); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="mt-3 space-y-3" data-testid={`fax-finish-${id}`}>
      {r.needsDetails && (
        <>
          <p className="text-sm" data-testid={`fax-finish-title-${id}`}>Paid and reserved. One more step: the carrier needs a few details to switch it on{r.refundBy ? ` — send them by ${String(r.refundBy).slice(0, 10)} or it is refunded automatically` : ''}.</p>
          {level > 0 && <PaperworkNote paperwork={{ level, businessOnly: r.businessOnly, address: r.address, documents: docs }} country={n.country} countryName={n.country} onChange={setDocs} />}
          <p className="text-xs text-[var(--c-muted)]">Your saved legal details are used. <Link to={cp('/app/settings')} className="text-[#818cf8] underline underline-offset-2" data-testid={`fax-finish-legal-link-${id}`}>Edit legal details</Link></p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {r.needsDetails && <button type="button" className="civr-btn civr-btn-primary" onClick={send} disabled={!!busy} data-testid={`fax-finish-send-${id}`}>{busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send details</button>}
        <button type="button" className="civr-btn" onClick={cancel} disabled={!!busy} data-testid={`fax-finish-cancel-${id}`}>{busy === 'cancel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}Cancel for a refund</button>
      </div>
    </div>
  );
}
