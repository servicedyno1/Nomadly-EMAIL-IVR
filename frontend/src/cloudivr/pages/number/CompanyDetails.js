import React, { useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, Send } from 'lucide-react';
import { api, enc } from '../../api';

const LABELS = { companyName: 'Company name', companyAddress: 'Company address (street, number, city, postcode)' };

// "Assigned after order" numbers: the carrier needs these typed details (no uploads), asked only after payment.
export function CompanyDetails({ n, reload }) {
  const need = n.companyDetails?.needs || [];
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  if (!need.length) return null;
  const send = async () => {
    setBusy(true);
    try { await api(`/numbers/${enc(n.phoneNumber)}/company-details`, { method: 'POST', body: vals }); toast.success('Details sent to the carrier — we’ll tell you when your number is live'); reload(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-5 mt-4 space-y-3 civr-rise" data-testid="company-details-card">
      <div className="flex items-start gap-3">
        <Building2 className="w-5 h-5 text-[#818cf8] mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold">One step left: your company details</div>
          <p className="text-[var(--c-muted)] mt-1">The carrier needs these before it assigns your {n.countryName || ''} number{n.companyDetails.localOnly ? ` — the company must be registered in ${n.countryName || 'that country'}` : ''}. Nothing to upload.</p>
        </div>
      </div>
      {need.map(k => (
        <label key={k} className="block text-sm">
          <span className="text-[var(--c-muted)]">{LABELS[k] || k}</span>
          <input className="civr-input w-full mt-1" value={vals[k] || ''} onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))} data-testid={`company-details-${k}`} />
        </label>
      ))}
      <button type="button" className="civr-btn civr-btn-primary" onClick={send} disabled={busy || need.some(k => !String(vals[k] || '').trim())} data-testid="company-details-send">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send details
      </button>
    </div>
  );
}
