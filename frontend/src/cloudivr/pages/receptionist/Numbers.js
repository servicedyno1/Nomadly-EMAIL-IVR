import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Hash, ShoppingCart } from 'lucide-react';
import { api, enc, useApi } from '../../api';
import { Toggle, SkeletonRows, Empty } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';

// Every number that can use the receptionist: which receptionist answers it, on or off.
export function Numbers({ receptionists, reload }) {
  const pv = usePrivacy();
  const { data, loading, reload: reloadNums } = useApi('/numbers');
  const [busy, setBusy] = useState('');
  const nums = (data?.numbers || []).filter(n => n.status === 'active' && n.access?.aiAgent);
  const put = async (n, body) => {
    setBusy(n.phoneNumber);
    try { const r = await api(`/numbers/${enc(n.phoneNumber)}/ai-agent`, { method: 'PUT', body }); toast.success(body.enabled ? (r?.ivrTurnedOff ? 'Receptionist on. The keypad menu on that number is now off.' : 'Receptionist now answers this number') : 'Back to normal call handling'); reloadNums(); reload(); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  if (loading && !data) return <SkeletonRows rows={3} />;
  if (!nums.length) return <Empty icon={Hash} title="No number can use the receptionist yet" sub="Get a number, then come back to let the receptionist answer it." testid="receptionist-numbers-empty"><Link to={cp('/app/buy?purpose=voice')} className="civr-btn civr-btn-primary" data-testid="receptionist-numbers-buy"><ShoppingCart className="w-4 h-4" />Get a number</Link></Empty>;
  if (!receptionists.length) return <Empty icon={Hash} title="Set up a receptionist first" sub="Then pick which of your numbers it answers." testid="receptionist-numbers-no-agent"><Link to={cp('/app/receptionist/new')} className="civr-btn civr-btn-primary" data-testid="receptionist-numbers-setup">Set up receptionist</Link></Empty>;
  return (
    <div className="civr-card divide-y divide-[var(--c-border)]" data-testid="receptionist-numbers">
      {nums.map((n, i) => {
        const cur = n.features?.aiAgent || {}, mine = receptionists.find(a => a.id === cur.agentId), on = !!cur.enabled && !!mine;
        const agentId = mine?.id || receptionists[0].id;
        return (
          <div key={n.phoneNumber} className="p-4 flex flex-wrap items-center gap-3" data-testid={`receptionist-number-${i}`}>
            <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}`)} className="font-mono text-sm flex-1 min-w-[10rem] hover:text-[var(--c-accent)]" data-testid={`receptionist-number-${i}-link`}>{pv.phone(n.phoneNumber)}<span className="block font-sans text-xs text-[var(--c-muted)]">{`${n.planName}${n.isSubNumber ? ' · extra' : ''}${cur.enabled && !mine ? ' · answered by an AI calling agent' : ''}`}</span></Link>
            <select className="civr-input !h-10 !w-auto" value={agentId} disabled={busy === n.phoneNumber} onChange={e => put(n, { enabled: on, agentId: e.target.value })} data-testid={`receptionist-number-${i}-agent`}>{receptionists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <Toggle checked={on} disabled={busy === n.phoneNumber} onChange={v => put(n, { enabled: v, agentId: v ? agentId : null })} testid={`receptionist-number-${i}-toggle`} label={`Receptionist answers ${n.phoneNumber}`} />
          </div>
        );
      })}
    </div>
  );
}
