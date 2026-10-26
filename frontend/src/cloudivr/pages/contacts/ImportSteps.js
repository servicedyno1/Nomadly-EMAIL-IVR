import React from 'react';
import { AlertTriangle, CheckCircle2, UserPlus, Copy, RefreshCw } from 'lucide-react';
import { Field } from '../../ui';

export const ROLE_LABELS = {
  phone: 'Phone number', name: 'Full name', first_name: 'First name', last_name: 'Last name', email: 'Email', company: 'Company',
  notes: 'Notes', keep: 'Keep as extra info', skip: 'Don’t import',
};
const ROLE_TONE = { phone: 'text-[#a5b4fc]', skip: 'text-[#52525b] line-through', keep: 'text-[#a1a1aa]' };

// Step 2: what each column holds (guessed by the server), whether row 1 is a header, and where to save.
export function MatchColumns({ parsed, roles, setRoles, hasHeader, setHasHeader, dest, setDest, lists }) {
  const head = parsed.preview[0] || [];
  const label = (i) => (hasHeader && head[i]) || `Column ${i + 1}`;
  const rows = parsed.preview.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 5);
  const phones = roles.filter(r => r === 'phone').length;
  return (
    <div className="space-y-6" data-testid="contacts-import-match">
      <label className="flex items-center gap-3 text-sm cursor-pointer select-none w-fit">
        <input type="checkbox" className="w-4 h-4 accent-[#818cf8]" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} data-testid="contacts-import-header-checkbox" />
        The first row has column names
      </label>
      <div className="flex flex-col gap-2" data-testid="contacts-import-columns">
        {parsed.columns.map((c, i) => (
          <div key={c.index} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_14rem] items-center gap-2 sm:gap-4 rounded-xl border border-[#222] bg-[#111113] px-4 py-3" data-testid={`contacts-import-column-${i}`}>
            <div className="font-medium truncate" title={label(i)} data-no-translate>{label(i)}</div>
            <div className="text-xs text-[#a1a1aa] font-mono truncate" title={c.samples.join(', ')} data-no-translate>{c.samples.slice(0, 2).join(' · ') || '—'}</div>
            <select className={`civr-input !h-10 text-sm ${roles[i] === 'phone' ? '!border-[#818cf8]/60' : ''}`} value={roles[i]} onChange={e => setRoles(roles.map((r, k) => (k === i ? e.target.value : r)))} aria-label={`What ${label(i)} holds`} data-testid={`contacts-import-role-select-${i}`}>
              {parsed.roles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
        ))}
      </div>
      {phones !== 1 && <div className="flex items-center gap-2 text-sm text-[#fbbf24]" role="alert" data-testid="contacts-import-phone-warning"><AlertTriangle className="w-4 h-4 shrink-0" />{phones ? 'Only one column can be the phone number.' : 'Pick the column that holds the phone numbers.'}</div>}
      <div>
        <div className="civr-label mb-3">Preview</div>
        <div className="civr-scroll-x overflow-x-auto rounded-xl border border-[#1f1f1f]" data-testid="contacts-import-preview">
          <table className="text-xs w-full min-w-max">
            <thead><tr>{parsed.columns.map((c, i) => <th key={c.index} className={`text-left font-medium px-3 py-2 bg-[#141416] whitespace-nowrap ${ROLE_TONE[roles[i]] || 'text-[#d4d4d8]'}`}>{ROLE_LABELS[roles[i]]}</th>)}</tr></thead>
            <tbody data-no-translate>{rows.map((r, k) => <tr key={k} className="border-t border-[#1a1a1a]">{parsed.columns.map((c, i) => <td key={c.index} className={`px-3 py-2 whitespace-nowrap max-w-[14rem] truncate ${roles[i] === 'skip' ? 'text-[#52525b]' : 'text-[#d4d4d8]'}`}>{r[i] || ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="text-xs text-[#a1a1aa] mt-2">{`${parsed.rows.toLocaleString()} rows in ${parsed.fileName}`}</div>
      </div>
      <SaveTo dest={dest} setDest={setDest} lists={lists} />
    </div>
  );
}

function SaveTo({ dest, setDest, lists }) {
  const pill = (mode, text, testid) => <button type="button" onClick={() => setDest({ ...dest, mode })} aria-pressed={dest.mode === mode} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-9 ${dest.mode === mode ? 'civr-pill-on' : ''}`} data-testid={testid}>{text}</button>;
  return (
    <div className="space-y-3" data-testid="contacts-import-destination">
      <div className="civr-label">Save to</div>
      <div className="flex flex-wrap gap-2">{pill('new', 'A new list', 'contacts-import-dest-new')}{lists.length > 0 && pill('existing', 'A list I already have', 'contacts-import-dest-existing')}</div>
      {dest.mode === 'new' || !lists.length
        ? <Field label="List name"><input className="civr-input" maxLength={60} value={dest.name} onChange={e => setDest({ ...dest, name: e.target.value })} placeholder="e.g. June leads" data-testid="contacts-import-list-name-input" /></Field>
        : <Field label="List"><select className="civr-input" value={dest.listId || lists[0].id} onChange={e => setDest({ ...dest, listId: e.target.value })} data-testid="contacts-import-list-select">{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
    </div>
  );
}

const Stat = ({ icon: Icon, n, label, tone, testid }) => (
  <div className="rounded-xl border border-[#222] bg-[#111113] p-4" data-testid={testid}>
    <Icon className={`w-4 h-4 ${tone}`} />
    <div className="font-display text-3xl font-bold mt-2">{Number(n || 0).toLocaleString()}</div>
    <div className="text-xs text-[#a1a1aa] mt-0.5">{label}</div>
  </div>
);

// Step 3: what will happen, and the skip / update choice when numbers are already saved.
export function Review({ check, dup, setDup, pv }) {
  return (
    <div className="space-y-6" data-testid="contacts-import-review">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={UserPlus} n={check.newCount} label="New contacts" tone="text-[#818cf8]" testid="contacts-import-stat-new" />
        <Stat icon={RefreshCw} n={check.existingCount} label="Already saved" tone="text-[#fbbf24]" testid="contacts-import-stat-existing" />
        <Stat icon={AlertTriangle} n={check.invalid} label="No valid number" tone="text-[#fb7185]" testid="contacts-import-stat-invalid" />
        <Stat icon={Copy} n={check.dupesInFile} label="Repeated in the file" tone="text-[#a1a1aa]" testid="contacts-import-stat-dupes" />
      </div>
      {check.invalid > 0 && <div className="text-xs text-[#a1a1aa]" data-testid="contacts-import-invalid-sample">{`Left out: ${check.invalidSample.map(x => `row ${x.row}${x.value ? ` (${x.value})` : ''}`).join(', ')}${check.invalid > check.invalidSample.length ? '…' : ''}`}</div>}
      {check.existingCount > 0 && (
        <div className="rounded-xl border border-[#fbbf24]/30 bg-[#fbbf24]/5 p-4 space-y-3" data-testid="contacts-import-duplicates">
          <div className="font-semibold">{`${check.existingCount.toLocaleString()} of these numbers are already in your contacts`}</div>
          <div className="text-xs text-[#a1a1aa] font-mono">{check.existingSample.map(x => `${pv.phone(x.phone)}${x.name ? ` ${x.name}` : ''}`).join(' · ')}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {[['skip', 'Skip them', 'Keep the details you already saved.'], ['update', 'Update them', 'Use the name, email and other details from this file.']].map(([v, t, s]) => (
              <button key={v} type="button" onClick={() => setDup(v)} aria-pressed={dup === v} className={`text-left rounded-xl border p-3 transition-colors ${dup === v ? 'border-[#818cf8] bg-[#818cf8]/10' : 'border-[#2a2a2a] hover:border-[#3f3f46]'}`} data-testid={`contacts-import-dup-${v}`}>
                <div className="font-medium text-sm flex items-center gap-2">{dup === v && <CheckCircle2 className="w-4 h-4 text-[#818cf8]" />}{t}</div>
                <div className="text-xs text-[#a1a1aa] mt-1">{s}</div>
              </button>
            ))}
          </div>
          <div className="text-xs text-[#a1a1aa]">Either way they are added to this list.</div>
        </div>
      )}
    </div>
  );
}
