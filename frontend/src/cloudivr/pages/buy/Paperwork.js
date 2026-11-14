import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, ShieldCheck, Trash2, Upload, AlertTriangle } from 'lucide-react';
import { api, enc } from '../../api';
import { ErrorNote } from '../../ui';
import { Link } from 'react-router-dom';
import { cp } from '../../paths';
import { StatusPill } from '../../compliance/Compliance';

const WHERE = { any: 'an address in any country', country: 'an address in this country', area: 'an address in this number’s area' };

// Paperwork for MultiTEL numbers: level 1 = saved name + address, level 2 = documents uploaded here before buying.
export function PaperworkNote({ paperwork, country, countryName, onChange }) {
  if (!paperwork) return null;
  const docs = paperwork.level === 2;
  return (
    <div className="civr-card p-5 mb-4 space-y-3 civr-rise" data-testid="buy-paperwork-note">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-[#818cf8] mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold" data-testid="buy-paperwork-title">{docs ? `${countryName} numbers need documents` : `${countryName} numbers need your name and address`}</div>
          <p className="text-[var(--c-muted)] mt-1">
            Your saved legal details are sent to the carrier. They need {WHERE[paperwork.address] || WHERE.any}{paperwork.businessOnly ? ', and they are sold to businesses only' : ''}.
            {docs && ' Upload an ID or company document and a recent utility bill if you have one. After you buy, the number goes live once the carrier approves them (usually 1–2 business days). If they reject them, the number is released and you get a full refund.'}
          </p>
        </div>
      </div>
      {docs && paperwork.compliance && <ComplianceSteps c={paperwork.compliance} />}
      {docs && <DocumentUpload country={country} status={paperwork.documents} onChange={onChange} />}
    </div>
  );
}

function DocumentUpload({ country, status, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const files = status?.files || [];
  const send = async (list) => {
    if (!list?.length) return;
    setBusy(true); setErr(null);
    const form = new FormData();
    form.append('country', country);
    [...list].slice(0, 4).forEach(f => form.append('files', f));
    try { onChange?.(await api('/numbers/documents', { method: 'POST', form })); toast.success('Documents uploaded'); }
    catch (e) { setErr(e); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async (id) => { try { onChange?.(await api(`/numbers/documents/${enc(id)}?country=${country}`, { method: 'DELETE' })); } catch (e) { setErr(e); } };
  return (
    <div className="space-y-2" data-testid="buy-documents">
      {files.map(f => (
        <div key={f.id} className="flex items-center gap-2 text-sm" data-testid={`buy-document-${f.id}`}>
          <FileText className="w-4 h-4 text-[#818cf8]" /><span className="flex-1 truncate">{f.name}</span>
          <span className="text-xs text-[var(--c-muted)]">{Math.ceil(f.size / 1024)} KB</span>
          <button type="button" className="civr-btn civr-btn-ghost !px-2" onClick={() => remove(f.id)} aria-label={`Remove ${f.name}`} data-testid={`buy-document-remove-${f.id}`}><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!files.length && <p className="text-xs text-[#fbbf24] flex gap-2" data-testid="buy-documents-missing"><AlertTriangle className="w-4 h-4 shrink-0" />Upload your documents before you buy.</p>}
      <input ref={input} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => send(e.target.files)} data-testid="buy-documents-input" />
      <button type="button" className="civr-btn" onClick={() => input.current?.click()} disabled={busy} data-testid="buy-documents-upload-button">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{files.length ? 'Add more files' : 'Upload documents'}
      </button>
      <p className="text-xs text-[var(--c-muted)]">PDF, JPG or PNG · up to 4 files · 10 MB each</p>
      <ErrorNote error={err} testid="buy-documents-error" />
    </div>
  );
}

// ID check (and company papers for businesses) must be done in Settings → Compliance before buying.
function ComplianceSteps({ c }) {
  const rows = [['ID check (photo ID + selfie)', c.identity.status, 'buy-compliance-identity']];
  if (c.company.status !== 'none' || c.business) rows.push(['Company papers', c.company.status, 'buy-compliance-company']);
  const done = c.identity.status === 'verified' && (rows.length === 1 || c.company.status === 'approved');
  return (
    <div className="rounded-xl border border-[var(--c-border,#2a2a2a)] p-3 space-y-2 text-sm" data-testid="buy-compliance-steps">
      {rows.map(([label, st, id]) => <div key={id} className="flex items-center justify-between gap-2"><span>{label}</span><StatusPill status={st} testid={id} /></div>)}
      {!done && <Link to={cp('/app/settings#settings-compliance')} className="text-[#818cf8] underline underline-offset-2 text-xs" data-testid="buy-compliance-link">Complete these in Settings → Compliance</Link>}
    </div>
  );
}
