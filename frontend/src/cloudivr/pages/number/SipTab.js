import React, { useState } from 'react';
import { ask } from '../../i18n';
import { toast } from 'sonner';
import { Copy, Eye, RefreshCw, Phone, PhoneOutgoing, Loader2 } from 'lucide-react';
import { api, enc } from '../../api';
import { useShell } from '../../Shell';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

// Opens a 90 s window: dial anything from the softphone, we catch the call for free and report in the Inbox.
function TestOutbound({ num }) {
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  React.useEffect(() => { if (left <= 0) return undefined; const t = setTimeout(() => setLeft(l => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  const go = async () => {
    setBusy(true);
    try { const d = await api(`/numbers/${enc(num.phoneNumber)}/test-sip`, { method: 'POST' }); setMsg(d.message); if (!d.dryRun) setLeft(d.seconds || 90); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 lg:col-span-3" data-testid="sip-test-outbound-card">
      <div className="font-display text-2xl font-bold">Test outbound SIP</div>
      <p className="text-sm text-[#888] mt-1 mb-4">Checks that calls from your softphone reach us with these credentials. Free — the test call is hung up before it rings anyone.</p>
      <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={go} disabled={busy || left > 0} data-testid="sip-test-outbound-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}{left > 0 ? `Waiting for your call… ${left}s` : 'Start 90-second test'}</button>
      {msg && <div className="text-xs text-[#ccc] mt-3" data-testid="sip-test-outbound-result">{msg}</div>}
    </div>
  );
}

export default function SipTab({ num }) {
  const { openPhone } = useShell();
  const [creds, setCreds] = useState(null);
  const [busy, setBusy] = useState(false);
  const reveal = async () => { try { setCreds(await api(`/numbers/${enc(num.phoneNumber)}/sip`)); } catch (e) { toast.error(e.message); } };
  const reset = async () => {
    if (!ask('Create new SIP credentials? Softphones using the old ones will stop working.')) return;
    setBusy(true);
    try { const c = await api(`/numbers/${enc(num.phoneNumber)}/sip/reset`, { method: 'POST' }); setCreds({ ...creds, ...c }); toast.success('New SIP credentials ready'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const rows = [['Username', creds?.username || num.sipUsername, 'sip-username'], ['Password', creds ? creds.password : '••••••••••', 'sip-password'], ['Domain', num.sipDomain, 'sip-domain'], ['Port', '5060 (UDP/TCP) · 5061 (TLS)', 'sip-port']];
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="civr-card p-6 lg:col-span-2">
        <div className="font-display text-2xl font-bold">SIP credentials</div>
        <p className="text-sm text-[#888] mt-1 mb-6">Use these in any softphone (Zoiper, Linphone, MicroSIP) to call and receive calls on this number.</p>
        <div className="divide-y divide-[#1c1c1c]">
          {rows.map(([k, v, id]) => (
            <div key={id} className="flex items-center justify-between py-3">
              <span className="text-sm text-[#888]">{k}</span>
              <span className="flex items-center gap-2"><code className="text-sm" data-testid={id}>{v}</code>{v && !String(v).startsWith('•') && <button onClick={() => copy(v)} className="p-1 text-[#8a8a8a] hover:text-[#34d399]" data-testid={`${id}-copy`}><Copy className="w-3.5 h-3.5" /></button>}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-6">
          {!creds && <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={reveal} data-testid="sip-reveal-button"><Eye className="w-4 h-4" />Show password</button>}
          <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={reset} disabled={busy} data-testid="sip-reset-button"><RefreshCw className="w-4 h-4" />New credentials</button>
        </div>
      </div>
      <div className="civr-card p-6">
        <div className="font-display text-2xl font-bold">Browser phone</div>
        <p className="text-sm text-[#888] mt-1 mb-6">Call from this tab with this number’s SIP line.</p>
        <button className="civr-btn civr-btn-primary" onClick={openPhone} data-testid="sip-open-softphone-button"><Phone className="w-4 h-4" />Open phone</button>
      </div>
      <TestOutbound num={num} />
    </div>
  );
}
