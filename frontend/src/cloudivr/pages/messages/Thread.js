import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Phone, UserPlus, Ban, Loader2, StickyNote } from 'lucide-react';
import { api, enc } from '../../api';
import { useShell } from '../../Shell';
import { DIAL_FROM } from '../../Softphone';
import { ask } from '../../i18n';
import { ErrorNote } from '../../ui';
import { Timeline, Viewer } from './Events';
import { Composer, ReceiveOnly } from './Composer';
import { ContactPanel, AiCard, ScheduledList } from './Extras';

const KIND = { calling: 'Calling number', esim: 'USA eSIM', texting: 'Landline to Texting' };
export function Caps({ n }) {
  const chips = n.old ? ['Old number'] : n.kind === 'texting' ? ['Receive-only'] : [n.caps.send || n.caps.receive ? 'Texts' : null, n.caps.pictures ? 'Pictures' : null, n.caps.calls ? 'Calls' : null].filter(Boolean);
  return <span className="inline-flex flex-wrap gap-1" data-testid={`caps-${n.phone}`}>{chips.map(c => <span key={c} className={`text-[11px] px-2 py-0.5 rounded-full border ${c === 'Old number' ? 'border-[#f59e0b]/50 text-[#b45309]' : 'border-[var(--c-border)] text-[var(--c-muted)]'}`}>{c}</span>)}</span>;
}

function SaveContact({ t, onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = async () => {
    try { await api('/contacts', { method: 'POST', body: { phone: t.contact, name: name.trim() } }); toast.success('Contact saved'); setOpen(false); onSaved(); } catch (e) { toast.error(e.message); }
  };
  if (t.name) return null;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="civr-btn civr-btn-ghost civr-btn-sm" aria-label="Save contact" data-testid="thread-save-contact"><UserPlus className="w-4 h-4" /><span className="hidden sm:inline">Save contact</span></button>;
  return (
    <span className="flex items-center gap-2 w-full sm:w-auto order-last sm:order-none">
      <input autoFocus className="civr-input !h-9 w-40" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder="Name" aria-label="Contact name" data-testid="thread-contact-name-input" />
      <button type="button" onClick={save} disabled={!name.trim()} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="thread-contact-save">Save</button>
    </span>
  );
}

function Header({ t, onBack, reload, onNotes }) {
  const { openPhone } = useShell();
  const call = () => { window.dispatchEvent(new CustomEvent(DIAL_FROM, { detail: { from: t.number.kind === 'calling' && !t.number.old ? t.number.phone : t.replyFrom, to: t.contact } })); openPhone(); };
  const block = async () => {
    if (!t.blocked && !(await ask(`Block ${t.name || t.contact}? You won’t be able to text them from CloudIVR until you unblock them.`, { danger: true, ok: 'Block', title: 'Block this contact?' }))) return;
    try { await api('/messages/block', { method: 'POST', body: { contact: t.contact, on: !t.blocked } }); toast.success(t.blocked ? 'Unblocked' : 'Blocked'); reload(); } catch (e) { toast.error(e.message); }
  };
  const missed = t.events.some(e => ['missed', 'off_hours', 'voicemail'].includes(e.type));
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--c-border)] px-3 sm:px-5 py-3" data-testid="thread-header">
      <button type="button" onClick={onBack} className="md:hidden w-11 h-11 -ml-2 grid place-items-center rounded-full" aria-label="Back to conversations" data-testid="thread-back"><ArrowLeft className="w-5 h-5" /></button>
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate" data-testid="thread-title">{t.name || <span className="font-mono" data-no-translate>{t.contact}</span>}</div>
        <div className="text-xs text-[var(--c-muted)] flex items-center gap-x-2 gap-y-1 overflow-x-auto sm:flex-wrap whitespace-nowrap">
          {t.name && <span className="font-mono" data-no-translate>{t.contact}</span>}
          <span>to <span className="font-mono" data-no-translate>{t.number.phone}</span><span className="hidden sm:inline"> · {t.number.mobile ? 'USA mobile number' : KIND[t.number.kind]}</span></span><span className="hidden sm:inline-flex"><Caps n={t.number} /></span>
          {t.tags?.map(x => <span key={x} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--c-accent-soft)] text-[var(--c-accent)]" data-no-translate data-testid={`thread-tag-${x}`}>{x}</span>)}
        </div>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
        {(t.number.caps?.calls || (t.number.kind === 'calling' && t.replyFrom)) && <button type="button" onClick={call} className="civr-btn civr-btn-primary civr-btn-sm" aria-label={missed ? 'Call back' : 'Call'} data-testid="thread-call"><Phone className="w-4 h-4" /><span className="hidden sm:inline">{missed ? 'Call back' : 'Call'}</span></button>}
        <SaveContact t={t} onSaved={reload} />
        <button type="button" onClick={onNotes} className="civr-btn civr-btn-ghost civr-btn-sm" aria-label="Notes and tags" data-testid="thread-notes"><StickyNote className="w-4 h-4" /><span className="hidden sm:inline">Notes</span></button>
        <button type="button" onClick={block} className="civr-btn civr-btn-ghost civr-btn-sm" aria-label={t.blocked ? 'Unblock' : 'Block'} data-testid="thread-block"><Ban className="w-4 h-4" /><span className="hidden sm:inline">{t.blocked ? 'Unblock' : 'Block'}</span></button>
      </div>
    </div>
  );
}

function Footer({ t, onSent, seed, reload }) {
  if (t.blocked) return <ReceiveOnly text="You blocked this contact. Unblock them to text." />;
  if (t.number.kind === 'texting') return <ReceiveOnly text="This number receives texts only" />;
  if (t.number.kind === 'esim' && !t.number.mobile && !t.replyFrom) return <ReceiveOnly text="Texts on a QR eSIM are on your phone. Older texts stay here to read." />;
  if (!t.replyFrom) return <ReceiveOnly text="This number can’t send texts right now." />;
  if (!t.canText) return <ReceiveOnly text="This number can’t receive texts." />;
  return <><ScheduledList items={t.scheduled} reload={reload} /><Composer t={t} onSent={onSent} seed={seed} onScheduled={reload} /></>;
}

export function Thread({ number, contact, onBack, onChange }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [seed, setSeed] = useState(null);
  const end = useRef(null);
  const q = `number=${enc(number)}&contact=${enc(contact)}`;
  const load = useCallback(async () => {
    try { const d = await api(`/messages/thread?${q}`); setT(cur => (cur && cur.contact === d.contact && cur.number.phone === d.number.phone ? { ...d, events: [...d.events, ...cur.events.filter(e => e.status === 'sending' || (e.status === 'failed' && String(e.id).startsWith('tmp-')))] } : d)); setErr(null); } catch (e) { setErr(e); }
  }, [q]);
  useEffect(() => { setT(null); load(); api('/messages/read', { method: 'POST', body: { number, contact } }).then(onChange).catch(() => {}); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [t?.events?.length]);
  const onSent = (e) => setT(cur => ({ ...cur, events: e.replaces ? cur.events.map(x => (x.id === e.replaces ? e : x)) : [...cur.events, e] }));
  if (err) return <div className="p-6"><ErrorNote error={err} onRetry={load} testid="thread-error" /></div>;
  if (!t) return <div className="flex-1 grid place-items-center text-[var(--c-muted)]" data-testid="thread-loading"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  return (
    <div className="flex flex-col h-full min-h-0 civr-thread-in" data-testid="thread">
      <Header t={t} onBack={onBack} reload={load} onNotes={() => setNotesOpen(o => !o)} />
      {notesOpen && <ContactPanel t={t} onSaved={() => { load(); onChange(); }} onClose={() => setNotesOpen(false)} />}
      {!notesOpen && <AiCard ai={t.ai} onPick={(text) => setSeed({ text, n: Date.now() })} />}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-3" aria-live="polite" data-testid="thread-events">
        {t.number.old && <p className="text-xs text-center text-[#b45309] mb-2" data-testid="thread-old-number">Old number: replaced by <span className="font-mono" data-no-translate>{t.number.old.newNumber}</span>{t.number.kind === 'calling' && t.number.old.until ? `, keeps working until ${new Date(t.number.old.until).toLocaleDateString()}` : ''}</p>}
        <Timeline events={t.events} onView={setView} />
        <div ref={end} />
      </div>
      <Footer t={t} seed={seed} reload={load} onSent={(e, pending) => { onSent(e); if (!pending) onChange(); }} />
      <Viewer id={view} onClose={() => setView(null)} />
    </div>
  );
}
