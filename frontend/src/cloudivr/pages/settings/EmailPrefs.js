import React, { useState } from 'react';
import { toast } from 'sonner';
import { Mail, Loader2, ExternalLink, Send } from 'lucide-react';
import { api, apiUrl, useApi, when } from '../../api';
import { Toggle, SkeletonCard } from '../../ui';
import { useLang } from '../../i18n';

const SWITCHES = [
  ['weekly', 'Weekly summary', 'Monday morning: calls, texts, campaigns and what renews next.'],
  ['campaigns', 'Campaign reports', 'When a Bulk IVR campaign ends: who answered, pressed a key or was transferred.'],
  ['voicemail', 'New voicemail alerts', 'Who called, how long, and the transcript.'],
  ['missed', 'Missed call alerts', 'Call back while they’re still keen.'],
];
const EXAMPLES = [['welcome', 'Welcome'], ['numberLive', 'Number live'], ['renewed', 'Renewal receipt'], ['upgraded', 'Plan upgrade'], ['renewSoon', 'Renewal reminder'], ['renewFailed', 'Renewal failed'], ['suspended', 'Number paused'], ['topup', 'Top-up received'], ['lowBalance', 'Low balance'], ['walletEmpty', 'Wallet empty'], ['campaignDone', 'Campaign report'], ['voicemail', 'New voicemail'], ['missed', 'Missed call'], ['weekly', 'Weekly summary']];
const STATUS = { sent: 'civr-pill civr-pill-ok', preview: 'civr-pill civr-pill-warn', failed: 'civr-pill civr-pill-bad' };

function Switches({ prefs, setPrefs }) {
  const flip = async (k, label, v) => {
    setPrefs({ ...prefs, [k]: v });
    try { const d = await api('/prefs/email', { method: 'PUT', body: { [k]: v } }); setPrefs(d.prefs); toast.success(`${label} ${v ? 'turned on' : 'turned off'}`); } catch (e) { setPrefs(prefs); toast.error(e.message); }
  };
  return (
    <div className="divide-y divide-[#1a1a1a]" data-testid="email-prefs-switches">
      {SWITCHES.map(([k, label, sub]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-3">
          <div><div className="text-sm font-medium text-[#e4e4e7]">{label}</div><div className="text-xs text-[#a1a1aa]">{sub}</div></div>
          <Toggle checked={prefs[k] !== false} onChange={v => flip(k, label, v)} testid={`email-pref-${k}-toggle`} />
        </div>
      ))}
    </div>
  );
}

function LowBalance({ prefs, setPrefs }) {
  const [v, setV] = useState(String(prefs.lowBalanceAt));
  const [busy, setBusy] = useState(false);
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const d = await api('/prefs/email', { method: 'PUT', body: { lowBalanceAt: Number(v) } }); setPrefs(d.prefs); toast.success('Low-balance alert saved'); } catch (err) { toast.error(err.message); } finally { setBusy(false); } };
  return (
    <form onSubmit={save} noValidate className="flex flex-wrap items-end gap-2" data-testid="email-low-balance-form">
      <label className="flex-1 min-w-[180px]"><span className="block text-[13px] font-medium text-[#d4d4d8] mb-1.5">Warn me when my wallet drops below</span>
        <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a1a1aa]">$</span><input type="number" min={1} max={1000} step="1" required className="civr-input !pl-7 font-mono" value={v} onChange={e => setV(e.target.value)} data-testid="email-low-balance-input" /></div>
      </label>
      <button className="civr-btn civr-btn-ghost" disabled={busy || Number(v) === prefs.lowBalanceAt} data-testid="email-low-balance-save">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save</button>
    </form>
  );
}

function Examples({ onSent }) {
  const { lang } = useLang();
  const [type, setType] = useState('welcome');
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try { const d = await api('/emails/test', { method: 'POST', body: { type } }); d.sent ? toast.success(`Test email sent to ${d.to}`) : d.preview ? toast.success('Preview mode: the test email was saved, not sent. Open the preview to see it.') : toast.error('The mail server did not accept the email. Try again later.'); onSent(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="email-examples">
      <label className="flex-1 min-w-[200px]"><span className="block text-[13px] font-medium text-[#d4d4d8] mb-1.5">See an example</span>
        <select className="civr-input" value={type} onChange={e => setType(e.target.value)} data-testid="email-example-select">{EXAMPLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      {/* A button, not a link: the preview host's page CSS hides every <a> whose address contains "emergent". */}
      <button type="button" onClick={() => window.open(apiUrl(`/emails/preview/${type}?lang=${lang}`), '_blank', 'noopener')} className="civr-btn civr-btn-ghost" data-testid="email-example-preview-link"><ExternalLink className="w-4 h-4" />Open preview</button>
      <button type="button" className="civr-btn civr-btn-ghost" disabled={busy} onClick={test} data-testid="email-example-test-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Email me a test</button>
    </div>
  );
}

function Recent({ list }) {
  if (!list?.length) return <div className="text-xs text-[#a1a1aa]" data-testid="email-log-empty">No emails yet.</div>;
  return (
    <ul className="space-y-1.5 text-xs" data-testid="email-log">
      {list.slice(0, 6).map((m, i) => (
        <li key={m.id} className="flex flex-wrap items-center gap-2" data-testid={`email-log-${i}`}>
          <span className={STATUS[m.status]}>{m.status}</span>{m.test && <span className="civr-pill">test</span>}
          <span className="text-[#d4d4d8] min-w-0 truncate max-w-[60%]">{m.subject}</span>
          <span className="ml-auto text-[#a1a1aa]">{when(m.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function EmailPrefs() {
  const { data, setData } = useApi('/prefs/email');
  const log = useApi('/emails/log');
  if (!data) return <SkeletonCard lines={4} className="lg:col-span-2" testid="settings-emails-loading" />;
  const setPrefs = (prefs) => setData({ ...data, prefs });
  return (
    <div id="settings-emails" className="civr-card p-6 space-y-6 lg:col-span-2 scroll-mt-24" data-testid="settings-emails-card">
      <div>
        <div className="flex items-center gap-2 font-display text-2xl font-bold"><Mail className="w-5 h-5 text-[#818cf8]" />Email notifications</div>
        <p className="text-sm text-[#a1a1aa] mt-1 max-w-2xl" data-testid="email-prefs-sub">{`Sent to ${data.email} in your app language. Receipts, renewal notices and wallet alerts always arrive.`}</p>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Switches prefs={data.prefs} setPrefs={setPrefs} />
        <div className="space-y-6"><LowBalance key={data.prefs.lowBalanceAt} prefs={data.prefs} setPrefs={setPrefs} /><Examples onSent={log.reload} /></div>
      </div>
      <div className="border-t border-[#1a1a1a] pt-4 space-y-2"><div className="text-sm font-medium">Recent emails</div><Recent list={log.data?.emails} /></div>
    </div>
  );
}
