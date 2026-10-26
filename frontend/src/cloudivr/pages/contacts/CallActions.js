import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PhoneCall, PhoneOutgoing, Loader2, Lock } from 'lucide-react';
import { api, enc } from '../../api';
import { Field, Skel } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';
import { useCallerNumbers } from '../QuickCall';
import { showUpgrade } from '../../Upgrade';

// Calling a saved contact: "Ring me, then connect" (two-way call through the owner's phone) or a Quick IVR call.
export function CallActions({ contact }) {
  const pv = usePrivacy();
  const { numbers, all, loading } = useCallerNumbers('ivrOutbound');
  const [from, setFrom] = useState('');
  const [me, setMe] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  useEffect(() => { api('/calls/callback').then(d => setMe(m => m || d.myPhone || '')).catch(() => {}); }, []);
  if (loading) return <Skel className="h-40 w-full rounded-xl" />;
  const who = contact.name || pv.phone(contact.phone);
  if (!numbers.length) return (
    <div className="rounded-xl border border-[#262626] p-4 flex gap-3" data-testid="contact-call-locked">
      <Lock className="w-5 h-5 text-[#fbbf24] shrink-0 mt-0.5" />
      <div className="min-w-0 text-sm">
        <div className="font-semibold">Calling from Contacts needs a number on the Pro plan or higher</div>
        <div className="text-[#a1a1aa] mt-1">Your number rings your phone first, or sends an automated IVR call.</div>
        {all.length ? <button type="button" onClick={() => showUpgrade({ feature: 'Calling from Contacts', need: 'pro' })} className="civr-btn civr-btn-primary civr-btn-sm mt-3" data-testid="contact-call-upgrade-button">See what Pro adds</button>
          : <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary civr-btn-sm mt-3" data-testid="contact-call-buy-link">Buy a number</Link>}
      </div>
    </div>
  );
  const caller = numbers.some(n => n.phoneNumber === from) ? from : numbers[0].phoneNumber;
  const ring = async () => {
    setBusy(true); setInfo(null);
    try {
      const d = await api('/calls/callback', { method: 'POST', body: { callerId: caller, myPhone: me, to: contact.phone } });
      setInfo({ ok: true, text: d.dryRun ? d.message : `Ringing your phone now — answer and press 1 to be connected to ${who}. Both calls bill about $${Number(d.rate).toFixed(2)}/min.` });
      toast.success(d.dryRun ? 'Validated (preview — not dialed)' : 'Calling your phone…');
    } catch (e) { setInfo({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="contact-call-actions">
      <Field label="Call from"><select className="civr-input font-mono" value={caller} onChange={e => setFrom(e.target.value)} data-testid="contact-call-from-select">{numbers.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{`${pv.phone(n.phoneNumber)} · ${n.planName}`}</option>)}</select></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-[#262626] bg-[#111113] p-4 flex flex-col gap-3" data-testid="contact-ring-me-card">
          <div className="flex items-center gap-2 font-semibold"><PhoneCall className="w-4 h-4 text-[#818cf8]" />Ring me, then connect</div>
          <p className="text-xs text-[#a1a1aa] leading-relaxed">{`We call your phone first. Answer and press 1 — then we dial ${who}. They see your CloudIVR number.`}</p>
          <input className={`civr-input !h-10 font-mono text-sm ${pv.input}`} inputMode="tel" autoComplete="off" value={me} onChange={e => setMe(e.target.value)} placeholder="My phone, e.g. +14155550111" aria-label="My phone" data-testid="contact-my-phone-input" />
          <button type="button" className="civr-btn civr-btn-primary civr-btn-sm mt-auto" disabled={busy || !me.trim()} onClick={ring} data-testid="contact-ring-me-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}Ring my phone</button>
        </div>
        <div className="rounded-xl border border-[#262626] bg-[#111113] p-4 flex flex-col gap-3" data-testid="contact-quick-ivr-card">
          <div className="flex items-center gap-2 font-semibold"><PhoneOutgoing className="w-4 h-4 text-[#818cf8]" />Quick IVR call</div>
          <p className="text-xs text-[#a1a1aa] leading-relaxed">{`Send ${who} an automated call: your script or recording, then a key to reach you, a code or a menu.`}</p>
          <Link to={cp(`/app/quick-call?to=${enc(contact.phone)}&from=${enc(caller)}`)} className="civr-btn civr-btn-ghost civr-btn-sm mt-auto" data-testid="contact-quick-ivr-link"><PhoneOutgoing className="w-4 h-4" />Set up IVR call</Link>
        </div>
      </div>
      {info && <div className={`text-sm rounded-xl px-4 py-3 border ${info.ok ? 'text-[#c7d2fe] border-[#818cf8]/30 bg-[#818cf8]/5' : 'text-[#fb7185] border-[#fb7185]/30 bg-[#fb7185]/5'}`} role="status" data-testid="contact-call-result">{info.text}</div>}
    </div>
  );
}
