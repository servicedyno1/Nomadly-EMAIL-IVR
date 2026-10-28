import React, { useState } from 'react';
import { Loader2, FileSignature, Upload, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiUrl } from '../../api';
import { Field, ErrorNote } from '../../ui';

const FIELDS = [['name', 'Account holder’s full name', 'As on the phone bill'], ['business', 'Business name (optional)', ''], ['address', 'Street address', 'Service address on the bill'], ['city', 'City', ''], ['state', 'State / province', ''], ['zip', 'ZIP / postal code', ''], ['carrier', 'Current phone provider', 'e.g. AT&T, Comcast, RingCentral'], ['account', 'Account number (optional)', 'From the bill']];
const REQUIRED = ['name', 'address', 'city', 'state', 'zip', 'carrier'];

// Details → we fill in + e-sign the authorization letter (after consent) → bill PDF → sent for review.
export function DocumentsStep({ item, onChange }) {
  const [h, setH] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, item.holder?.[k] || ''])));
  const [bill, setBill] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const ready = REQUIRED.every(k => h[k].trim()) && bill && consent;
  const preview = async () => {
    setBusy('preview'); setErr(null);
    try {
      const r = await fetch(apiUrl(`/hosted-sms/${item.id}/loa-preview`), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ holder: h }) });
      if (!r.ok) throw new Error('Couldn’t build the preview.');
      window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const submit = async () => {
    setBusy('send'); setErr(null);
    try {
      const form = new FormData();
      form.append('bill', bill); form.append('holder', JSON.stringify(h)); form.append('consent', 'true');
      await api(`/hosted-sms/${item.id}/documents`, { method: 'POST', form });
      toast.success('Documents sent for review'); onChange();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const pick = (f) => { if (f && f.type !== 'application/pdf') return toast.error('Upload the bill as a PDF.'); if (f && f.size > 5 * 1024 * 1024) return toast.error('The PDF must be under 5 MB.'); setBill(f || null); };
  return (
    <div className="space-y-5" data-testid="texting-documents">
      <p className="text-sm text-[#d4d4d8] flex gap-2"><FileSignature className="w-5 h-5 text-[#818cf8] shrink-0" />Enter the details exactly as they appear on your phone bill. We fill in the Letter of Authorization and sign it for you.</p>
      <div className="grid sm:grid-cols-2 gap-4">{FIELDS.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}><input className="civr-input" value={h[k]} onChange={e => setH({ ...h, [k]: e.target.value })} data-testid={`texting-holder-${k}`} /></Field>)}</div>
      <button type="button" onClick={preview} disabled={!!busy || !h.name.trim()} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="texting-loa-preview">{busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}Preview the letter</button>
      <label className="flex items-start gap-3 text-sm cursor-pointer" data-testid="texting-consent">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 accent-[#818cf8]" data-testid="texting-consent-checkbox" />
        <span>I am the account holder (or authorized by them) and I allow CloudIVR to sign the Letter of Authorization in my name.</span>
      </label>
      <label className="civr-card border-dashed p-5 flex items-center gap-3 cursor-pointer" data-testid="texting-bill-drop">
        <Upload className="w-5 h-5 text-[#818cf8]" />
        <span className="text-sm flex-1">{bill ? bill.name : 'Upload your most recent phone bill (PDF, under 5 MB)'}</span>
        <input type="file" accept="application/pdf" className="hidden" onChange={e => pick(e.target.files?.[0])} data-testid="texting-bill-input" />
      </label>
      <button type="button" onClick={submit} disabled={!ready || !!busy} className="civr-btn civr-btn-primary" data-testid="texting-documents-submit">{busy === 'send' && <Loader2 className="w-4 h-4 animate-spin" />}Sign & send for review</button>
      <ErrorNote error={err} testid="texting-documents-error" />
    </div>
  );
}
