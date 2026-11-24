import React, { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Loader2, Copy, Trash2, BookOpen, Plus } from 'lucide-react';
import { api, useApi, when } from '../../api';
import { Field, SkeletonCard } from '../../ui';
import { ask } from '../../confirm';
import { Assist } from '../../Assist';
import { cp } from '../../paths';

const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied'), () => toast.error('Copy failed — select the text and copy it yourself.'));
const LABELS = { from: 'Call from', connectTo: 'Connect to (agent line)', machine: 'When voicemail answers', webhookUrl: 'Webhook URL' };
const EXAMPLES = [
  'My CRM should call leads who agreed to our calls and connect them to our toll-free number as soon as they answer',
  'Connect every answered call, even voicemail',
  'Send the call updates to https://crm.example.com/hooks/cloudivr',
];

function Locked({ a, onBuy, busy }) {
  return (
    <div className="space-y-3" data-testid="api-locked">
      <p className="text-sm text-[#a1a1aa]">Let your CRM start calls and connect leads to your agents the moment they answer — no key to press.</p>
      {a.canBuy
        ? <button type="button" className="civr-btn civr-btn-primary" onClick={onBuy} disabled={busy} data-testid="api-buy-addon">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Turn on API access — ${a.price}/month</button>
        : <p className="text-sm" data-testid="api-upgrade-note">Included with the Enterprise plan, or the Business plan + a ${a.price}/month add-on.</p>}
    </div>
  );
}

function Keys({ keys, reload }) {
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const create = async () => { try { const d = await api('/api-keys', { method: 'POST', body: { name } }); setFresh(d.key); setName(''); reload(); } catch (e) { toast.error(e.message); } };
  const revoke = async (k) => { if (await ask(`Delete key “${k.name}” (…${k.last4})? Requests using it stop working right away.`, { ok: 'Delete key' })) { await api(`/api-keys/${k.id}`, { method: 'DELETE' }).catch(e => toast.error(e.message)); reload(); } };
  return (
    <div className="space-y-3" data-testid="api-keys">
      {fresh && (
        <div className="civr-card p-4 border border-amber-400/40" data-testid="api-key-new">
          <div className="text-sm font-medium mb-2">Your new key — copy it now, it won’t be shown again</div>
          <div className="flex gap-2 items-center"><code className="civr-input font-mono text-xs flex-1 break-all !h-auto py-2" data-testid="api-key-new-value">{fresh}</code><button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => copy(fresh)} data-testid="api-key-new-copy"><Copy className="w-4 h-4" /></button></div>
        </div>
      )}
      <ul className="space-y-2">
        {keys.map(k => (
          <li key={k.id} className="flex flex-wrap items-center gap-3 text-sm" data-testid={`api-key-${k.id}`}>
            <KeyRound className="w-4 h-4 text-[#a1a1aa]" /><span className="font-medium">{k.name}</span><span className="font-mono text-xs text-[#a1a1aa]">…{k.last4}</span>
            <span className="text-xs text-[#a1a1aa]">{k.lastUsedAt ? `used ${when(k.lastUsedAt)}` : 'never used'}</span>
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm ml-auto" onClick={() => revoke(k)} data-testid={`api-key-delete-${k.id}`}><Trash2 className="w-4 h-4" />Delete</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="civr-input flex-1" placeholder="Key name, e.g. HubSpot" value={name} onChange={e => setName(e.target.value)} data-testid="api-key-name-input" />
        <button type="button" className="civr-btn civr-btn-ghost" onClick={create} data-testid="api-key-create"><Plus className="w-4 h-4" />New key</button>
      </div>
    </div>
  );
}

function Setup({ data, reload }) {
  const [f, setF] = useState({ ...data.defaults, webhookUrl: data.webhook.url || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await api('/api-access/defaults', { method: 'PUT', body: { from: f.from, connectTo: f.connectTo, machine: f.machine } });
      if (f.webhookUrl.trim()) await api('/webhooks', { method: 'PUT', body: { enabled: true, url: f.webhookUrl.trim() } });
      toast.success('API settings saved'); reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="api-setup">
      <Assist screen="api" title="Set up CRM calling by chatting" hello="Tell me how your CRM should call leads — I’ll fill in the settings below." examples={EXAMPLES} current={f} context={{ numbers: data.numbers || [] }} onApply={(p) => setF(x => ({ ...x, ...p }))} labels={LABELS} testid="api-assist" />
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Call from (one of your numbers)"><input className="civr-input" value={f.from} onChange={set('from')} placeholder="+14155550100" data-testid="api-from-input" /></Field>
        <Field label="Connect to (agent line)" hint="Used when a request doesn’t send connectTo."><input className="civr-input" value={f.connectTo} onChange={set('connectTo')} placeholder="+18005550100" data-testid="api-connect-input" /></Field>
      </div>
      <Field label="When voicemail answers">
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {[['hangup', 'Hang up and report it'], ['connect', 'Connect every answered call']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={f.machine === v} className={`civr-btn civr-btn-sm ${f.machine === v ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setF(x => ({ ...x, machine: v }))} data-testid={`api-machine-${v}`}>{l}</button>
          ))}
        </div>
      </Field>
      <Field label="Webhook URL (call updates)" hint="Saved to Webhooks below and switched on; each update is signed."><input className="civr-input" value={f.webhookUrl} onChange={set('webhookUrl')} placeholder="https://your-crm.example.com/cloudivr" data-testid="api-webhook-input" /></Field>
      <button type="button" className="civr-btn civr-btn-primary" onClick={save} disabled={busy} data-testid="api-save">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save API settings</button>
    </div>
  );
}

export function ApiAccess() {
  const { data, loading, reload } = useApi('/api-access');
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <SkeletonCard testid="api-loading" />;
  if (!data) return null;
  const a = data.access;
  const buy = async () => {
    if (!(await ask(`Turn on API access for $${a.price}/month from your wallet? It renews every 30 days; you can stop renewal any time.`, { ok: `Pay $${a.price}` }))) return;
    setBusy(true);
    try { await api('/api-access/addon', { method: 'POST' }); toast.success('API access is on'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const renew = async (on) => { await api('/api-access/addon', { method: 'PUT', body: { autoRenew: on } }).catch(e => toast.error(e.message)); reload(); };
  return (
    <div id="settings-api" className="civr-card p-6 space-y-6 lg:col-span-2 scroll-mt-24" data-testid="settings-api-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" />API — calls &amp; texts</h3>
          <p className="text-xs text-[#a1a1aa] mt-1">Calls bill both legs at normal per-minute rates; texts are $1 each or $0.10 in a 500+ campaign — all from your wallet.</p>
        </div>
        <a href={cp('/api-docs')} target="_blank" rel="noreferrer" className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="api-docs-link"><BookOpen className="w-4 h-4" />API docs</a>
      </div>
      {!a.on ? <Locked a={a} onBuy={buy} busy={busy} /> : (
        <>
          <div className="text-sm" data-testid="api-status">
            {a.via === 'enterprise' ? <span className="civr-pill civr-pill-on">Included with Enterprise</span> : a.via === 'grant' ? (
              <span className="flex flex-wrap items-center gap-2"><span className="civr-pill civr-pill-on" data-testid="api-grant-pill">Complimentary access</span><span className="text-xs text-[#a1a1aa]">Ends {when(a.addon?.until)}</span></span>
            ) : (
              <span className="flex flex-wrap items-center gap-2"><span className="civr-pill civr-pill-on">Add-on · ${a.price}/month</span>
                <span className="text-xs text-[#a1a1aa]">{a.addon?.autoRenew ? `Renews ${when(a.addon.until)}` : `Ends ${when(a.addon?.until)}`}</span>
                <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => renew(!a.addon?.autoRenew)} data-testid="api-renew-toggle">{a.addon?.autoRenew ? 'Stop renewal' : 'Keep renewing'}</button></span>
            )}
          </div>
          <Keys keys={data.keys} reload={reload} />
          <Setup data={data} reload={reload} />
        </>
      )}
    </div>
  );
}
