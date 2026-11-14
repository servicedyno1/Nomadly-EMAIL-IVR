import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { api, enc } from '../../api';
import { ask } from '../../i18n';
import { ErrorNote } from '../../ui';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

// Business plan: up to 5 extra SIP logins per number, each revocable on its own. Password is shown once.
export function ExtraSipLogins({ num }) {
  const [d, setD] = useState(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const path = `/numbers/${enc(num.phoneNumber)}/sip/extra`;
  const load = () => api(path).then(setD).catch(setErr);
  useEffect(() => { load(); }, [num.phoneNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const add = async () => { setBusy(true); setErr(null); try { setFresh(await api(path, { method: 'POST', body: { label } })); setLabel(''); load(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const remove = async (x) => { if (!(await ask(`Remove the SIP login “${x.label}”? Devices using it stop working right away.`, { danger: true, ok: 'Remove', title: 'Remove SIP login?' }))) return; try { await api(`${path}/${enc(x.id)}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e); } };
  return (
    <div className="civr-card p-6 space-y-4 lg:col-span-3" data-testid="extra-sip-card">
      <div className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-[#818cf8]" /><div className="font-display text-xl font-bold">Extra SIP logins</div><span className="civr-pill" data-testid="extra-sip-count">{d.logins.length}/{d.max}</span></div>
      {!d.allowed ? <p className="text-sm text-[var(--c-muted)]" data-testid="extra-sip-upgrade">Give each desk phone or teammate its own login. Included with Pro (2 per number) and Business (5 per number).</p> : <>
        <p className="text-sm text-[var(--c-muted)]">Each login rings and calls out as {num.phoneNumber}. Remove one to cut off that device without touching the others.</p>
        {d.logins.map(x => (
          <div key={x.id} className="flex items-center gap-3 text-sm" data-testid={`extra-sip-${x.id}`}>
            <span className="font-semibold w-32 truncate">{x.label}</span><span className="font-mono flex-1 truncate" data-no-translate>{x.username}@{d.domain}</span>
            <button className="civr-btn civr-btn-ghost !px-2" onClick={() => remove(x)} aria-label={`Remove ${x.label}`} data-testid={`extra-sip-remove-${x.id}`}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {fresh && <div className="rounded-xl border border-[#818cf8]/40 p-3 text-sm space-y-1" data-testid="extra-sip-new">
          <div className="font-semibold">New login “{fresh.label}” — copy the password now, it won’t be shown again.</div>
          {[['Username', fresh.username], ['Password', fresh.password], ['Server', fresh.domain]].map(([k, v]) => <div key={k} className="flex items-center gap-2"><span className="w-20 text-[var(--c-muted)]">{k}</span><span className="font-mono flex-1 truncate" data-no-translate>{v}</span><button className="civr-btn civr-btn-ghost !px-2" onClick={() => copy(v)} aria-label={`Copy ${k}`} data-testid={`extra-sip-copy-${k.toLowerCase()}`}><Copy className="w-4 h-4" /></button></div>)}
        </div>}
        {d.logins.length < d.max && <div className="flex flex-wrap gap-2">
          <input className="civr-input flex-1 min-w-[180px]" placeholder="Name, e.g. Front desk" maxLength={40} value={label} onChange={e => setLabel(e.target.value)} data-testid="extra-sip-label-input" />
          <button className="civr-btn civr-btn-primary" onClick={add} disabled={busy} data-testid="extra-sip-add-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Add login</button>
        </div>}
      </>}
      <ErrorNote error={err} testid="extra-sip-error" />
    </div>
  );
}
