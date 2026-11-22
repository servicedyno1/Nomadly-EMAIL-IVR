import React, { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { Load, Act, fmt, dt, Pill } from './common';

// 2Chat UK numbers the supplier couldn't fill (finish by hand) and numbers waiting for their 2Chat forward.
function Finish({ o, done }) {
  const [number, setNumber] = useState(o.bought || '');
  const [landing, setLanding] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="civr-input !py-1.5 text-sm !w-44" placeholder="+44… bought on 2Chat" value={number} onChange={e => setNumber(e.target.value)} data-testid={`admin-2chat-number-${o.id}`} />
      <input className="civr-input !py-1.5 text-sm !w-48" placeholder="Landing +1… (optional)" value={landing} onChange={e => setLanding(e.target.value)} data-testid={`admin-2chat-landing-${o.id}`} />
      <Act label="Finish order" path={`/admin/twochat/orders/${o.id}/complete`} extra={() => ({ number, landing })} done={done} testid={`admin-2chat-finish-${o.id}`} />
    </div>
  );
}

function CheckNow({ n, done }) {
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await api(`/admin/twochat/check/${encodeURIComponent(n.phoneNumber)}`, { method: 'POST', body: {} }); toast.success('Checking now — give it a minute'); done(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return <button type="button" className="civr-btn civr-btn-sm civr-btn-ghost" disabled={busy} onClick={run} data-testid={`admin-2chat-check-${n.phoneNumber}`}>Check now</button>;
}

export default function TwoChatOrders() {
  return (
    <Load path="/admin/twochat" testid="admin-2chat">
      {(d, reload) => (
        <div className="civr-card p-5 space-y-4" data-testid="admin-2chat">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-xs uppercase tracking-widest text-[#a1a1aa]">2Chat UK numbers</div>
            <Pill tone={d.orders.length ? 'warn' : 'ok'}>{d.orders.length ? `${d.orders.length} to finish by hand` : 'No stuck orders'}</Pill>
          </div>
          {d.orders.length > 0 && (
            <div className="space-y-3" data-testid="admin-2chat-orders">
              <p className="text-xs text-[#a1a1aa]">Buy a number in that area on 2Chat, then enter it. Leave the landing blank to have one bought on Infobip, or enter one you bought there yourself. The customer only sees "setting up".</p>
              {d.orders.map(o => (
                <div key={o.id} className="border border-[#262626] rounded-lg p-3 space-y-2" data-testid={`admin-2chat-order-${o.id}`}>
                  <div className="text-sm"><b>{o.type.replace('_', '-')} · {o.where}</b> for {o.chatId} · {fmt(o.amount)} paid · {dt(o.createdAt)} · {o.tries} retries</div>
                  {o.why && <div className="text-xs text-[#fbbf24]">{o.why}</div>}
                  {o.bought && <div className="text-xs text-[#a1a1aa]">2Chat number already bought: {o.bought} — only the landing is missing.</div>}
                  <Finish o={o} done={reload} />
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2" data-testid="admin-2chat-setup">
            <div className="text-xs text-[#a1a1aa]">Waiting for the 2Chat forward (2Chat → Virtual numbers → number → call flow → Forward to number → landing):</div>
            {d.setup.length ? d.setup.map(n => (
              <div key={n.phoneNumber} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`admin-2chat-setup-${n.phoneNumber}`}>
                <span><b>{n.phoneNumber}</b> → forward to <b className="text-[#818cf8]">{n.landingNumber}</b> · {n.chatId} · {n.tries} checks · last {dt(n.lastTry)}</span>
                <CheckNow n={n} done={reload} />
              </div>
            )) : <p className="text-sm text-[#a1a1aa]">None — every 2Chat number is live.</p>}
          </div>
        </div>
      )}
    </Load>
  );
}
