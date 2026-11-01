import React, { useState } from 'react';
import { toast } from 'sonner';
import { Repeat, Loader2, Info } from 'lucide-react';
import { api } from '../../api';
import { ask } from '../../confirm';
import { WalletPay } from '../../WalletPay';
import { ErrorNote } from '../../ui';

const PRICE = 25;
const WHY = 'The carrier picks the new number: you can’t choose the number or its area. Your SIM switches to it once it’s assigned (usually within minutes, up to 24 hours), so the old number stops working then. If the carrier refuses or nothing is assigned within 24 hours, the $25 is refunded.';

// eSIM: ask the carrier for a new number ($25). It arrives later; the line shows "New number coming" until then.
export function NewNumber({ item, reload }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const nc = item.numberChange;
  if (nc?.status === 'pending') return <p className="flex items-center gap-2 text-sm text-[#b45309]" data-testid={`esim-number-coming-${item.id}`}><Loader2 className="w-4 h-4 animate-spin" />New number coming. We’ll notify you when it’s assigned.</p>;
  if (item.status !== 'active' || !item.phoneNumber) return null;
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api(`/esim/${item.id}/replace-number`, { method: 'POST' }); toast.success('New number requested'); setOpen(false); reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const confirmPay = async () => { if (await ask(`Get a new number for ${item.phoneNumber}? $${PRICE} from your wallet. ${WHY}`, { ok: `Pay $${PRICE}`, title: 'Replace this eSIM number?' })) go(); };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`esim-replace-open-${item.id}`}><Repeat className="w-4 h-4" />Replace number</button>;
  return (
    <div className="w-full rounded-xl border border-[var(--c-border)] p-4 space-y-3 text-sm" data-testid={`esim-replace-${item.id}`}>
      <div className="font-semibold">{`New number for this eSIM · $${PRICE}`}</div>
      <p className="flex gap-2 text-[var(--c-muted)]"><Info className="w-4 h-4 shrink-0 mt-0.5" />{WHY}</p>
      {nc?.status === 'done' && nc.oldNumber && <p className="text-xs text-[var(--c-muted)]">{`Last change: ${nc.oldNumber} → ${nc.newNumber}`}</p>}
      <WalletPay price={PRICE} small onWallet={confirmPay} onCrypto={go} busy={busy} testid={`esim-replace-paybox-${item.id}`} walletTestid={`esim-replace-pay-${item.id}`} cryptoTestid={`esim-replace-crypto-${item.id}`}>
        <button type="button" onClick={() => setOpen(false)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`esim-replace-cancel-${item.id}`}>Cancel</button>
      </WalletPay>
      <ErrorNote error={err} testid={`esim-replace-error-${item.id}`} />
    </div>
  );
}
