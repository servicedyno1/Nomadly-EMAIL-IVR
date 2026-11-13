import React, { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { ask } from '../../confirm';
import { Toggle } from '../../ui';

// Free-page meter + "Fax line" switch (receiving moves the number off voice) for each Business number.
function LineRow({ n, reload }) {
  const [busy, setBusy] = useState(false);
  const u = n.usage || { left: 0, free: 50 };
  const id = n.phoneNumber.replace(/\D/g, '');
  const flip = async (enabled) => {
    const warn = enabled && n.voiceRouting
    const ok = await ask(warn
      ? `This number takes calls with your ${n.voiceRouting}. A number can take calls or receive faxes — not both. If you turn the fax line on, callers will hear fax tones instead of your ${n.voiceRouting} until you switch it back to voice.`
      : enabled
        ? `Turn on the fax line for ${n.phoneNumber}? It will receive faxes, and voice calls to it stop until you switch it back.`
        : `Switch ${n.phoneNumber} back to voice? It will take calls again and stop receiving faxes.`, { ok: enabled ? 'Turn on fax line' : 'Back to voice', cancel: warn ? 'Keep taking calls' : 'Cancel', title: warn ? 'This stops your calls' : 'Fax line', danger: !!warn });
    if (!ok) return;
    setBusy(true);
    try {
      await api('/fax/line', { method: 'PATCH', body: { phone: n.phoneNumber, enabled, confirm: true } });
      toast.success(enabled ? 'Fax line on — faxes will arrive in your inbox and email' : 'Back on voice');
      reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="py-4 border-b border-white/5 last:border-0" data-testid={`fax-line-row-${id}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium tabular-nums">{n.phoneNumber}</div>
          <div className="text-xs text-[#a1a1aa] mt-1" data-testid={`fax-line-status-${id}`}>{n.faxOnly ? 'Fax-only number · always receiving faxes' : n.faxLine ? 'Receiving faxes · voice calls paused' : 'Voice line · not receiving faxes'}</div>
          {!n.faxLine && n.voiceRouting && <div className="text-xs text-[#a1a1aa] mt-0.5">Takes calls with your {n.voiceRouting}</div>}
        </div>
        {n.faxOnly ? <span className="civr-pill" data-testid={`fax-only-pill-${id}`}>Fax only</span> : <Toggle checked={!!n.faxLine} onChange={flip} disabled={busy} label={`Fax line for ${n.phoneNumber}`} testid={`fax-line-toggle-${id}`} />}
      </div>
      <div className="mt-3">
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#34d399] transition-[width] duration-500" style={{ width: `${(u.left / u.free) * 100}%` }} /></div>
        <div className="text-xs text-[#a1a1aa] mt-1.5" data-testid={`fax-free-left-${id}`}>{`${u.left} of ${u.free} free pages left this plan month`}</div>
      </div>
    </div>
  );
}

export function FaxLines({ numbers, reload }) {
  return (
    <div className="civr-card p-6 h-full" data-testid="fax-lines-card">
      <div className="font-semibold">Receive faxes</div>
      <p className="text-sm text-[#a1a1aa] mt-1">A number can take voice calls or faxes, not both at once. Received faxes come to your inbox here and to your account email as a PDF.</p>
      <div className="mt-2">{numbers.map(n => <LineRow key={n.phoneNumber} n={n} reload={reload} />)}</div>
    </div>
  );
}
