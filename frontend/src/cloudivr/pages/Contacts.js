import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Contact, FileUp, UserPlus, Search, Loader2, ChevronRight } from 'lucide-react';
import { api, enc, useApi } from '../api';
import { PageHeader, SkeletonRows, Empty, ErrorNote } from '../ui';
import { usePrivacy } from '../privacy';
import { ListsNav, ListActions } from './contacts/Lists';
import { ContactPanel, AddContact } from './contacts/ContactPanel';
import { ImportDialog } from './contacts/ImportDialog';
import { Avatar } from './contacts/Modal';

const PAGE = 50;

// Loads one page of contacts for the list + search; `more()` appends the next page. Late answers are ignored.
function useContacts(listId, term) {
  const [st, setSt] = useState({ items: [], total: 0, loading: true, error: null });
  const seq = useRef(0);
  const load = useCallback(async (skip = 0) => {
    const n = ++seq.current;
    setSt(s => ({ ...s, loading: true, error: null }));
    try {
      const d = await api(`/contacts?list=${enc(listId)}&q=${enc(term)}&skip=${skip}&limit=${PAGE}`);
      if (n === seq.current) setSt(s => ({ items: skip ? [...s.items, ...d.contacts] : d.contacts, total: d.total, loading: false, error: null }));
    } catch (e) { if (n === seq.current) setSt(s => ({ ...s, loading: false, error: e })); }
  }, [listId, term]);
  useEffect(() => { load(0); }, [load]);
  return { ...st, reload: () => load(0), more: () => load(st.items.length) };
}

function Row({ c, i, onOpen, pv }) {
  return (
    <button type="button" onClick={() => onOpen(c.id)} className="w-full text-left grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-3 md:gap-4 px-4 py-3 hover:bg-white/[0.03] transition-colors border-t border-[#1a1a1a] first:border-t-0" data-testid={`contact-row-${i}`}>
      <Avatar name={c.name} phone={c.phone} />
      <div className="min-w-0" data-no-translate={c.name ? true : undefined}>
        <div className="font-medium truncate" data-testid={`contact-row-${i}-name`}>{c.name || <span className="text-[#a1a1aa]">No name</span>}</div>
        <div className="md:hidden text-xs text-[#a1a1aa] font-mono truncate">{pv.phone(c.phone)}{c.company ? <span className="font-sans"> · {c.company}</span> : null}</div>
      </div>
      <div className="hidden md:block font-mono text-sm text-[#d4d4d8] truncate" data-testid={`contact-row-${i}-phone`}>{pv.phone(c.phone)}</div>
      <div className="hidden md:block text-sm text-[#a1a1aa] truncate">{pv.text(c.email) || '—'}</div>
      <div className="hidden md:block text-sm text-[#a1a1aa] truncate" data-no-translate>{c.company || '—'}</div>
      <ChevronRight className="w-4 h-4 text-[#52525b]" />
    </button>
  );
}

function ContactList({ s, onOpen, pv }) {
  return (
    <div className="civr-card overflow-hidden" data-testid="contacts-table">
      <div className="hidden md:grid grid-cols-[2.5rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_1rem] gap-4 px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-[#a1a1aa] border-b border-[#1f1f1f] bg-[#111113]">
        <span /><span>Name</span><span>Phone</span><span>Email</span><span>Company</span><span />
      </div>
      {s.items.map((c, i) => <Row key={c.id} c={c} i={i} onOpen={onOpen} pv={pv} />)}
      {s.items.length < s.total && (
        <button type="button" onClick={s.more} disabled={s.loading} className="civr-btn civr-btn-ghost civr-btn-sm w-full !rounded-none border-t border-[#1a1a1a]" data-testid="contacts-show-more">{s.loading && <Loader2 className="w-4 h-4 animate-spin" />}{`Show more (${(s.total - s.items.length).toLocaleString()} left)`}</button>
      )}
    </div>
  );
}

export default function Contacts() {
  const pv = usePrivacy();
  const [params, setParams] = useSearchParams();
  const listId = params.get('list') || 'all';
  const { data: ld, reload: reloadLists } = useApi('/contacts/lists');
  const lists = ld?.lists || [];
  const list = lists.find(l => l.id === listId);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const s = useContacts(listId, term);
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null);
  const pick = (id) => setParams(id === 'all' ? {} : { list: id }, { replace: true });
  const refresh = () => { s.reload(); reloadLists(); };
  useEffect(() => { if (ld && listId !== 'all' && !list) pick('all'); }, [ld, listId, list]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = ld && !ld.total;

  return (
    <div data-testid="contacts-page">
      <PageHeader label="Calling" title="Contacts" sub="Save the people you call. Upload a spreadsheet and we match the columns for you, then call anyone in one tap or send a whole list a Bulk IVR campaign." testid="contacts-header">
        <button type="button" className="civr-btn civr-btn-primary" onClick={() => setDialog('import')} data-testid="contacts-import-button"><FileUp className="w-4 h-4" />Upload contacts</button>
        <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setDialog('add')} data-testid="contacts-add-button"><UserPlus className="w-4 h-4" />Add contact</button>
      </PageHeader>
      {none ? (
        <Empty icon={Contact} title="No contacts yet" sub="Upload an Excel (.xlsx), .csv or .txt file — we find the phone, name and email columns — or add someone by hand." testid="contacts-empty">
          <button type="button" className="civr-btn civr-btn-primary" onClick={() => setDialog('import')} data-testid="contacts-empty-import-button"><FileUp className="w-4 h-4" />Upload contacts</button>
          <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setDialog('add')} data-testid="contacts-empty-add-button"><UserPlus className="w-4 h-4" />Add contact</button>
        </Empty>
      ) : (
        <div className="grid lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)] gap-4 items-start">
          <ListsNav lists={lists} total={ld?.total || 0} active={listId} onPick={pick} onCreated={(l) => { reloadLists().then(() => pick(l.id)); }} />
          <div className="min-w-0 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-display text-2xl font-bold truncate" data-testid="contacts-current-list">{list ? list.name : 'All contacts'}</div>
                <div className="text-xs text-[#a1a1aa]" data-testid="contacts-count">{`${s.total.toLocaleString()} contacts`}</div>
              </div>
              {list && <ListActions key={list.id} list={list} onChanged={reloadLists} onDeleted={() => { pick('all'); refresh(); }} />}
            </div>
            <label className="relative block md:max-w-md">
              <Search className="w-4 h-4 text-[#a1a1aa] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input className="civr-input !pl-10" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, number, email or company" aria-label="Search contacts" data-testid="contacts-search-input" />
            </label>
            <ErrorNote error={s.error} onRetry={s.reload} testid="contacts-error" />
            {s.loading && !s.items.length ? <SkeletonRows rows={5} /> : !s.items.length ? (
              <Empty icon={Contact} title={term ? 'No contacts match your search' : 'This list is empty'} sub={term ? 'Try part of the name or number.' : 'Upload a file into this list, or add people from their contact page.'} testid="contacts-list-empty">
                {!term && <button type="button" className="civr-btn civr-btn-primary" onClick={() => setDialog('import')} data-testid="contacts-list-empty-import"><FileUp className="w-4 h-4" />Upload contacts</button>}
              </Empty>
            ) : <ContactList s={s} onOpen={setOpen} pv={pv} />}
          </div>
        </div>
      )}
      {open && <ContactPanel id={open} lists={lists} onClose={() => setOpen(null)} onChanged={refresh} />}
      {dialog === 'add' && <AddContact lists={lists} listId={listId} onClose={() => setDialog(null)} onSaved={(c) => { setDialog(null); refresh(); setOpen(c.id); }} />}
      {dialog === 'import' && <ImportDialog lists={lists} listId={listId} onClose={() => setDialog(null)} onDone={(l, view) => { refresh(); if (view) pick(l.id); }} />}
    </div>
  );
}
