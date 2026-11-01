import React, { useState } from 'react';
import { Loader2, FileSignature, Upload, Eye, LifeBuoy, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiUrl } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { openHelpChat } from '../../shortcuts';

const FIELDS = [['name', 'Account holder’s full name', 'As on the phone bill'], ['business', 'Business name (optional)', ''], ['address', 'Street address', 'Service address on the bill'], ['city', 'City', ''], ['state', 'State / province', ''], ['zip', 'ZIP / postal code', ''], ['carrier', 'Current phone provider', 'e.g. AT&T, Comcast, RingCentral'], ['account', 'Account number (optional)', 'From the bill']];
const REQUIRED = ['name', 'address', 'city', 'state', 'zip', 'carrier'];
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// Step 3: details for the Letter of Authorization, signed by typing the holder's name.
export function LoaStep({ item, onChange }) {
  const [h, setH] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, item.holder?.[k] || ''])));
  const [sig, setSig] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const sigOk = sig.trim() && sig.trim().toLowerCase() === h.name.trim().toLowerCase();
  const ready = REQUIRED.every(k => h[k].trim()) && sigOk && consent;
  const preview = async () => {
    setBusy('preview'); setErr(null);
    try {
      const r = await fetch(apiUrl(`/hosted-sms/${item.id}/loa-preview`), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ holder: h, signature: sig }) });
      if (!r.ok) throw new Error('Couldn’t build the preview.');
      const url = URL.createObjectURL(await r.blob());
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const sign = async () => {
    setBusy('sign'); setErr(null);
    try { await api(`/hosted-sms/${item.id}/loa`, { method: 'POST', body: { holder: h, signature: sig, consent: true } }); toast.success('Letter signed. Last step: your phone bill'); onChange(); } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-5" data-testid="texting-loa">
      <p className="text-sm text-[#d4d4d8] flex gap-2"><FileSignature className="w-5 h-5 text-[#818cf8] shrink-0" />Enter the details exactly as on your phone bill. We fill in the Letter of Authorization (LOA) and you sign it below.</p>
      <div className="grid sm:grid-cols-2 gap-4">{FIELDS.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}><input className="civr-input" value={h[k]} onChange={e => setH({ ...h, [k]: e.target.value })} data-testid={`texting-holder-${k}`} /></Field>)}</div>
      <Field label="Sign: type the account holder’s full name" hint={sig && !sigOk ? 'Must match the account holder’s name above' : 'This is your electronic signature on the letter'}>
        <input className="civr-input text-xl italic" style={{ fontFamily: 'Georgia, serif' }} value={sig} onChange={e => setSig(e.target.value)} placeholder={h.name || 'Full name'} data-testid="texting-loa-signature" />
      </Field>
      <label className="flex items-start gap-3 text-sm cursor-pointer" data-testid="texting-consent">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 accent-[#818cf8]" data-testid="texting-consent-checkbox" />
        <span>I am the account holder (or authorized by them) and I sign this Letter of Authorization electronically.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={sign} disabled={!ready || !!busy} className="civr-btn civr-btn-primary" data-testid="texting-loa-submit">{busy === 'sign' && <Loader2 className="w-4 h-4 animate-spin" />}Sign the letter</button>
        <button type="button" onClick={preview} disabled={!!busy || !h.name.trim()} className="civr-btn civr-btn-ghost" data-testid="texting-loa-preview">{busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}Preview the letter</button>
      </div>
      <ErrorNote error={err} testid="texting-loa-error" />
    </div>
  );
}

// Step 4: phone bill upload, or hand it to support (who uploads it from admin).
export function BillStep({ item, onChange }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const helping = item.status === 'admin_docs';
  const pick = (list) => {
    const f = [...list].filter(x => OK_TYPES.includes(x.type) && x.size <= 5 * 1024 * 1024);
    if (f.length < list.length) toast.error('Use PDF, JPG or PNG files under 5 MB.');
    setFiles([...files, ...f].slice(0, 6));
  };
  const run = async (k, fn) => { setBusy(k); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(null); } };
  const send = () => run('send', async () => { const form = new FormData(); files.forEach(f => form.append('files', f)); await api(`/hosted-sms/${item.id}/documents`, { method: 'POST', form }); toast.success('Sent to the carrier for review'); onChange(); });
  const help = () => run('help', async () => {
    await api(`/hosted-sms/${item.id}/help`, { method: 'POST' });
    openHelpChat(`I need help with the phone bill for Landline to Texting on ${item.phoneNumber} (order ${item.id}).`);
    toast.success('Support has your request — we also emailed the team'); onChange();
  });
  return (
    <div className="space-y-4" data-testid="texting-bill">
      <p className="text-sm text-[#d4d4d8]">Upload a recent phone bill for <span className="font-mono" data-no-translate>{item.phoneNumber}</span> showing the holder name and service address. Photos or screenshots of your carrier account work too.</p>
      {helping && <div className="rounded-xl border border-[#fbbf24]/30 bg-[#fbbf24]/5 p-3 text-sm text-[#fde68a]" data-testid="texting-bill-helping">Our team is helping you with the bill. Check your Inbox and email, or upload it here yourself.</div>}
      <label className="civr-card border-dashed p-5 flex items-center gap-3 cursor-pointer" data-testid="texting-bill-drop">
        <Upload className="w-5 h-5 text-[#818cf8]" />
        <span className="text-sm flex-1">Add the bill (PDF, JPG or PNG, up to 6 files, 5 MB each)</span>
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => { pick(e.target.files || []); e.target.value = ''; }} data-testid="texting-bill-input" />
      </label>
      {files.length > 0 && <ul className="space-y-1" data-testid="texting-bill-files">{files.map((f, i) => (
        <li key={i} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{f.name}</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`texting-bill-remove-${i}`}><X className="w-4 h-4" /></button></li>
      ))}</ul>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={send} disabled={!files.length || !!busy} className="civr-btn civr-btn-primary" data-testid="texting-documents-submit">{busy === 'send' && <Loader2 className="w-4 h-4 animate-spin" />}Send for review</button>
        {!helping && <button type="button" onClick={help} disabled={!!busy} className="civr-btn civr-btn-ghost" data-testid="texting-bill-help">{busy === 'help' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LifeBuoy className="w-4 h-4" />}No bill? Contact support</button>}
        {helping && <button type="button" onClick={() => openHelpChat(`About the phone bill for ${item.phoneNumber} (order ${item.id}): `)} className="civr-btn civr-btn-ghost" data-testid="texting-bill-chat">Open help chat</button>}
      </div>
      <p className="text-xs text-[#a1a1aa]" data-testid="texting-approval-time">After the bill is sent, approval usually takes 1–3 business days (the carrier reviews Mon–Fri).</p>
      <ErrorNote error={err} testid="texting-documents-error" />
    </div>
  );
}
