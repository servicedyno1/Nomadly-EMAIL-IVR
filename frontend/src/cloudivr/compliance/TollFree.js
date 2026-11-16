import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquareText } from 'lucide-react';
import { api, enc } from '../api';
import { ErrorNote, Field } from '../ui';
import { StatusPill } from './Compliance';

const USE = { CUSTOMER_CARE: 'Customer care / replies', ACCOUNT_NOTIFICATION: 'Account notifications', DELIVERY_NOTIFICATION: 'Delivery / appointment alerts', MARKETING: 'Marketing and offers', MIXED: 'A mix of the above', TWO_FACTOR_AUTH: 'One-time codes' };
const MAP = { submitted: 'pending', filed: 'pending', active: 'approved' };
const LOCKED = ['submitted', 'filed', 'active'];

// Texting tab of a US/Canada toll-free number: the carrier's toll-free texting verification. We check it, then file it.
export function TollFreeCard({ num }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ country: num.country || 'US' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { api(`/numbers/${enc(num.phoneNumber)}/tollfree`).then(x => { setD(x); if (x.form) setF(x.form); }).catch(setErr); }, [num.phoneNumber]);
  if (!d) return err ? <ErrorNote error={err} testid="tollfree-load-error" /> : null;
  const locked = LOCKED.includes(d.status);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const inp = (k, label, props = {}) => <Field label={label}><input className="civr-input" value={f[k] || ''} onChange={set(k)} disabled={locked} data-testid={`tollfree-${k}`} {...props} /></Field>;
  const area = (k, label, ph) => <Field label={label}><textarea className="civr-input min-h-[72px]" value={f[k] || ''} onChange={set(k)} disabled={locked} placeholder={ph} data-testid={`tollfree-${k}`} /></Field>;
  const pick = (k, label, opts) => <Field label={label}><select className="civr-input" value={f[k] || ''} onChange={set(k)} disabled={locked} data-testid={`tollfree-${k}`}><option value="">Pick one</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
  const save = async () => { setBusy(true); setErr(null); try { setD({ ...d, ...(await api(`/numbers/${enc(num.phoneNumber)}/tollfree`, { method: 'PUT', body: f })) }); toast.success('Sent for review'); } catch (e) { setErr(e); } finally { setBusy(false); } };
  if (d.carrierVerified) return <p className="text-sm text-[#34d399]" data-testid="tollfree-verified">This toll-free number is verified for texting. Switch texting on above.</p>;
  return (
    <div className="civr-card p-6 space-y-4" data-testid="tollfree-card">
      <div className="flex flex-wrap items-center gap-2"><MessageSquareText className="w-5 h-5 text-[#818cf8]" /><div className="font-display text-xl font-bold">Toll-free texting verification</div><StatusPill status={MAP[d.status] || d.status} testid="tollfree-status" /></div>
      <p className="text-sm text-[var(--c-muted)]">US and Canadian carriers only deliver texts from a toll-free number once the business behind it is verified. Fill this in once — we check it and file it with the carrier for you. It usually takes a few business days; we’ll tell you when texting can be switched on.</p>
      {d.status === 'filed' && <p className="text-xs text-[var(--c-muted)]" data-testid="tollfree-filed-note">Sent to the carrier — waiting for their approval.</p>}
      {d.note && <p className="text-xs text-[#f87171]" data-testid="tollfree-note">{d.note}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {inp('businessName', 'Legal business name')}{inp('website', 'Website', { placeholder: 'https://' })}
        {inp('contactName', 'Contact name')}{inp('email', 'Contact email', { type: 'email' })}
        {inp('phone', 'Contact phone')}{pick('country', 'Country', [['US', 'United States'], ['CA', 'Canada']])}
        {inp('street', 'Street address')}{inp('city', 'City')}
        {inp('state', 'State / province (2 letters)', { maxLength: 2 })}{inp('postalCode', 'ZIP / postal code')}
        {pick('useCase', 'What are the texts for?', Object.entries(USE))}{pick('volume', 'Texts per month (about)', (d.volumes || []).map(v => [v, `Up to ${v}`]))}
      </div>
      {area('description', 'Describe your texts', 'e.g. We answer customer questions and send order updates for our online store.')}
      {area('sample', 'Sample message', 'Hi Sam, your order #1234 has shipped. Reply STOP to opt out.')}
      {area('optIn', 'How do people agree to get your texts?', 'e.g. Customers tick an unticked “Text me updates” box at checkout on example.com.')}
      {inp('optInUrl', 'Link to where they agree (optional)', { placeholder: 'https://example.com/checkout' })}
      <ErrorNote error={err} testid="tollfree-error" />
      {!locked && <button className="civr-btn civr-btn-primary" onClick={save} disabled={busy} data-testid="tollfree-submit-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send for review</button>}
    </div>
  );
}
