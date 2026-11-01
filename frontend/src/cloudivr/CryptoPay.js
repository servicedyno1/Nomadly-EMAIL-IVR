import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { Bitcoin, Copy, Loader2, AlertTriangle } from 'lucide-react';
import { api, useApi, money } from './api';
import { CoinIcon, CoinSelect, PayWindow } from './Pickers';
import { ErrorNote } from './ui';

// Pay any wallet-priced item with crypto: tops the wallet up by what's missing, then runs onReady() once it confirms.
function Address({ dep, testid }) {
  return (
    <div className="civr-card p-4 space-y-3" data-testid={`${testid}-deposit`}>
      {dep.dryRun && <p className="flex items-center gap-2 text-sm text-[#fbbf24]" data-testid={`${testid}-preview`}><AlertTriangle className="w-4 h-4" />Preview mode — this is not a real address. Do not send funds.</p>}
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        {!dep.dryRun && <div className="bg-white p-3 rounded-xl shrink-0"><QRCode value={dep.address} size={128} /></div>}
        <div className="min-w-0 space-y-2 text-sm">
          <div><div className="text-xs text-[#a1a1aa]">Send exactly</div><div className="font-mono text-lg inline-flex items-center gap-2" data-testid={`${testid}-amount`}><CoinIcon coin={dep.coin} size={20} />{dep.amountCrypto ? `${dep.amountCrypto} ${dep.coin}` : <><span>{money(dep.amountUsd)}</span> <span>in</span> <span>{dep.coin}</span></>}</div></div>
          <div><div className="text-xs text-[#a1a1aa]">To address</div><div className="flex items-center gap-2"><code className="break-all" data-testid={`${testid}-address`}>{dep.address}</code>{!dep.dryRun && <button type="button" onClick={() => navigator.clipboard?.writeText(dep.address).then(() => toast.success('Copied'))} className="w-10 h-10 shrink-0 grid place-items-center text-[#a1a1aa] hover:text-[#818cf8]" aria-label="Copy address" data-testid={`${testid}-copy`}><Copy className="w-4 h-4" /></button>}</div></div>
          {!dep.dryRun && dep.expiresAt && <PayWindow expiresAt={dep.expiresAt} testid={`${testid}-expiry`} />}
        </div>
      </div>
      <p className="text-xs text-[#a1a1aa]">We check every 15 seconds and finish this automatically once the payment confirms. If you leave, the money stays in your wallet.</p>
    </div>
  );
}

export function CryptoPay({ price, onReady, testid = 'crypto-pay' }) {
  const { data: w, error, reload } = useApi('/wallet');
  const [open, setOpen] = useState(false);
  const [coin, setCoin] = useState('');
  const [dep, setDep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const done = useRef(false);
  const base = useRef(0);
  const ready = !!(dep && w && w.balance > base.current && w.balance >= price);
  useEffect(() => { if (!dep) return undefined; const t = setInterval(reload, 15000); return () => clearInterval(t); }, [dep, reload]);
  useEffect(() => { if (ready && !done.current) { done.current = true; onReady(); } }, [ready, onReady]);
  if (error || !w?.coins?.length) return null;
  const amount = Math.max(w.minTopup || 0, Math.ceil(Math.max(0, price - w.balance)) || Math.ceil(price));
  const go = async () => { setBusy(true); setErr(null); try { base.current = w.balance; setDep(await api('/wallet/topup', { method: 'POST', body: { amountUsd: amount, coin: coin || w.coins[0] } })); } catch (e) { setErr(e); } finally { setBusy(false); } };
  if (dep) return <Address dep={dep} testid={testid} />;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="civr-btn civr-btn-ghost" data-testid={`${testid}-open`}><Bitcoin className="w-4 h-4" />Pay with crypto</button>;
  return (
    <div className="civr-card p-4 space-y-3 w-full" data-testid={testid}>
      <p className="text-sm text-[#d4d4d8]" data-testid={`${testid}-note`}>{w.balance >= price ? `Send $${amount} in crypto. It goes to your wallet and pays for this right away.` : `Your wallet has ${money(w.balance)}. Send $${amount} in crypto and this is paid automatically once it confirms.`}</p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="w-56"><CoinSelect coins={w.coins} value={coin || w.coins[0]} onChange={setCoin} amountUsd={amount} testid={`${testid}-coin`} /></div>
        <button type="button" onClick={go} disabled={busy} className="civr-btn civr-btn-primary" data-testid={`${testid}-address-button`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{`Get a $${amount} payment address`}</button>
      </div>
      <ErrorNote error={err} testid={`${testid}-error`} />
    </div>
  );
}
