import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { QrCode, Loader2, X } from 'lucide-react';
import { api, enc } from '../../api';

const APPS = [
  ['linphone', 'Linphone', 'Open Linphone → Account assistant → Fetch remote configuration (or Scan QR code). Your account is filled in for you.'],
  ['generic', 'Other apps', 'For Zoiper, Groundwire, Acrobits and other apps with QR setup. If your app has none, type the details above.'],
];

// One-tap softphone setup: Linphone link (15 min) or a plain SIP address. Both carry the password, so they stay hidden until asked for.
export function SipQr({ num, prefix = 'sip' }) {
  const [codes, setCodes] = useState(null);
  const [app, setApp] = useState('linphone');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try { setCodes(await api(`/numbers/${enc(num.phoneNumber)}/sip/qr`, { method: 'POST' })); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!codes) return <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={open} disabled={busy} data-testid={`${prefix}-qr-button`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}Set up with a QR code</button>;
  const [, , hint] = APPS.find(a => a[0] === app);
  return (
    <div className="w-full mt-2 rounded-xl border border-[var(--c-border,#262626)] p-4 civr-rise" data-testid={`${prefix}-qr-panel`}>
      <div className="flex items-center justify-between gap-2">
        <div className="civr-seg inline-flex gap-1" role="tablist" aria-label="Softphone app">
          {APPS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={app === id} onClick={() => setApp(id)} className={`civr-seg-btn min-h-[40px] px-4 rounded-full text-sm font-medium ${app === id ? 'civr-seg-on' : 'text-[#a1a1aa]'}`} data-testid={`${prefix}-qr-tab-${id}`}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={() => setCodes(null)} className="w-10 h-10 flex items-center justify-center rounded-md text-[#a1a1aa] hover:bg-white/5" aria-label="Hide QR code" data-testid={`${prefix}-qr-close`}><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-4 mt-4">
        <div className="bg-white p-3 rounded-lg shrink-0" data-testid={`${prefix}-qr-code`} data-no-translate><QRCodeSVG value={codes[app]} size={176} level="M" /></div>
        <div className="text-sm text-[#a1a1aa] space-y-2">
          <p data-testid={`${prefix}-qr-hint`}>{hint}</p>
          <p className="text-xs">{app === 'linphone' ? `This code works for ${codes.expiresInMin} minutes, then make a new one.` : 'This code includes your password. Keep it private.'}</p>
        </div>
      </div>
    </div>
  );
}
