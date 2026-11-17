import React, { useState } from 'react';
import { Database, CreditCard, Loader2, Trash2, Plus, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi, enc } from '../../api';
import { IvrSms } from './IvrSms';

const DB_KINDS = [['postgres', 'PostgreSQL', 'postgresql://user:password@host:5432/database'], ['mongodb', 'MongoDB', 'mongodb+srv://user:password@cluster.mongodb.net/database']];
const PAY_KINDS = [['stripe', 'Stripe'], ['paypal', 'PayPal'], ['square', 'Square'], ['razorpay', 'Razorpay'], ['mollie', 'Mollie']];
const PAY_FIELDS = { stripe: [['key', 'Secret or restricted key (sk_… / rk_…)']], paypal: [['clientId', 'Client ID'], ['clientSecret', 'Client secret']], square: [['accessToken', 'Access token']], razorpay: [['keyId', 'Key ID'], ['keySecret', 'Key secret']], mollie: [['apiKey', 'API key (live_… / test_…)']] };
const SOURCES = {
  webhook: [['', 'Only notify my system (its answer is not used)'], ['reply', 'Use my system’s answer (what to say, where to connect)'], ['db', 'Look the caller’s phone number up in my database']],
  collect: [['', 'Don’t check it automatically'], ['db', 'Look it up in my database'], ['reply', 'Ask my system (webhook answer)']],
  pin: [['', 'One fixed code'], ['db', 'Codes stored in my database'], ['reply', 'My system decides (webhook answer)']],
  pay: [['db', 'A column in my database'], ['reply', 'My system’s answer (amount: …)']],
};
const Hint = ({ children }) => <p className="text-xs text-[#71717a]">{children}</p>;
const Field = ({ label, children }) => <label className="block text-xs text-[#a1a1aa]">{label}<div className="mt-1">{children}</div></label>;

// Connect a database or a payment provider. Credentials are tested first, then stored encrypted; they are never shown again.
function ConnectForm({ type, onDone, onCancel, prefix }) {
  const kinds = type === 'database' ? DB_KINDS : PAY_KINDS;
  const [f, setF] = useState({ kind: kinds[0][0], mode: 'live' });
  const [busy, setBusy] = useState(false);
  const up = (p) => setF(x => ({ ...x, ...p }));
  const submit = async () => {
    setBusy(true);
    try { const r = await api('/ivr-connections', { method: 'POST', body: f }); toast.success(`${r.connection.name} connected`); onDone(r.connection); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-[#818cf8]/30 bg-[#818cf8]/5 p-3 space-y-2" data-testid={`${prefix}-connect-form`}>
      <div className="grid md:grid-cols-2 gap-2">
        <select className="civr-input" value={f.kind} onChange={e => setF({ kind: e.target.value, mode: 'live', name: f.name })} data-testid={`${prefix}-connect-kind`}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="civr-input" value={f.name || ''} onChange={e => up({ name: e.target.value })} placeholder="Name it (e.g. Orders database)" data-testid={`${prefix}-connect-name`} />
      </div>
      {type === 'database'
        ? <><input className="civr-input font-mono" type="password" autoComplete="off" value={f.url || ''} onChange={e => up({ url: e.target.value })} placeholder={kinds.find(([k]) => k === f.kind)[2]} data-testid={`${prefix}-connect-url`} />
          <Hint>Use a read-only database user. We only ever read one matching row, and the database must accept connections from the internet.</Hint></>
        : <>{PAY_FIELDS[f.kind].map(([k, l]) => <input key={k} className="civr-input font-mono" type="password" autoComplete="off" value={f[k] || ''} onChange={e => up({ [k]: e.target.value })} placeholder={l} data-testid={`${prefix}-connect-${k}`} />)}
          {['paypal', 'square'].includes(f.kind) && <label className="flex items-center gap-2 text-sm text-[#d4d4d8]"><input type="checkbox" checked={f.mode === 'test'} onChange={e => up({ mode: e.target.checked ? 'test' : 'live' })} data-testid={`${prefix}-connect-sandbox`} />These are sandbox (test) credentials</label>}
          <Hint>The money goes straight to your own account. Callers pay on your provider’s page; no card details are taken on the call.</Hint></>}
      <div className="flex gap-2">
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} onClick={submit} data-testid={`${prefix}-connect-submit`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Test and connect</button>
        {onCancel && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onCancel} data-testid={`${prefix}-connect-cancel`}>Cancel</button>}
      </div>
    </div>
  );
}

// Pick one of the account's connections, or add / remove one right here.
function ConnPick({ type, value, onChange, prefix }) {
  const { data, reload } = useApi('/ivr-connections');
  const [adding, setAdding] = useState(false);
  const items = (data?.items || []).filter(c => c.type === type);
  const Icon = type === 'database' ? Database : CreditCard;
  const remove = async () => {
    if (!window.confirm('Remove this connection? Keys that use it will stop working until you pick another.')) return;
    try { await api(`/ivr-connections/${enc(value)}`, { method: 'DELETE' }); onChange(''); reload(); } catch (e) { toast.error(e.message); }
  };
  if (adding || (data && !items.length)) return <ConnectForm type={type} prefix={prefix} onCancel={items.length ? () => setAdding(false) : null} onDone={(c) => { setAdding(false); reload(); onChange(c.id); }} />;
  return (
    <div className="flex gap-2 items-center">
      <Icon className="w-4 h-4 shrink-0 text-[#818cf8]" />
      <select className="civr-input flex-1 min-w-0" value={value || ''} onChange={e => onChange(e.target.value)} data-testid={`${prefix}-conn-select`}>
        <option value="">{type === 'database' ? 'Pick a database…' : 'Pick a payment provider…'}</option>
        {items.map(c => <option key={c.id} value={c.id}>{`${c.name} · ${c.hint}`}</option>)}
      </select>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setAdding(true)} data-testid={`${prefix}-conn-add`}><Plus className="w-4 h-4" />New</button>
      {value && <button type="button" className="p-2 text-[#a1a1aa] hover:text-[#fb7185]" onClick={remove} aria-label="Remove connection" data-testid={`${prefix}-conn-remove`}><Trash2 className="w-4 h-4" /></button>}
    </div>
  );
}

// Guided lookup: table → column that matches what the caller typed → what to say / where to connect.
function DbLookup({ c, setC, kind, prefix }) {
  const t = useApi(c.connId ? `/ivr-connections/${enc(c.connId)}/tables` : null);
  const cols = useApi(c.connId && c.table ? `/ivr-connections/${enc(c.connId)}/columns?table=${enc(c.table)}` : null);
  const [probe, setProbe] = useState('');
  const [res, setRes] = useState(null);
  const columns = cols.data?.columns || [];
  const colSelect = (field, label, testid, empty) => (
    <Field label={label}><select className="civr-input" value={c[field] || ''} onChange={e => setC({ [field]: e.target.value })} data-testid={`${prefix}-${testid}`}><option value="">{empty}</option>{columns.map(x => <option key={x} value={x}>{x}</option>)}</select></Field>
  );
  const tryIt = async () => {
    try { setRes(await api(`/ivr-connections/${enc(c.connId)}/lookup`, { method: 'POST', body: { table: c.table, match: c.match, value: probe, say: c.say } })); } catch (e) { toast.error(e.message); }
  };
  const byPhone = kind === 'webhook';
  return (
    <div className="space-y-2" data-testid={`${prefix}-db`}>
      <ConnPick type="database" value={c.connId} onChange={(id) => setC({ connId: id, table: '', match: '', routeColumn: '', amountColumn: '' })} prefix={`${prefix}-db`} />
      {c.connId && (t.error ? <p className="text-sm text-[#fb7185]" data-testid={`${prefix}-db-error`}>{t.error.message}</p> : <>
        <div className="grid md:grid-cols-2 gap-2">
          <Field label="Table"><select className="civr-input" value={c.table || ''} onChange={e => setC({ table: e.target.value, match: '', routeColumn: '', amountColumn: '' })} data-testid={`${prefix}-db-table`}><option value="">{t.loading ? 'Loading…' : 'Pick a table…'}</option>{(t.data?.tables || []).map(x => <option key={x} value={x}>{x}</option>)}</select></Field>
          {c.table && colSelect('match', byPhone ? 'Column with the caller’s phone number' : kind === 'pin' ? 'Column with the valid codes' : 'Column that matches what the caller types', 'db-match', cols.loading ? 'Loading…' : 'Pick a column…')}
        </div>
        {c.table && c.match && <>
          {kind === 'pay' ? colSelect('amountColumn', 'Column with the amount to pay', 'db-amount', 'Pick a column…') : <>
            <Field label="What the caller hears when it is found (optional)">
              <textarea rows={2} className="civr-input" value={c.say || ''} onChange={e => setC({ say: e.target.value })} placeholder="Your balance is {balance} dollars." data-testid={`${prefix}-db-say`} />
            </Field>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto sm:max-h-none" data-testid={`${prefix}-db-chips`}>{columns.slice(0, 24).map(x => <button key={x} type="button" className="civr-pill cursor-pointer font-mono" onClick={() => setC({ say: `${c.say || ''}${c.say && !/\s$/.test(c.say) ? ' ' : ''}{${x}}` })}>{`{${x}}`}</button>)}</div>
            {colSelect('routeColumn', 'Connect the call to the phone number in this column (optional)', 'db-route', 'Don’t connect from the database')}
          </>}
          <input className="civr-input" value={c.notFound || ''} onChange={e => setC({ notFound: e.target.value })} placeholder="Say when nothing is found (optional)" data-testid={`${prefix}-db-notfound`} />
          <div className="flex gap-2">
            <input className="civr-input font-mono flex-1" value={probe} onChange={e => setProbe(e.target.value)} placeholder={byPhone ? 'Try a phone number, e.g. +14155550100' : 'Try a value a caller would type'} data-testid={`${prefix}-db-try-input`} />
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={!probe.trim()} onClick={tryIt} data-testid={`${prefix}-db-try-button`}><FlaskConical className="w-4 h-4" />Try it</button>
          </div>
          {res && <div className={`rounded-lg border p-2 text-sm ${res.found ? 'border-[#34d399]/40 text-[#a7f3d0]' : 'border-[#fbbf24]/40 text-[#fde68a]'}`} data-testid={`${prefix}-db-try-result`}>
            {res.found ? <>{res.say ? <div>{`Caller hears: “${res.say}”`}</div> : <div>Found.</div>}<div className="font-mono text-xs text-[#a1a1aa] mt-1 break-all">{Object.entries(res.row).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div></> : 'Nothing found for that value.'}
          </div>}
        </>}
      </>)}
    </div>
  );
}

// Where a key checks what the caller typed (or who is calling): nowhere, your database, or your system's answer.
export function CheckWith({ o, set, prefix, kind }) {
  const c = o.check || {};
  const setC = (p) => set({ check: { ...c, ...p } });
  const src = c.source || (kind === 'pay' ? 'db' : '');
  const pick = (v) => set({ check: v ? { ...c, source: v } : undefined });
  return (
    <div className="space-y-2 rounded-xl border border-[#27272a] p-3" data-testid={`${prefix}-check`}>
      <Field label={kind === 'pay' ? 'Where the amount comes from' : kind === 'pin' ? 'Which codes are valid' : kind === 'webhook' ? 'Live answer' : 'Check what the caller typed'}>
        <select className="civr-input" value={src} onChange={e => pick(e.target.value)} data-testid={`${prefix}-check-source`}>{SOURCES[kind].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      {src === 'db' && <DbLookup c={{ ...c, source: 'db' }} setC={(p) => set({ check: { ...c, source: 'db', ...p } })} kind={kind} prefix={prefix} />}
      {src === 'reply' && <>
        {(kind === 'pin' || kind === 'pay') && <input className="civr-input font-mono" value={o.url || ''} onChange={e => set({ url: e.target.value })} placeholder="https://your-system.com/check" data-testid={`${prefix}-check-url`} />}
        <input className="civr-input" value={c.notFound || ''} onChange={e => setC({ source: 'reply', notFound: e.target.value })} placeholder="Say when your system says no (optional)" data-testid={`${prefix}-check-notfound`} />
        <Hint>{kind === 'pay'
          ? 'We POST what the caller typed to your https address. Answer with the amount, e.g. {"amount": 42.50} or the line “amount: 42.50”.'
          : 'We POST the caller’s number and what they typed to your https address. Answer with JSON like {"say": "Your balance is 42 dollars", "route": "+14155550100"} or plain lines “say: …” / “route to: +1…”. Answer {"ok": false} to turn the caller away.'}</Hint>
      </>}
    </div>
  );
}

// What happens after you press Accept / Decline: the key's usual result, or your own choice.
const OUTCOMES = [['default', 'The key’s usual result'], ['message', 'Play a message, then hang up'], ['forward', 'Transfer to a phone'], ['menu', 'Say a message, then back to the menu'], ['voicemail', 'Take a voicemail'], ['end', 'End the call']];
function Outcome({ label, v = {}, set, prefix, decline, pin }) {
  const a = v.action || 'default';
  const put = (p) => set({ ...v, ...p });
  return (
    <div className="space-y-2" data-testid={prefix}>
      <Field label={label}><select className="civr-input" value={a} onChange={e => put({ action: e.target.value })} data-testid={`${prefix}-action`}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{k === 'default' ? (decline ? (pin ? 'Ask for the code again (3 tries)' : 'Play the decline message, then hang up') : l) : l}</option>)}</select></Field>
      {['message', 'forward', 'menu', 'end'].includes(a) && <input className="civr-input" value={v.message || ''} onChange={e => put({ message: e.target.value })} placeholder={a === 'forward' ? 'Say before connecting (optional)' : 'What they hear (optional)'} data-testid={`${prefix}-message`} />}
      {a === 'forward' && <input className="civr-input font-mono" value={v.forwardTo || ''} onChange={e => put({ forwardTo: e.target.value })} placeholder="+14155550100" data-testid={`${prefix}-forward`} />}
    </div>
  );
}

// Manual check: the caller waits on hold while Accept / Decline pops up in the app.
export function ConfirmAsk({ o, set, prefix }) {
  const show = async () => {
    try { await api('/ivr-connections/confirm-preview', { method: 'POST', body: { kind: o.action, digit: o.digit, label: o.label, connectTo: o.onAccept?.action ? (o.onAccept.action === 'forward' ? o.onAccept.forwardTo : '') : o.action === 'pin' ? o.onOk?.forwardTo : o.forwardTo, onAccept: o.onAccept?.action, onDecline: o.onDecline?.action, declineTo: o.onDecline?.forwardTo, replayMessage: o.replayMessage, declineMessage: o.onDecline?.message || o.declineMessage } }); toast.success('Example pop-up is showing at the top of the page'); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="space-y-2 rounded-xl border border-[#27272a] p-3" data-testid={`${prefix}-confirm`}>
      <label className="flex items-start gap-2 text-sm text-[#d4d4d8]"><input type="checkbox" className="mt-1" checked={o.confirm === true} onChange={e => set({ confirm: e.target.checked })} data-testid={`${prefix}-confirm-toggle`} /><span>Ask me to Accept or Decline before going on<span className="block text-xs text-[#71717a]">The caller waits on hold. A banner pops up in CloudIVR on any page with what they typed and what was found. Keep the app open.</span></span></label>
      {o.confirm === true && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={show} data-testid={`${prefix}-confirm-preview`}>Show me the pop-up</button>}
      {o.confirm === true && <div className="grid md:grid-cols-2 gap-2">
        <Field label="If I don’t answer in 45 seconds"><select className="civr-input" value={o.confirmTimeout || 'decline'} onChange={e => set({ confirmTimeout: e.target.value })} data-testid={`${prefix}-confirm-timeout`}><option value="decline">Treat it as declined</option><option value="voicemail">Say so and take a voicemail</option></select></Field>
        <Field label="Say when declined (optional)"><input className="civr-input" value={o.declineMessage || ''} onChange={e => set({ declineMessage: e.target.value })} placeholder="Sorry, we could not confirm that." data-testid={`${prefix}-confirm-decline-message`} /></Field>
        {(o.action === 'pin' || o.action === 'collect') && <Field label="Say when I press Replay — then they type it again"><input className="civr-input" value={o.replayMessage || ''} onChange={e => set({ replayMessage: e.target.value })} placeholder={o.action === 'pin' ? 'That code was not correct.' : 'We could not find that number.'} data-testid={`${prefix}-confirm-replay-message`} /></Field>}
      </div>}
      {o.confirm === true && <div className="grid md:grid-cols-2 gap-3">
        <Outcome label="When I press Accept" v={o.onAccept} set={(v) => set({ onAccept: v })} prefix={`${prefix}-on-accept`} />
        <Outcome label="When I press Decline" v={o.onDecline} set={(v) => set({ onDecline: v })} prefix={`${prefix}-on-decline`} decline pin={o.action === 'pin'} />
      </div>}
    </div>
  );
}

// Payment key: your own fixed page link, or a link for an exact amount made with your provider account.
export function PayFields({ o, set, prefix }) {
  const provider = o.payVia === 'provider';
  const lookup = o.amountFrom === 'lookup';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[['link', 'My own payment page link'], ['provider', 'Create a link for an exact amount']].map(([v, l]) => <button key={v} type="button" onClick={() => set({ payVia: v })} className={`civr-pill cursor-pointer ${(provider ? 'provider' : 'link') === v ? 'civr-pill-on' : ''}`} data-testid={`${prefix}-pay-via-${v}`}>{l}</button>)}
      </div>
      {!provider ? <input className="civr-input font-mono" value={o.payUrl || ''} onChange={e => set({ payUrl: e.target.value })} placeholder="https://… your own payment page (Stripe, PayPal…)" data-testid={`${prefix}-pay-url`} /> : <>
        <ConnPick type="payments" value={o.connId} onChange={(id) => set({ connId: id })} prefix={`${prefix}-pay`} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[['fixed', 'Same amount for everyone'], ['lookup', 'What each caller owes']].map(([v, l]) => <button key={v} type="button" onClick={() => set({ amountFrom: v, ...(v === 'lookup' && !o.check ? { check: { source: 'db' } } : {}) })} className={`civr-pill cursor-pointer ${(lookup ? 'lookup' : 'fixed') === v ? 'civr-pill-on' : ''}`} data-testid={`${prefix}-pay-amount-${v}`}>{l}</button>)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {!lookup && <input className="civr-input" type="number" min="0" step="0.01" value={o.amount || ''} onChange={e => set({ amount: e.target.value })} placeholder="Amount, e.g. 25" data-testid={`${prefix}-pay-amount`} />}
          <input className="civr-input font-mono uppercase" maxLength={3} value={o.currency || 'USD'} onChange={e => set({ currency: e.target.value.toUpperCase() })} placeholder="USD" data-testid={`${prefix}-pay-currency`} />
          <input className={`civr-input ${lookup ? 'col-span-2' : ''}`} value={o.description || ''} onChange={e => set({ description: e.target.value })} placeholder="What it is for (shown on the payment page)" data-testid={`${prefix}-pay-description`} />
        </div>
        {lookup && <>
          <div className="grid md:grid-cols-3 gap-2"><input className="civr-input md:col-span-2" value={o.prompt || ''} onChange={e => set({ prompt: e.target.value })} placeholder="What to ask (e.g. Enter your account number, then press pound)" data-testid={`${prefix}-pay-prompt`} /><input className="civr-input" type="number" min="1" max="20" value={o.length || 6} onChange={e => set({ length: Number(e.target.value) })} aria-label="How many digits" data-testid={`${prefix}-pay-length`} /></div>
          <CheckWith o={o} set={set} prefix={`${prefix}-pay`} kind="pay" />
        </>}
        <label className="flex items-start gap-2 text-sm text-[#d4d4d8]"><input type="checkbox" className="mt-1" checked={o.waitPaid === true} onChange={e => set({ waitPaid: e.target.checked })} data-testid={`${prefix}-pay-wait`} /><span>Keep the caller on the line and tell them when the payment went through<span className="block text-xs text-[#71717a]">They hear hold music for up to 3 minutes. Either way you get a notice when a payment arrives.</span></span></label>
        {o.waitPaid === true && <input className="civr-input" value={o.paidMessage || ''} onChange={e => set({ paidMessage: e.target.value })} placeholder="Say when paid (default: Thank you. Your payment was received.)" data-testid={`${prefix}-pay-paid-message`} />}
      </>}
      <input className="civr-input" value={o.payNote || ''} onChange={e => set({ payNote: e.target.value })} placeholder="Line before the link (default: Pay securely here:)" data-testid={`${prefix}-pay-note`} />
      <IvrSms o={o} set={set} prefix={prefix} hideText />
      <Hint>The caller gets the link by text. No card details are taken on the call, and the money goes straight to you.</Hint>
    </div>
  );
}
