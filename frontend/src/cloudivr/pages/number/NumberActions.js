import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageSquare, PhoneOutgoing, Printer, Loader2 } from 'lucide-react';
import { api, enc, money } from '../../api';
import { cp } from '../../paths';
import { ask } from '../../confirm';
import { useShell } from '../../Shell';
import { DIAL_FROM } from '../../Softphone';

const Btn = ({ icon: Icon, label, onClick, busy, testid }) => (
  <button type="button" onClick={onClick} disabled={busy} aria-label={label} title={label} data-testid={testid} className="relative z-10 w-9 h-9 rounded-lg flex items-center justify-center text-[#a1a1aa] hover:text-[#f3f4f6] hover:bg-[#1f1f1f] transition-colors disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}</button>
);

// Call / Text / Fax straight from a number: the phone opens connected on it, a new text opens from it
// (asking to switch texting on first if it's off), or Send fax opens with it picked.
export function NumberActions({ n, testid, reload }) {
  const nav = useNavigate();
  const { openPhone } = useShell() || {};
  const [busy, setBusy] = useState(false);
  if (n.status !== 'active' || n.replacedBy) return null;
  const t = n.features?.texting || {};
  const canCall = !n.faxOnly && (n.access?.browserPhone || n.access?.sipCredentials || n.access?.ivrOutbound);
  const compose = () => nav(cp(`/app/messages?compose=${enc(n.phoneNumber)}`));
  const call = () => { window.dispatchEvent(new CustomEvent(DIAL_FROM, { detail: { from: n.phoneNumber } })); openPhone?.(); };
  const text = async () => {
    if (t.enabled) return compose();
    // US local / toll-free: texting needs the carrier registration first — the switch and the form are on the Texting tab.
    if (t.mode === 'tendlc' || t.mode === 'tollfree') { toast.message(t.mode === 'tollfree' ? 'Toll-free texting needs a one-time verification — switch it on here once approved.' : 'US texting needs a 10DLC registration — switch it on here once approved.'); return nav(cp(`/app/numbers/${enc(n.phoneNumber)}?tab=sms`)); }
    const ok = await ask(`Texting is off on ${n.phoneNumber}. Turn it on to send and receive texts? ${money(t.textPrice || 0.05)} per text sent, paid from your wallet; receiving is free.`, { ok: 'Turn on texting', title: 'Turn on texting' });
    if (!ok) return;
    setBusy(true);
    try { await api(`/numbers/${enc(n.phoneNumber)}/switch`, { method: 'PATCH', body: { feature: 'texting', enabled: true } }); toast.success('Texting is on'); reload?.(); compose(); }
    catch (e) { toast.error(e.message); nav(cp(`/app/numbers/${enc(n.phoneNumber)}?tab=sms`)); }
    finally { setBusy(false); }
  };
  return (
    <>
      {canCall && <Btn icon={PhoneOutgoing} label="Call from this number" onClick={call} testid={`${testid}-call-button`} />}
      {t.available && <Btn icon={MessageSquare} label={t.enabled ? 'Text from this number' : 'Turn on texting and text from this number'} onClick={text} busy={busy} testid={`${testid}-text-button`} />}
      {n.faxOnly && <Btn icon={Printer} label="Send a fax from this number" onClick={() => nav(cp(`/app/fax?from=${enc(n.phoneNumber)}`))} testid={`${testid}-fax-button`} />}
    </>
  );
}
