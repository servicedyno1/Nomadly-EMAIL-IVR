import React from 'react';
import { FileText } from 'lucide-react';
import { Field } from '../../ui';

export const emptyCover = { on: false, name: '', recipient: '', subject: '', note: '' };
export const coverPayload = (c) => (c.on && (c.name || c.recipient || c.subject || c.note) ? JSON.stringify({ name: c.name, recipient: c.recipient, subject: c.subject, note: c.note }) : null);

// Optional first page: sender + recipient + subject + note. Fax number, page count and date are filled in by the server.
export function CoverPage({ value, onChange, bulk }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4" data-testid="fax-cover">
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input type="checkbox" className="w-4 h-4 accent-[var(--c-accent)]" checked={value.on} onChange={e => onChange({ ...value, on: e.target.checked })} data-testid="fax-cover-toggle" />
        <FileText className="w-4 h-4 text-[var(--c-accent)]" />
        <span className="text-sm font-semibold">Add a cover page</span>
        <span className="text-xs text-[#a1a1aa]">counts as 1 page{bulk ? ' per number' : ''}</span>
      </label>
      {value.on && (
        <div className="grid sm:grid-cols-2 gap-4 civr-rise">
          <Field label="Your name"><input className="civr-input w-full" maxLength={60} value={value.name} onChange={set('name')} placeholder="Jane Smith, Acme Ltd" data-testid="fax-cover-name" /></Field>
          <Field label="Recipient"><input className="civr-input w-full" maxLength={60} value={value.recipient} onChange={set('recipient')} placeholder={bulk ? 'e.g. Accounts team' : 'e.g. Dr. Lee'} data-testid="fax-cover-recipient" /></Field>
          <div className="sm:col-span-2"><Field label="Subject"><input className="civr-input w-full" maxLength={100} value={value.subject} onChange={set('subject')} placeholder="Signed contract" data-testid="fax-cover-subject" /></Field></div>
          <div className="sm:col-span-2">
            <Field label="Note" hint="Your fax number, the page count and today’s date are added for you. Latin letters only.">
              <textarea className="civr-input w-full min-h-[90px]" maxLength={1200} value={value.note} onChange={set('note')} placeholder="Please sign page 3 and fax it back." data-testid="fax-cover-note" />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
