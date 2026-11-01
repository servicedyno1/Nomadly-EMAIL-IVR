import React, { useState } from 'react';
import { Loader2, Link2, BarChart3, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi } from '../../api';
import { Spinner, ErrorNote } from '../../ui';
import { Stat, Pill, fmt } from './common';

// One Spenza plan: what it includes, Spenza's cost, and the customer price you set.
function PlanRow({ p, reload }) {
  const [price, setPrice] = useState(p.price ?? '');
  const [label, setLabel] = useState(p.label || '');
  const [busy, setBusy] = useState(false);
  const save = async (enabled) => {
    setBusy(true);
    try { await api(`/admin/esim/plans/${encodeURIComponent(p.planId)}`, { method: 'PUT', body: { price, enabled, label } }); toast.success(enabled ? 'Plan is on sale' : 'Saved'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const id = p.planId.replace(/\W/g, '');
  return (
    <tr className="border-t border-[#27272a] align-top" data-testid={`admin-esim-plan-${id}`}>
      <td className="py-3 pr-3"><div className="font-semibold">{p.planId}</div><div className="text-xs text-[#a1a1aa]">{p.operator} · {p.isEsim ? 'eSIM' : 'physical SIM'} · {p.planType}{p.recurring ? ' · renews' : ''}</div></td>
      <td className="py-3 pr-3 text-sm">{p.data || '—'} data<br />{p.voiceMinutes ?? '—'} min · {p.sms ?? '—'} texts<br /><span className="text-[#a1a1aa]">{p.validityDays} days</span></td>
      <td className="py-3 pr-3 font-mono">{fmt(p.cost)}</td>
      <td className="py-3 pr-3 space-y-2 min-w-[200px]">
        <input className="civr-input" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="Customer price $" aria-label={`Customer price for ${p.planId}`} data-testid={`admin-esim-price-${id}`} />
        <input className="civr-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="Name shown to customers (optional)" aria-label={`Customer name for ${p.planId}`} data-testid={`admin-esim-label-${id}`} />
      </td>
      <td className="py-3">
        <div className="flex flex-col gap-2">{p.enabled ? <Pill tone="ok">On sale</Pill> : <Pill>Hidden</Pill>}
          <button type="button" disabled={busy} onClick={() => save(!p.enabled)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`admin-esim-toggle-${id}`}>{busy && <Loader2 className="w-3 h-3 animate-spin" />}{p.enabled ? 'Stop selling' : 'Sell this plan'}</button>
          {p.enabled && <button type="button" disabled={busy} onClick={() => save(true)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`admin-esim-save-${id}`}>Save price</button>}
        </div>
      </td>
    </tr>
  );
}

function SimRow({ s, reload }) {
  const [use, setUse] = useState(null);
  const [email, setEmail] = useState('');
  const id = s.iccid.slice(-6);
  const run = async (fn) => { try { await fn(); } catch (e) { toast.error(e.message); } };
  return (
    <li className="civr-card p-4 space-y-2" data-testid={`admin-esim-sim-${id}`}>
      <div className="flex flex-wrap items-center gap-2"><span className="font-mono">{s.phoneNumber || 'No number'}</span><Pill tone={s.status === 'ACTIVE' ? 'ok' : ''}>{s.status}</Pill><span className="text-xs text-[#a1a1aa]">{s.isEsim ? 'eSIM' : 'SIM'} · ICCID …{id} · {s.device || 'no device'} · {s.assignedTo || 'unassigned'}</span>{s.linkedTo && <Pill tone="ok">{`Linked to account ${s.linkedTo}`}</Pill>}</div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run(async () => setUse((await api(`/admin/esim/sims/${s.iccid}/usage`)).usage))} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`admin-esim-usage-${id}`}><BarChart3 className="w-4 h-4" />Usage</button>
        <input className="civr-input max-w-[240px]" value={email} onChange={e => setEmail(e.target.value)} placeholder="CloudIVR account email" aria-label="CloudIVR account email" data-testid={`admin-esim-link-email-${id}`} />
        <button type="button" disabled={!email} onClick={() => run(async () => { await api(`/admin/esim/sims/${s.iccid}/link`, { method: 'POST', body: { email } }); toast.success('Linked, no charge'); reload(); })} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`admin-esim-link-${id}`}><Link2 className="w-4 h-4" />Link to account</button>
      </div>
      {use && <pre className="text-xs text-[#a1a1aa] whitespace-pre-wrap" data-testid={`admin-esim-usage-out-${id}`}>{JSON.stringify(use, null, 1)}</pre>}
    </li>
  );
}

export default function EsimAdmin() {
  const { data, error, reload } = useApi('/admin/esim');
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const f = data.fleet;
  const hook = async () => { try { const r = await api('/admin/esim/webhook', { method: 'POST' }); toast.success(r.preview ? 'Saved (preview: not sent to Spenza)' : 'Spenza will now send texts here'); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="space-y-8" data-testid="admin-esim">
      {data.error && <ErrorNote error={{ message: `Spenza: ${data.error}` }} />}
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Spenza credit" value={f?.credit?.map(c => `${c.amount} ${c.currency}`).join(' · ') || '—'} sub="Prepaid balance on your Spenza account" testid="admin-esim-credit" />
        <Stat label="SIMs on Spenza" value={f?.sims?.length ?? '—'} testid="admin-esim-sim-count" />
        <Stat label="Plans for sale" value={`${data.plans.filter(p => p.enabled).length} of ${data.plans.length}`} testid="admin-esim-plan-count" />
      </div>
      <section className="civr-card p-5 overflow-x-auto" data-testid="admin-esim-plans">
        <h2 className="font-display text-xl font-bold mb-1">Spenza plans</h2>
        <p className="text-sm text-[#a1a1aa] mb-4">Everything your Spenza account can sell. Set a customer price, then turn a plan on. Customers pay it from their wallet every month.</p>
        <table className="w-full text-left"><thead><tr className="text-xs text-[#a1a1aa]"><th className="pb-2">Plan</th><th className="pb-2">Includes</th><th className="pb-2">Spenza cost</th><th className="pb-2">Customer price</th><th className="pb-2">Status</th></tr></thead>
          <tbody>{data.plans.map(p => <PlanRow key={p.planId} p={p} reload={reload} />)}</tbody></table>
        {f?.simProducts?.length > 0 && <p className="text-xs text-[#a1a1aa] mt-3" data-testid="admin-esim-products">{`SIM products: ${f.simProducts.map(s => `${s.simId} (${s.isEsim ? 'eSIM' : 'physical'}, $${s.price}, ${s.inStock} in stock)`).join(', ')}`}</p>}
      </section>
      <section className="space-y-3" data-testid="admin-esim-sims">
        <h2 className="font-display text-xl font-bold">Your Spenza SIMs</h2>
        <ul className="space-y-3">{(f?.sims || []).map(s => <SimRow key={s.iccid} s={s} reload={reload} />)}</ul>
      </section>
      <section className="civr-card p-5 space-y-2" data-testid="admin-esim-connect">
        <h2 className="font-display text-xl font-bold">Texts and calls</h2>
        <p className="text-sm">{f?.webhook?.url ? `Incoming texts arrive at ${f.webhook.url}` : 'Incoming texts aren’t connected yet.'}</p>
        <button type="button" onClick={hook} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="admin-esim-webhook-button"><Webhook className="w-4 h-4" />{f?.webhook?.url ? 'Reconnect texts' : 'Connect incoming texts'}</button>
        <p className="text-sm text-[#a1a1aa]" data-testid="admin-esim-sip">{data.sipIp ? `Calls for lines set to "Ring in CloudIVR" go to your SIP gateway${f?.sip?.numbers?.length ? ` (${f.sip.numbers.length} numbers)` : ''}.` : 'Call routing to CloudIVR needs a SIP gateway address (SPENZA_SIP_INGRESS_IP) and an Admin-role Spenza key. Until then every eSIM rings on the customer’s phone.'}</p>
      </section>
    </div>
  );
}
