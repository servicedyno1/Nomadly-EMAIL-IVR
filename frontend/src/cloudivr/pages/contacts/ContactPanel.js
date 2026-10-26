import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2, X, Mail, Building2 } from 'lucide-react';
import { api, enc, day } from '../../api';
import { Field, ErrorNote, Skel } from '../../ui';
import { ask } from '../../confirm';
import { usePrivacy } from '../../privacy';
import { Modal, Avatar } from './Modal';
import { CallActions } from './CallActions';

export const EMPTY_CONTACT = { phone: '', name: '', email: '', company: '', notes: '', listIds: [], fields: [] };

// Name, phone, email, company, notes and list membership (shared by "Add contact" and the contact panel).
export function ContactFields({ f, set, lists, testid = 'contact' }) {
  const pv = usePrivacy();
  const toggleList = (id) => set({ listIds: f.listIds.includes(id) ? f.listIds.filter(x => x !== id) : [...f.listIds, id] });
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name"><input className="civr-input" maxLength={80} value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Jane Doe" data-testid={`${testid}-name-input`} /></Field>
        <Field label="Phone number" hint="With country code."><input className={`civr-input font-mono ${pv.input}`} inputMode="tel" required value={f.phone} onChange={e => set({ phone: e.target.value })} placeholder="+14155550100" data-testid={`${testid}-phone-input`} /></Field>
        <Field label="Email"><input className="civr-input" type="email" maxLength={120} value={f.email} onChange={e => set({ email: e.target.value })} placeholder="jane@example.com" data-testid={`${testid}-email-input`} /></Field>
        <Field label="Company"><input className="civr-input" maxLength={120} value={f.company} onChange={e => set({ company: e.target.value })} placeholder="Acme Inc." data-testid={`${testid}-company-input`} /></Field>
      </div>
      <Field label="Notes"><textarea rows={3} maxLength={2000} className="civr-input" value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder="Anything to remember before you call" data-testid={`${testid}-notes-input`} /></Field>
      {f.fields.length > 0 && (
        <div data-testid={`${testid}-extra-fields`}>
          <div className="text-[13px] font-medium text-[#d4d4d8] mb-1.5">More from the spreadsheet</div>
          <div className="flex flex-col gap-1.5">{f.fields.map((x, i) => (
            <div key={`${x.label}-${i}`} className="flex items-center gap-3 rounded-lg border border-[#222] px-3 py-2 text-sm" data-testid={`${testid}-extra-field-${i}`}>
              <span className="text-[#a1a1aa] w-32 shrink-0 truncate" title={x.label}>{x.label}</span><span className="flex-1 min-w-0 break-words">{x.value}</span>
              <button type="button" onClick={() => set({ fields: f.fields.filter((_, k) => k !== i) })} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[#a1a1aa] hover:text-white hover:bg-white/5" aria-label={`Remove ${x.label}`} data-testid={`${testid}-extra-field-${i}-remove`}><X className="w-4 h-4" /></button>
            </div>
          ))}</div>
        </div>
      )}
      {lists.length > 0 && (
        <div>
          <div className="text-[13px] font-medium text-[#d4d4d8] mb-1.5">Lists</div>
          <div className="flex flex-wrap gap-1.5" data-testid={`${testid}-lists`}>{lists.map((l, i) => (
            <button key={l.id} type="button" onClick={() => toggleList(l.id)} aria-pressed={f.listIds.includes(l.id)} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-9 ${f.listIds.includes(l.id) ? 'civr-pill-on' : ''}`} data-testid={`${testid}-list-toggle-${i}`}>{l.name}</button>
          ))}</div>
        </div>
      )}
    </div>
  );
}

export function AddContact({ lists, listId, onClose, onSaved }) {
  const [f, setF] = useState({ ...EMPTY_CONTACT, listIds: listId && listId !== 'all' ? [listId] : [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (p) => setF(x => ({ ...x, ...p }));
  const save = async (e) => {
    e?.preventDefault(); setBusy(true); setError(null);
    try { const d = await api('/contacts', { method: 'POST', body: f }); toast.success('Contact saved'); onSaved(d.contact); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a contact" onClose={onClose} testid="contact-add-dialog" footer={<>
      <button type="button" className="civr-btn civr-btn-ghost" onClick={onClose} data-testid="contact-add-cancel">Cancel</button>
      <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !f.phone.trim()} onClick={save} data-testid="contact-add-save">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save contact</button>
    </>}>
      <form onSubmit={save} className="space-y-4"><ContactFields f={f} set={set} lists={lists} testid="contact-add" /><ErrorNote error={error} testid="contact-add-error" /><button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} /></form>
    </Modal>
  );
}

const pick = (c) => ({ phone: c.phone, name: c.name, email: c.email, company: c.company, notes: c.notes, listIds: c.listIds, fields: c.fields });

// One contact: call actions first, then the editable details.
export function ContactPanel({ id, lists, onClose, onChanged }) {
  const pv = usePrivacy();
  const [c, setC] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/contacts/${enc(id)}`).then(d => { setC(d.contact); setF(pick(d.contact)); }).catch(setError); }, [id]);
  const set = (p) => setF(x => ({ ...x, ...p }));
  const dirty = c && f && JSON.stringify(pick(c)) !== JSON.stringify(f);
  const save = async () => {
    setBusy(true); setError(null);
    try { const d = await api(`/contacts/${enc(id)}`, { method: 'PATCH', body: f }); setC(d.contact); setF(pick(d.contact)); toast.success('Contact updated'); onChanged(); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await ask(`Delete ${c.name || pv.phone(c.phone)} from your contacts? This can’t be undone.`, { danger: true, ok: 'Delete contact' }))) return;
    try { await api(`/contacts/${enc(id)}`, { method: 'DELETE' }); toast.success('Contact deleted'); onChanged(); onClose(); } catch (err) { toast.error(err.message); }
  };
  const title = c ? (c.name || pv.phone(c.phone)) : 'Contact';
  return (
    <Modal side title={title} sub={c ? <span className="font-mono">{pv.phone(c.phone)}</span> : null} onClose={onClose} testid="contact-panel" footer={c && <>
      <button type="button" className="civr-btn civr-btn-ghost !text-[#fb7185] sm:mr-auto" onClick={remove} data-testid="contact-delete-button"><Trash2 className="w-4 h-4" />Delete</button>
      <button type="button" className="civr-btn civr-btn-primary" disabled={!dirty || busy || !f.phone.trim()} onClick={save} data-testid="contact-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save changes</button>
    </>}>
      {!c ? (error ? <ErrorNote error={error} testid="contact-panel-error" /> : <div className="space-y-4"><Skel className="h-12 w-2/3" /><Skel className="h-40 w-full rounded-xl" /></div>) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3" data-testid="contact-panel-summary">
            <Avatar name={c.name} phone={c.phone} className="w-12 h-12 text-sm" />
            <div className="min-w-0 text-sm text-[#a1a1aa] space-y-0.5">
              {c.company && <div className="flex items-center gap-1.5 truncate"><Building2 className="w-3.5 h-3.5 shrink-0" />{c.company}</div>}
              {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 truncate hover:text-white"><Mail className="w-3.5 h-3.5 shrink-0" />{pv.text(c.email)}</a>}
              <div className="text-xs">Saved {day(c.createdAt)}</div>
            </div>
          </div>
          <section><div className="civr-label mb-3">Call</div><CallActions contact={c} /></section>
          <section><div className="civr-label mb-3">Details</div><ContactFields f={f} set={set} lists={lists} testid="contact-edit" /><ErrorNote error={error} testid="contact-save-error" className="mt-4" /></section>
        </div>
      )}
    </Modal>
  );
}
