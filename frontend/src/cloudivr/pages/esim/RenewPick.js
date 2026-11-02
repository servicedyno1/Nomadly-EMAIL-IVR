import React from 'react';

// Auto-renew choice at checkout (on by default). Shared by eSIM and USA mobile number purchases.
export function RenewPick({ on, onChange, price, testid, className = "border-[var(--c-line,#2a2a2a)]" }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`w-full flex items-start gap-3 text-left rounded-xl border p-3 ${className}`} data-testid={testid}>
      <span className="mt-0.5 shrink-0 inline-block w-9 h-5 rounded-full relative transition-colors" style={{ background: on ? '#818cf8' : '#64748b' }}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} /></span>
      <span className="text-sm"><span className="font-semibold block">{on ? 'Auto-renew on' : 'Auto-renew off'}</span>
        <span className="text-[var(--c-muted,#a1a1aa)]">{on ? `Renews every 30 days: $${price} is taken from your wallet a day before it ends. You can turn this off any time.` : 'The line ends after 30 days and its number is released. You can turn auto-renew back on before then.'}</span></span>
    </button>
  );
}

// "Renews 2026-12-01" / "Ends 2026-12-01" for a line's manage card.
export const renewText = (item, money) => {
  if (!item.price) return 'Linked by CloudIVR';
  const end = String(item.expiresAt || item.nextBillAt || '').slice(0, 10);
  if (item.status === 'suspended') return `Renewal due · ends ${end || '—'} if unpaid`;
  return item.autoRenew ? `${money(item.price)}/month · renews ${end || '—'}` : `Auto-renew off · ends ${end || '—'}`;
};
