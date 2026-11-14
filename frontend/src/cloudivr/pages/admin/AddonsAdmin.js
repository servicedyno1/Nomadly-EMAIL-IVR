import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { ErrorNote, Spinner } from '../../ui';

const TYPE = { local: 'Local', mobile: 'Mobile', national: 'National', toll_free: 'Toll-free' };
const PAPER = ['No ID', 'Name + address', 'Documents'];

// Per-country add-on (USD/month on top of the plan) next to our provider cost, so pricing decisions are informed.
export default function AddonsAdmin() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api('/admin/number-addons').then(d => setItems(d.items)).catch(setErr); }, []);
  const save = async (it, amount) => {
    try { const r = await api('/admin/number-addons', { method: 'PUT', body: { country: it.country, type: it.type, amount } }); setItems(xs => xs.map(x => (x === it ? { ...x, addon: r.addon } : x))); toast.success(`${it.name} ${TYPE[it.type]}: +$${r.addon}/mo`); } catch (e) { setErr(e); }
  };
  if (!items) return <><ErrorNote error={err} testid="addons-error" />{!err && <Spinner />}</>;
  const shown = items.filter(it => !q || `${it.name} ${it.country}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4" data-testid="admin-addons">
      <p className="text-sm text-[var(--c-muted)]">Our monthly cost for each country and number type (cheapest provider, least paperwork first). Set the add-on customers pay on top of their plan; 0 = included.</p>
      <input className="civr-input max-w-xs" placeholder="Search country" value={q} onChange={e => setQ(e.target.value)} data-testid="addons-search" />
      <ErrorNote error={err} testid="addons-error" />
      <div className="civr-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[var(--c-muted)]"><th className="p-3">Country</th><th className="p-3">Type</th><th className="p-3">Provider</th><th className="p-3">Paperwork</th><th className="p-3">Our cost/mo</th><th className="p-3">Add-on/mo</th></tr></thead>
          <tbody>{shown.map(it => (
            <tr key={`${it.country}-${it.type}`} className="border-t border-[var(--c-border,#262626)]" data-testid={`addon-row-${it.country}-${it.type}`}>
              <td className="p-3">{it.name}</td><td className="p-3">{TYPE[it.type]}</td><td className="p-3">{it.provider}</td><td className="p-3">{PAPER[it.level]}</td>
              <td className="p-3 font-mono">${it.cost.toFixed(2)}</td>
              <td className="p-3"><input type="number" min="0" step="1" defaultValue={it.addon} className="civr-input !w-24 !h-8" onBlur={e => Number(e.target.value) !== it.addon && save(it, e.target.value)} data-testid={`addon-input-${it.country}-${it.type}`} /></td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
