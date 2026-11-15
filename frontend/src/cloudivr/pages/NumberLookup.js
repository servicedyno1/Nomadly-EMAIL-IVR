import React, { useState } from 'react';
import { Flag } from '../Pickers';
import { countryOfPhone } from '../phoneCountry';
import { ScanSearch, Loader2, Mail } from 'lucide-react';
import { api, useApi } from '../api';
import { PageHeader, Spinner, ErrorNote } from '../ui';
import { useShell } from '../Shell';
import { BulkRun, price } from './lookup/Bulk';

const TYPE = { mobile: 'Mobile', landline: 'Landline', voip: 'VoIP', toll_free: 'Toll-free', invalid: 'Not a working number' };
const VERDICT = { valid: 'Deliverable', neutral: 'Probably fine', risky: 'Risky', undeliverable: 'Undeliverable', typo: 'Looks like a typo', unknown: 'Unknown' };
const when = (d) => new Date(d).toLocaleString();
const NUM_COLS = [['number', r => r.number], ['valid', r => (r.failed ? 'not checked' : r.valid ? 'yes' : 'no')], ['line type', r => TYPE[r.type] || r.type], ['carrier', r => r.carrier], ['country', r => r.country], ['ported', r => (r.failed ? '' : r.ported ? 'yes' : 'no')]];
const MAIL_COLS = [['email', r => r.email], ['verdict', r => (r.failed ? 'not checked' : VERDICT[r.result] || r.result)], ['confidence', r => r.confidence], ['flags', r => (r.flags || []).join(' ')]];

function Result({ r, testid }) {
  const cells = [['Line type', TYPE[r.type] || r.type], ['Carrier', r.carrier], ['Country', r.country], ['Ported', r.ported ? 'Yes' : 'No']];
  return (
    <div className="civr-card p-5" data-testid={testid}>
      <div className="flex items-center gap-3 mb-3"><Flag code={/^[A-Z]{2}$/.test(String(r.country || '')) ? r.country : countryOfPhone(r.number)} className="!w-6 !h-[18px]" /><span className="font-mono text-lg" data-no-translate>{r.number}</span><span className={`civr-pill ${r.valid ? 'civr-pill-ok' : 'civr-pill-bad'}`} data-testid={`${testid}-valid`}>{r.valid ? 'Valid' : 'Not valid'}</span></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">{cells.map(([k, v]) => <div key={k}><div className="text-xs text-[var(--c-muted)]">{k}</div><div className="font-semibold" data-testid={`${testid}-${k.toLowerCase().replace(' ', '-')}`}>{v || 'unknown'}</div></div>)}</div>
    </div>
  );
}

const NumRow = ({ r, i }) => <div className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid={`lookup-bulk-row-${i}`}><span className="font-mono w-48 inline-flex items-center gap-2" data-no-translate><Flag code={countryOfPhone(r.number)} />{r.number}</span>{r.failed ? <span className="text-[var(--c-muted)]">Not checked · refunded</span> : <><span className="w-28">{TYPE[r.type] || r.type}</span><span className="flex-1 min-w-[10rem] break-words">{r.carrier}</span></>}</div>;
const MailRow = ({ r, i }) => <div className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid={`email-bulk-row-${i}`}><span className="font-mono flex-1 min-w-[200px] truncate" data-no-translate>{r.email}</span>{r.failed ? <span className="text-[var(--c-muted)]">Not checked · refunded</span> : <><span className={`civr-pill ${r.valid ? 'civr-pill-ok' : 'civr-pill-bad'}`}>{VERDICT[r.result] || r.result}</span><span className="w-16 text-right text-[var(--c-muted)]">{r.confidence}%</span></>}</div>;

function Single({ path, field, placeholder, label, unit, onDone, render, testid, inputTestid, submitTestid }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [last, setLast] = useState(null);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setLast(await api(path, { method: 'POST', body: { [field]: v } })); onDone(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid={testid}>
      <form onSubmit={go} className="flex flex-wrap gap-2">
        <input className="civr-input flex-1 min-w-[240px] font-mono" placeholder={placeholder} value={v} onChange={e => setV(e.target.value)} data-testid={inputTestid} />
        <button className="civr-btn civr-btn-primary" disabled={busy || !v.trim()} data-testid={submitTestid}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}{`${label} · ${price(unit)}`}</button>
      </form>
      <ErrorNote error={err} testid={`${testid}-error`} />
      {last && render(last)}
    </div>
  );
}

const EmailResult = ({ r }) => (
  <div className="civr-card p-5 flex flex-wrap items-center gap-3" data-testid="email-result">
    <Mail className="w-5 h-5 text-[var(--c-muted)]" /><span className="font-mono text-lg" data-no-translate>{r.email}</span>
    <span className={`civr-pill ${r.valid ? 'civr-pill-ok' : 'civr-pill-bad'}`} data-testid="email-result-verdict">{VERDICT[r.result] || r.result}</span>
    <span className="text-sm text-[var(--c-muted)]" data-testid="email-result-confidence">{r.confidence}% delivery confidence</span>
    {r.flags?.length > 0 && <span className="text-xs text-[var(--c-muted)]">{r.flags.join(', ').replace(/_/g, ' ')}</span>}
  </div>
);

export default function NumberLookup() {
  const { data, reload } = useApi('/lookup');
  const { refreshSummary } = useShell();
  const [tab, setTab] = useState('phone');
  if (!data) return <Spinner />;
  const done = () => { refreshSummary(); reload(); };
  const phone = tab === 'phone';
  return (
    <div className="space-y-8 max-w-4xl" data-testid="lookup-page">
      <PageHeader label="Lookup" title="Number & email lookup" sub={`Check numbers before you call or text: mobile or landline, carrier, country and porting — ${price(data.price)} each. Check emails before you send: deliverable, risky or a typo — ${price(data.emailPrice)} each. No charge when a check fails.`} testid="lookup-header" />
      <div role="tablist" className="inline-flex gap-1 rounded-xl border border-[var(--c-border)] p-1" data-testid="lookup-tabs">
        {[['phone', 'Phone numbers'], ['email', 'Emails']].map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-4 h-9 rounded-lg text-sm font-semibold ${tab === id ? 'bg-[var(--c-accent-soft)] text-[var(--c-text)]' : 'text-[var(--c-muted)]'}`} data-testid={`lookup-tab-${id}`}>{l}</button>)}
      </div>
      {phone
        ? <Single path="/lookup" field="number" placeholder="+1 415 555 0100" label="Look up" unit={data.price} onDone={done} render={(r) => <Result r={r} testid="lookup-result" />} testid="lookup-single" inputTestid="lookup-number-input" submitTestid="lookup-submit-button" />
        : <Single path="/lookup/email" field="email" placeholder="name@example.com" label="Check email" unit={data.emailPrice} onDone={done} render={(r) => <EmailResult r={r} />} testid="email-single" inputTestid="email-input" submitTestid="email-submit-button" />}
      {phone
        ? <BulkRun key="p" kind="number" unit={data.price} max={data.maxBulk} path="/lookup/bulk" field="numbers" cols={NUM_COLS} Row={NumRow} onDone={done} batches={data.batches} testid="lookup-bulk" />
        : <BulkRun key="e" kind="email" unit={data.emailPrice} max={data.maxBulk} path="/lookup/email/bulk" field="emails" cols={MAIL_COLS} Row={MailRow} onDone={done} batches={data.batches} testid="email-bulk" />}
      {(phone ? data.history : data.emailHistory).length > 0 && (
        <div data-testid={phone ? 'lookup-history' : 'email-history'}>
          <div className="civr-label mb-3">Recent checks</div>
          <div className="civr-card divide-y divide-[var(--c-border,#1f1f1f)]">
            {(phone ? data.history : data.emailHistory).map((h, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid={`${phone ? 'lookup' : 'email'}-history-${i}`}>
                {phone ? <><span className="font-mono w-48 inline-flex items-center gap-2" data-no-translate><Flag code={countryOfPhone(h.number)} />{h.number}</span><span className="w-28">{TYPE[h.type] || h.type}</span><span className="flex-1 min-w-[10rem] break-words">{h.carrier}</span></>
                  : <><span className="font-mono flex-1 truncate" data-no-translate>{h.email}</span><span className="w-36">{VERDICT[h.result] || h.result}</span></>}
                <span className="text-xs text-[var(--c-muted)]">{when(h.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
