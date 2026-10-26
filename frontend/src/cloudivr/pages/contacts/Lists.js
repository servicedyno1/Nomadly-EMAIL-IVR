import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Users, Megaphone, Pencil, Trash2, Loader2, Check, X } from 'lucide-react';
import { api, enc } from '../../api';
import { ask } from '../../confirm';
import { cp } from '../../paths';

const count = (n) => `${Number(n || 0).toLocaleString()}`;

function NewList({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const d = await api('/contacts/lists', { method: 'POST', body: { name } }); toast.success(`List “${d.list.name}” created`); setName(''); setOpen(false); onCreated(d.list); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="civr-nav-link w-full text-[#818cf8]" data-testid="contacts-new-list-button"><Plus className="w-4 h-4" />New list</button>;
  return (
    <form onSubmit={save} className="flex gap-2 p-1" data-testid="contacts-new-list-form">
      <input autoFocus className="civr-input !h-10 text-sm" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="List name" aria-label="List name" data-testid="contacts-new-list-input" />
      <button className="civr-btn civr-btn-primary civr-btn-sm !px-3" disabled={busy || !name.trim()} aria-label="Create list" data-testid="contacts-new-list-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}</button>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !px-3" onClick={() => setOpen(false)} aria-label="Cancel" data-testid="contacts-new-list-cancel"><X className="w-4 h-4" /></button>
    </form>
  );
}

const Item = ({ active, onClick, label, n, testid }) => (
  <button type="button" onClick={onClick} className={`civr-nav-link w-full justify-between ${active ? 'active' : ''}`} aria-current={active ? 'true' : undefined} data-testid={testid}>
    <span className="truncate min-w-0">{label}</span><span className="font-mono text-xs text-[#a1a1aa] shrink-0">{count(n)}</span>
  </button>
);

// Desktop: a card with every list. Phones / tablets: a scrolling row of list pills.
export function ListsNav({ lists, total, active, onPick, onCreated }) {
  return (
    <>
      <aside className="hidden lg:block civr-card p-3 h-fit sticky top-24" data-testid="contacts-lists-card">
        <div className="px-3 pt-1 pb-2 text-xs font-mono uppercase tracking-widest text-[#a1a1aa]">Lists</div>
        <Item active={active === 'all'} onClick={() => onPick('all')} label={<span className="flex items-center gap-2"><Users className="w-4 h-4" />All contacts</span>} n={total} testid="contacts-list-all" />
        <div className="mt-1 flex flex-col gap-0.5 max-h-[55vh] overflow-y-auto">{lists.map((l, i) => <Item key={l.id} active={active === l.id} onClick={() => onPick(l.id)} label={l.name} n={l.count} testid={`contacts-list-${i}`} />)}</div>
        <div className="mt-2 pt-2 border-t border-[#1f1f1f]"><NewList onCreated={onCreated} /></div>
      </aside>
      <div className="lg:hidden civr-scroll-x flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" data-testid="contacts-lists-pills">
        {[{ id: 'all', name: 'All contacts', count: total }, ...lists].map((l, i) => (
          <button key={l.id} type="button" onClick={() => onPick(l.id)} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-10 shrink-0 ${active === l.id ? 'civr-pill-on' : ''}`} data-testid={l.id === 'all' ? 'contacts-pill-all' : `contacts-pill-${i - 1}`}>{l.name}<span className="font-mono text-xs opacity-70">{count(l.count)}</span></button>
        ))}
      </div>
    </>
  );
}

// Actions for the open list: send it a campaign, rename, delete (contacts stay saved).
export function ListActions({ list, onChanged, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const rename = async (e) => {
    e.preventDefault();
    try { await api(`/contacts/lists/${enc(list.id)}`, { method: 'PATCH', body: { name } }); toast.success('List renamed'); setEditing(false); onChanged(); } catch (err) { toast.error(err.message); }
  };
  const remove = async () => {
    if (!(await ask(`Delete the list “${list.name}”? The contacts in it stay saved in All contacts.`, { danger: true, ok: 'Delete list' }))) return;
    try { await api(`/contacts/lists/${enc(list.id)}`, { method: 'DELETE' }); toast.success('List deleted'); onDeleted(); } catch (err) { toast.error(err.message); }
  };
  if (editing) return (
    <form onSubmit={rename} className="flex gap-2 w-full sm:w-auto" data-testid="contacts-rename-form">
      <input autoFocus className="civr-input !h-10 text-sm sm:w-56" maxLength={60} value={name} onChange={e => setName(e.target.value)} aria-label="List name" data-testid="contacts-rename-input" />
      <button className="civr-btn civr-btn-primary civr-btn-sm" disabled={!name.trim()} data-testid="contacts-rename-save">Save</button>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => { setEditing(false); setName(list.name); }} data-testid="contacts-rename-cancel">Cancel</button>
    </form>
  );
  return (
    <div className="flex flex-wrap gap-2" data-testid="contacts-list-actions">
      <Link to={cp(`/app/campaigns/new?list=${enc(list.id)}`)} className={`civr-btn civr-btn-primary civr-btn-sm ${list.count ? '' : 'pointer-events-none opacity-40'}`} aria-disabled={!list.count} data-testid="contacts-list-campaign-button"><Megaphone className="w-4 h-4" />Start a campaign</Link>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setEditing(true)} data-testid="contacts-list-rename-button"><Pencil className="w-4 h-4" />Rename</button>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !text-[#fb7185]" onClick={remove} data-testid="contacts-list-delete-button"><Trash2 className="w-4 h-4" />Delete list</button>
    </div>
  );
}
