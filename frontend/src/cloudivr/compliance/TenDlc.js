import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquareText } from 'lucide-react';
import { api } from '../api';
import { ErrorNote, Field } from '../ui';
import { StatusPill } from './Compliance';

const USE = { CUSTOMER_CARE: 'Customer care / replies', ACCOUNT_NOTIFICATION: 'Account notifications', DELIVERY_NOTIFICATION: 'Delivery / appointment alerts', MARKETING: 'Marketing and offers', MIXED: 'A mix of the above', TWO_FACTOR_AUTH: 'One-time codes', LOW_VOLUME: 'Low volume (under 2,000/month)' };
const ENT = { PRIVATE_PROFIT: 'Private company', PUBLIC_PROFIT: 'Public (listed) company', NON_PROFIT: 'Non-profit', SOLE_PROPRIETOR: 'Sole proprietor (no EIN)' };
const MAP = { filed: 'pending', active: 'approved', approved: 'pending' };

// Settings → Compliance: US 10DLC brand + campaign form. Admin approves, then it is filed with the carrier.
export function TenDlcCard() {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ brand: {}, campaign: {} });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { api('/tendlc').then(x => { setD(x); if (x.brand) setF({ brand: x.brand, campaign: x.campaign }); }).catch(setErr); }, []);
  if (!d) return null;
  const locked = ['submitted', 'approved', 'filed', 'active'].includes(d.status);
  const set = (g, k) => (e) => setF({ ...f, [g]: { ...f[g], [k]: e.target.value } });
  const inp = (g, k, label, props = {}) => <Field label={label}><input className="civr-input" value={f[g][k] || ''} onChange={set(g, k)} disabled={locked} data-testid={`tendlc-${k}`} {...props} /></Field>;
  const area = (k, label, ph) => <Field label={label}><textarea className="civr-input min-h-[72px]" value={f.campaign[k] || ''} onChange={set('campaign', k)} disabled={locked} placeholder={ph} data-testid={`tendlc-${k}`} /></Field>;
  const save = async () => { setBusy(true); setErr(null); try { setD({ ...d, ...(await api('/tendlc', { method: 'PUT', body: f })) }); toast.success('Sent for review'); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const sole = f.brand.entityType === 'SOLE_PROPRIETOR';
  return (
    <div className="civr-card p-6 space-y-4 lg:col-span-2" id="settings-tendlc" data-testid="settings-tendlc">
      <div className="flex flex-wrap items-center gap-2"><MessageSquareText className="w-5 h-5 text-[#818cf8]" /><div className="font-display text-xl font-bold">US texting registration (10DLC)</div><StatusPill status={MAP[d.status] || d.status} testid="tendlc-status" /></div>
      <p className="text-sm text-[var(--c-muted)]">US carriers require every business that texts from a local number to register. Until it is approved, your US numbers can receive texts but not send them. We review it, then file it with the carrier for you (carrier fees may apply, usually a few dollars).</p>
      {d.note && <p className="text-xs text-[#f87171]" data-testid="tendlc-note">{d.note}</p>}
      {!!d.usNumbers?.length && <p className="text-xs text-[var(--c-muted)]" data-testid="tendlc-numbers">Covers: {d.usNumbers.map(n => n.phoneNumber).join(', ')}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Business type"><select className="civr-input" value={f.brand.entityType || ''} onChange={set('brand', 'entityType')} disabled={locked} data-testid="tendlc-entityType"><option value="">Pick one</option>{Object.entries(ENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {sole ? <>{inp('brand', 'firstName', 'First name')}{inp('brand', 'lastName', 'Last name')}</> : <>{inp('brand', 'companyName', 'Legal company name')}{inp('brand', 'ein', 'EIN (tax ID)', { placeholder: '12-3456789' })}</>}
        {inp('brand', 'website', 'Website', { placeholder: 'https://' })}
        {inp('brand', 'email', 'Support email', { type: 'email' })}{inp('brand', 'phone', 'Support phone')}
        {inp('brand', 'street', 'Street address')}{inp('brand', 'city', 'City')}
        {inp('brand', 'state', 'State (2 letters)', { maxLength: 2 })}{inp('brand', 'postalCode', 'ZIP code')}
        <Field label="What are the texts for?"><select className="civr-input" value={f.campaign.useCase || ''} onChange={set('campaign', 'useCase')} disabled={locked} data-testid="tendlc-useCase"><option value="">Pick one</option>{Object.entries(USE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      {area('description', 'Describe your texts', 'e.g. We send appointment reminders and answer customer questions for our dental clinic.')}
      <div className="grid sm:grid-cols-2 gap-3">{area('sample1', 'Sample message 1', 'Hi Sam, your appointment is tomorrow at 3pm. Reply STOP to opt out.')}{area('sample2', 'Sample message 2', 'Thanks for your order! It ships today. Reply STOP to opt out.')}</div>
      {area('messageFlow', 'How do people agree to get your texts?', 'e.g. Customers tick an unticked “Text me updates” box on our booking form at example.com/book.')}
      <ErrorNote error={err} testid="tendlc-error" />
      {!locked && <button className="civr-btn civr-btn-primary" onClick={save} disabled={busy} data-testid="tendlc-submit-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send for review</button>}
    </div>
  );
}
