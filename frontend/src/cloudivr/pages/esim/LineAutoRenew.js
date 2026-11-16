import React, { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { Toggle, askOff } from '../../ui';

export const hasRenew = (item) => ['active', 'suspended'].includes(item.status) && item.price > 0;

// Auto-renew switch for a USA eSIM or Texting Number (same look as other numbers' billing switch).
export function LineAutoRenew({ item, reload, testid, className = '' }) {
  const [busy, setBusy] = useState(false);
  const [opt, setOpt] = useState(null);
  if (!hasRenew(item)) return null;
  const value = opt ?? !!item.autoRenew;
  const flip = async (v) => {
    if (!v && !(await askOff({ phoneNumber: item.phoneNumber || 'this line', expiresAt: item.expiresAt }))) return;
    setOpt(v); setBusy(true);
    try {
      await api(`/esim/${item.id}/auto-renew`, { method: 'POST', body: { on: v } });
      toast.success(v ? 'Auto-renew on' : `Auto-renew off: the line ends on ${String(item.expiresAt || '').slice(0, 10) || 'its end date'}`);
      await reload?.();
    } catch (e) { toast.error(e.message); } finally { setOpt(null); setBusy(false); }
  };
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`} data-testid={`${testid}-row`}>
      <span className="text-sm">Auto-renew from wallet</span>
      <Toggle checked={value} disabled={busy} onChange={flip} testid={testid} label="Auto-renew" />
    </div>
  );
}
