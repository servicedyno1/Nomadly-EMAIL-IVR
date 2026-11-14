import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, Building2, FileText, IdCard, Loader2, ScrollText, Trash2, Upload } from 'lucide-react';
import { api, enc } from '../api';
import { useCivrAuth } from '../AuthContext';
import { ErrorNote } from '../ui';
import { Modal } from '../pages/contacts/Modal';

export const POLICY_POINTS = [
  'No spam: only call or text people who agreed to hear from you, and honor every opt-out (STOP) right away.',
  'No fraud, phishing, impersonation, threats or illegal content in calls, texts or voice messages.',
  'No robocalls or bulk texts without the consent the recipient’s country requires; respect local calling-hour laws.',
  'Caller ID must be a number you own or are allowed to use — never spoof someone else’s number.',
  'Keep your legal details and documents true and current. We may suspend numbers used against this policy.',
];

const PILL = { verified: ['civr-pill-on', 'Verified'], approved: ['civr-pill-on', 'Approved'], pending: ['civr-pill-warn', 'Checking…'], submitted: ['civr-pill-warn', 'Waiting for review'], failed: ['civr-pill-off', 'Not passed'], rejected: ['civr-pill-off', 'Not approved'], draft: ['civr-pill-warn', 'Not sent yet'], none: ['', 'Not started'] };
export const StatusPill = ({ status, testid }) => { const [c, t] = PILL[status] || PILL.none; return <span className={`civr-pill ${c}`} data-testid={testid}>{t}</span>; };

export function useCompliance() {
  const [state, setState] = useState(null);
  const load = () => api('/compliance').then(setState).catch(() => {});
  useEffect(() => { load(); }, []);
  return [state, setState, load];
}

// Blocking agreement for accounts that haven't accepted the current usage policy.
export function PolicyGate({ ready = true }) {
  const { account } = useCivrAuth();
  const [state, setState] = useCompliance();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!ready || account?.profileDue || !state || state.policy?.accepted) return null;
  const accept = async () => { setBusy(true); setErr(null); try { setState(await api('/compliance/policy', { method: 'POST', body: { accept: true } })); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal title="CloudIVR usage policy" sub="Carriers hold us to these rules for every call and text. Please read and accept them to keep using CloudIVR." onClose={() => {}} testid="policy-gate">
      <PolicyList />
      <label className="flex items-start gap-3 mt-5 text-sm cursor-pointer">
        <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} className="mt-1" data-testid="policy-gate-checkbox" />
        <span>I agree to follow the CloudIVR usage policy for all my numbers, calls and texts.</span>
      </label>
      <ErrorNote error={err} testid="policy-gate-error" />
      <button className="civr-btn civr-btn-primary w-full mt-5" disabled={!ok || busy} onClick={accept} data-testid="policy-gate-accept-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Accept and continue</button>
    </Modal>
  );
}
export const PolicyList = () => (
  <ul className="space-y-2 text-sm text-[var(--c-muted)]" data-testid="policy-points">
    {POLICY_POINTS.map((p, i) => <li key={i} className="flex gap-2"><ScrollText className="w-4 h-4 text-[#818cf8] shrink-0 mt-0.5" />{p}</li>)}
  </ul>
);

// Settings → Compliance: ID check (Stripe), company papers (business accounts), policy status.
export function ComplianceCard() {
  const { account } = useCivrAuth();
  const [state, setState, load] = useCompliance();
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!/[?&]identity=done/.test(window.location.search)) return;
    api('/compliance/identity/refresh', { method: 'POST' }).then(s => { setState(s); if (s.identity.status === 'verified') toast.success('ID check passed'); }).catch(() => {});
  }, [setState]);
  const startId = async () => { setBusy(true); setErr(null); try { const d = await api('/compliance/identity', { method: 'POST' }); if (d.url) window.location.assign(d.url); else load(); } catch (e) { setErr(e); setBusy(false); } };
  const isBusiness = account?.profileType === 'business' || account?.legalProfile?.type === 'business';
  if (!state) return null;
  const id = state.identity;
  return (
    <div className="civr-card p-6 space-y-6 lg:col-span-2" id="settings-compliance" data-testid="settings-compliance">
      <div className="font-display text-2xl font-bold">Compliance</div>
      <div className="flex flex-wrap items-start gap-4" data-testid="compliance-identity">
        <IdCard className="w-6 h-6 text-[#818cf8] mt-1" />
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 font-semibold">ID check <StatusPill status={id.status} testid="compliance-identity-status" /></div>
          <p className="text-sm text-[var(--c-muted)] mt-1">{id.status === 'verified' ? `Verified${id.name ? ` as ${id.name}` : ''}.` : 'Needed only for countries that require ID. Takes about 2 minutes: a photo of your passport, driving licence or ID card, then a quick selfie. Run securely by Stripe.'}</p>
          {id.status === 'failed' && id.reason && <p className="text-xs text-[#f87171] mt-1" data-testid="compliance-identity-reason">{id.reason}</p>}
        </div>
        {id.status !== 'verified' && <div className="flex gap-2">
          {id.status === 'pending' && <button className="civr-btn civr-btn-ghost" onClick={() => api('/compliance/identity/refresh', { method: 'POST' }).then(setState).catch(setErr)} data-testid="compliance-identity-refresh-button">Check status</button>}
          <button className="civr-btn civr-btn-primary" onClick={startId} disabled={busy} data-testid="compliance-identity-start-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{id.status === 'none' ? 'Verify my ID' : 'Try again'}</button>
        </div>}
      </div>
      {isBusiness && <CompanyPapers state={state} setState={setState} />}
      <div className="flex items-center gap-3 text-sm" data-testid="compliance-policy">
        <BadgeCheck className={`w-5 h-5 ${state.policy.accepted ? 'text-[#34d399]' : 'text-[#fbbf24]'}`} />
        {state.policy.accepted ? `Usage policy accepted ${new Date(state.policy.acceptedAt).toLocaleDateString()}.` : 'Usage policy not accepted yet.'}
      </div>
      <ErrorNote error={err} testid="compliance-error" />
    </div>
  );
}

function CompanyPapers({ state, setState }) {
  const c = state.company;
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const locked = c.status === 'approved' || c.status === 'submitted';
  const has = (k) => c.files.some(f => f.kind === k);
  const submit = async () => { setErr(null); try { setState(await api('/compliance/company/submit', { method: 'POST' })); toast.success('Sent for review'); } catch (e) { setErr(e); } };
  return (
    <div className="flex flex-wrap items-start gap-4" data-testid="compliance-company">
      <Building2 className="w-6 h-6 text-[#818cf8] mt-1" />
      <div className="flex-1 min-w-[220px] space-y-3">
        <div className="flex items-center gap-2 font-semibold">Company papers <StatusPill status={c.status} testid="compliance-company-status" /></div>
        <p className="text-sm text-[var(--c-muted)]">For countries that need ID, business accounts also need a company registration document and a proof of company address (utility bill or bank statement, under 3 months old). We review them within 1 business day.</p>
        {c.status === 'rejected' && c.note && <p className="text-xs text-[#f87171]" data-testid="compliance-company-note">{c.note}</p>}
        {c.files.map(f => (
          <div key={f.id} className="flex items-center gap-2 text-sm" data-testid={`compliance-company-file-${f.id}`}>
            <FileText className="w-4 h-4 text-[#818cf8]" /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-[var(--c-muted)]">{f.kind === 'address' ? 'Address proof' : 'Registration'}</span>
            {!locked && <button className="civr-btn civr-btn-ghost !px-2" aria-label={`Remove ${f.name}`} onClick={() => api(`/compliance/company/${enc(f.id)}`, { method: 'DELETE' }).then(setState).catch(setErr)} data-testid={`compliance-company-remove-${f.id}`}><Trash2 className="w-4 h-4" /></button>}
          </div>
        ))}
        {!locked && <div className="flex flex-wrap gap-2">
          <UploadButton kind="registration" label={has('registration') ? 'Add registration file' : 'Upload registration'} busy={busy} setBusy={setBusy} setState={setState} setErr={setErr} />
          <UploadButton kind="address" label={has('address') ? 'Add address file' : 'Upload address proof'} busy={busy} setBusy={setBusy} setState={setState} setErr={setErr} />
          <button className="civr-btn civr-btn-primary" disabled={!has('registration') || !has('address')} onClick={submit} data-testid="compliance-company-submit-button">Send for review</button>
        </div>}
        <ErrorNote error={err} testid="compliance-company-error" />
      </div>
    </div>
  );
}

function UploadButton({ kind, label, busy, setBusy, setState, setErr }) {
  const input = useRef(null);
  const send = async (list) => {
    if (!list?.length) return;
    setBusy(kind); setErr(null);
    const form = new FormData(); form.append('kind', kind); [...list].slice(0, 4).forEach(f => form.append('files', f));
    try { setState(await api('/compliance/company', { method: 'POST', form })); } catch (e) { setErr(e); } finally { setBusy(null); if (input.current) input.current.value = ''; }
  };
  return (<>
    <input ref={input} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => send(e.target.files)} data-testid={`compliance-${kind}-input`} />
    <button type="button" className="civr-btn" onClick={() => input.current?.click()} disabled={!!busy} data-testid={`compliance-${kind}-upload-button`}>{busy === kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{label}</button>
  </>);
}
