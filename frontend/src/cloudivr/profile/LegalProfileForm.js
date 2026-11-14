import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, User, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useCivrAuth } from '../AuthContext';
import { Field, ErrorNote } from '../ui';
import { AddressField } from './AddressField';

const EMPTY = { type: '', fullName: '', companyName: '', registrationNumber: '', vatNumber: '', website: '', address: {} };
let countriesCache = null;
const loadCountries = () => (countriesCache ||= api('/phone-countries').then(d => d.countries || []).catch((e) => { countriesCache = null; throw e; }));

function TypeCard({ k, icon: Icon, title, sub, value, onPick }) {
  const on = value === k;
  return (
    <button type="button" role="radio" aria-checked={on} onClick={() => onPick(k)} data-testid={`profile-type-${k}`}
      className={`text-left rounded-xl border p-4 transition-colors ${on ? 'border-[#818cf8] bg-[#818cf8]/10' : 'border-[#2a2a2a] hover:border-[#3f3f46]'}`}>
      <Icon className={`w-5 h-5 mb-2 ${on ? 'text-[#818cf8]' : 'text-[#a1a1aa]'}`} />
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-[#a1a1aa] mt-0.5">{sub}</div>
    </button>
  );
}

function BusinessFields({ f, set }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2"><Field label="Registered business name"><input className="civr-input" value={f.companyName} onChange={set('companyName')} autoComplete="organization" data-testid="profile-company-input" /></Field></div>
      <Field label="Registration number (optional)"><input className="civr-input" value={f.registrationNumber} onChange={set('registrationNumber')} data-testid="profile-regno-input" /></Field>
      <Field label="VAT / tax number (optional)"><input className="civr-input" value={f.vatNumber} onChange={set('vatNumber')} data-testid="profile-vat-input" /></Field>
      <div className="sm:col-span-2"><Field label="Website (optional)"><input className="civr-input" value={f.website} onChange={set('website')} placeholder="example.com" data-testid="profile-website-input" /></Field></div>
    </div>
  );
}

// Individual or business + legal name + address. Used at sign-up, before buying, and in Settings.
export function LegalProfileForm({ onSaved, onLater, submitLabel = 'Save details', testid = 'legal-profile-form' }) {
  const { refresh } = useCivrAuth();
  const [f, setF] = useState(null);
  const [countries, setCountries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    api('/profile/legal').then(d => setF({ ...EMPTY, ...(d.profile || {}), address: d.profile?.address || {} })).catch(() => setF(EMPTY));
    loadCountries().then(setCountries).catch(() => {});
  }, []);
  if (!f) return <div className="flex items-center gap-2 text-sm text-[#a1a1aa] py-6" data-testid={`${testid}-loading`}><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const biz = f.type === 'business';
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const d = await api('/profile/legal', { method: 'PUT', body: f }); await refresh(); toast.success('Details saved'); onSaved?.(d.profile); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-6" data-testid={testid}>
      <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-3">
        <TypeCard k="individual" icon={User} title="Individual" sub="Numbers in your own name" value={f.type} onPick={(t) => setF({ ...f, type: t })} />
        <TypeCard k="business" icon={Building2} title="Business" sub="Numbers in your company’s name" value={f.type} onPick={(t) => setF({ ...f, type: t })} />
      </div>
      {f.type && <div className="space-y-6 civr-rise">
        {biz && <BusinessFields f={f} set={set} />}
        <Field label={biz ? 'Contact person (full name)' : 'Full legal name'} hint={biz ? null : 'As on your ID. Used where a carrier asks for the number holder’s name.'}>
          <input className="civr-input" value={f.fullName} onChange={set('fullName')} autoComplete="name" data-testid="profile-fullname-input" />
        </Field>
        <div className="pt-1"><div className="text-sm font-semibold mb-3">{biz ? 'Business address' : 'Home address'}</div>
          <AddressField value={f.address} onChange={(address) => setF({ ...f, address })} countries={countries} />
        </div>
      </div>}
      <p className="text-xs text-[#a1a1aa] flex gap-2" data-testid="profile-privacy-note"><ShieldCheck className="w-4 h-4 shrink-0 text-[#818cf8]" />Carriers need to know who uses each number. We send these details only to the carrier of a number you buy, and register the number as resold to you.</p>
      <ErrorNote error={error} testid={`${testid}-error`} />
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        {onLater && <button type="button" className="civr-btn civr-btn-ghost" onClick={onLater} data-testid={`${testid}-later-button`}>Do this later</button>}
        <button className="civr-btn civr-btn-primary" disabled={busy || !f.type} data-testid={`${testid}-save-button`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{submitLabel}</button>
      </div>
    </form>
  );
}
