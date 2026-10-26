import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Loader2, CheckCircle2, Megaphone, ClipboardPaste } from 'lucide-react';
import { api, enc } from '../../api';
import { ErrorNote } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';
import { Modal } from './Modal';
import { MatchColumns, Review } from './ImportSteps';

const ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function PickFile({ busy, onFile, onPaste }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState(null);
  const drop = (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); };
  return (
    <div className="space-y-4" data-testid="contacts-import-pick">
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={drop}
        className={`w-full rounded-2xl border-2 border-dashed px-6 py-10 flex flex-col items-center text-center gap-3 transition-colors ${drag ? 'border-[#818cf8] bg-[#818cf8]/10' : 'border-[#2a2a2a] hover:border-[#3f3f46] bg-[#111113]'}`} data-testid="contacts-import-dropzone">
        <span className="w-14 h-14 rounded-2xl bg-[#818cf8]/10 text-[#818cf8] flex items-center justify-center">{busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <FileSpreadsheet className="w-7 h-7" />}</span>
        <span className="font-display text-xl font-bold">{busy ? 'Reading your file…' : 'Drop your file here, or tap to choose'}</span>
        <span className="text-sm text-[#a1a1aa] max-w-sm">Excel (.xlsx), .csv or .txt · up to 10,000 contacts · 10 MB. We find the phone, name and email columns for you.</span>
      </button>
      <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} data-testid="contacts-import-file-input" />
      {paste === null ? (
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setPaste('')} data-testid="contacts-import-paste-button"><ClipboardPaste className="w-4 h-4" />Paste numbers instead</button>
      ) : (
        <div className="space-y-2">
          <textarea autoFocus rows={6} className="civr-input font-mono text-xs" value={paste} onChange={e => setPaste(e.target.value)} placeholder={'+14155550100,Jane Doe\n+14155550101,Bob'} aria-label="Paste numbers" data-testid="contacts-import-paste-input" />
          <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !paste.trim()} onClick={() => onPaste(paste)} data-testid="contacts-import-paste-continue">Continue</button>
        </div>
      )}
    </div>
  );
}

function Done({ result, onView, onClose }) {
  const r = result;
  return (
    <div className="text-center py-6 space-y-4" data-testid="contacts-import-done">
      <CheckCircle2 className="w-12 h-12 text-[#818cf8] mx-auto" />
      <div className="font-display text-2xl font-bold">{`Saved to “${r.list.name}”`}</div>
      <div className="text-sm text-[#a1a1aa]" data-testid="contacts-import-done-summary">{[`${r.created} added`, r.updated ? `${r.updated} updated` : null, r.skipped ? `${r.skipped} already saved, kept as they were` : null, r.invalid ? `${r.invalid} rows without a valid number left out` : null].filter(Boolean).join(' · ')}</div>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button type="button" className="civr-btn civr-btn-primary" onClick={onView} data-testid="contacts-import-view-list">View the list</button>
        <Link to={cp(`/app/campaigns/new?list=${enc(r.list.id)}`)} onClick={onClose} className="civr-btn civr-btn-ghost" data-testid="contacts-import-start-campaign"><Megaphone className="w-4 h-4" />Start a campaign</Link>
      </div>
    </div>
  );
}

const STEPS = { pick: 'Upload contacts', match: 'Match your columns', review: 'Check and import', done: 'Contacts imported' };

export function ImportDialog({ lists, listId, onClose, onDone }) {
  const pv = usePrivacy();
  const [step, setStep] = useState('pick');
  const [parsed, setParsed] = useState(null);
  const [roles, setRoles] = useState([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [dest, setDest] = useState({ mode: listId && listId !== 'all' ? 'existing' : 'new', name: '', listId: listId !== 'all' ? listId : '' });
  const [check, setCheck] = useState(null);
  const [dup, setDup] = useState('skip');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const got = (d) => { setParsed(d); setRoles(d.columns.map(c => c.role)); setHasHeader(d.hasHeader); setDest(x => ({ ...x, name: x.name || d.fileName.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) })); setStep('match'); };
  const onFile = (file) => run(async () => { const form = new FormData(); form.append('file', file); got(await api('/contacts/import/parse', { method: 'POST', form })); });
  const onPaste = (text) => run(async () => got(await api('/contacts/import/parse', { method: 'POST', body: { text, fileName: 'Pasted list' } })));
  const base = () => ({ importId: parsed.importId, roles, hasHeader });
  const target = () => (dest.mode === 'existing' && lists.length ? { listId: dest.listId || lists[0].id } : { listName: dest.name });
  const doCheck = () => run(async () => { setCheck(await api('/contacts/import/check', { method: 'POST', body: base() })); setStep('review'); });
  const doImport = () => run(async () => { const d = await api('/contacts/import', { method: 'POST', body: { ...base(), ...target(), duplicates: dup } }); setResult(d); setStep('done'); onDone(d.list, false); });
  const phoneOk = roles.filter(r => r === 'phone').length === 1;
  const nameOk = dest.mode === 'existing' ? lists.length > 0 : !!dest.name.trim();
  const footer = step === 'match' ? <>
    <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setStep('pick')} data-testid="contacts-import-back">Back</button>
    <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !phoneOk || !nameOk} onClick={doCheck} data-testid="contacts-import-check-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Check contacts</button>
  </> : step === 'review' ? <>
    <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setStep('match')} data-testid="contacts-import-back">Back</button>
    <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !check.valid} onClick={doImport} data-testid="contacts-import-submit-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{`Import ${check.valid.toLocaleString()} contacts`}</button>
  </> : null;
  return (
    <Modal wide title={STEPS[step]} sub={step === 'match' ? 'We guessed what each column holds — change anything that looks wrong.' : null} onClose={onClose} footer={footer} testid="contacts-import-dialog">
      {step === 'pick' && <PickFile busy={busy} onFile={onFile} onPaste={onPaste} />}
      {step === 'match' && <MatchColumns parsed={parsed} roles={roles} setRoles={setRoles} hasHeader={hasHeader} setHasHeader={setHasHeader} dest={dest} setDest={setDest} lists={lists} />}
      {step === 'review' && <Review check={check} dup={dup} setDup={setDup} pv={pv} />}
      {step === 'done' && <Done result={result} onView={() => { onDone(result.list, true); onClose(); }} onClose={onClose} />}
      <ErrorNote error={error} testid="contacts-import-error" className="mt-4" />
    </Modal>
  );
}
