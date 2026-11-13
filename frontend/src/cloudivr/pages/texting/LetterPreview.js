import React from 'react';

// Same wording as the signed PDF; empty required details show in red so nothing is missed.
const Blank = ({ v, label, need = true }) => (v?.trim()
  ? <b className="font-semibold">{v}</b>
  : need ? <span className="text-[#dc2626] font-semibold" data-testid="texting-letter-blank">[{label}]</span> : null);

export function LetterPreview({ phone, h, sig, sigOk }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="rounded-xl bg-white text-[#0f172a] p-5 text-[13px] leading-relaxed shadow-lg" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }} data-testid="texting-letter-live" data-no-translate>
      <p className="font-bold text-[15px] mb-3">LETTER OF AUTHORIZATION — HOSTED SMS / MMS</p>
      <p className="mb-3">Date: {today}</p>
      <p className="font-bold">Customer of record (as shown on the phone bill):</p>
      <p>Authorized person: <Blank v={h.name} label="Account holder’s full name" /></p>
      {h.business?.trim() && <p>Business name: <Blank v={h.business} /></p>}
      <p>Service address: <Blank v={h.address} label="Street address" />, <Blank v={h.city} label="City" />, <Blank v={h.state} label="State / province" /> <Blank v={h.zip} label="ZIP / postal code" /></p>
      <p>Current voice provider: <Blank v={h.carrier} label="Current phone provider" /></p>
      {h.account?.trim() && <p>Account number: <Blank v={h.account} /></p>}
      <p className="font-bold mt-3">Telephone number(s) to be hosted for messaging:</p>
      <p className="font-mono mb-3">{phone}</p>
      <p className="text-[12px] text-[#334155]">I, the undersigned, am the account holder or am authorized to act on behalf of the account holder for the telephone number(s) listed above. I authorize Telnyx LLC and its agents to enable and route SMS and MMS messaging for these number(s) on the Telnyx network. Voice service remains with my current provider and is not transferred. I understand that messaging previously provided by another provider may stop for these number(s), and that this authorization remains in effect until revoked in writing.</p>
      <p className="font-bold mt-4">Signature:</p>
      <p className="text-2xl italic border-b border-[#0f172a] pb-1 max-w-xs min-h-[2.5rem]" style={{ fontFamily: 'Georgia, serif', color: sigOk ? '#1e3a8a' : '#dc2626' }} data-testid="texting-letter-signature">{sig.trim() || <span className="text-sm not-italic font-semibold">[Type your name below to sign]</span>}</p>
      <p className="text-[12px] mt-1">Printed name: {h.name || '—'}    Date: {today}</p>
    </div>
  );
}
