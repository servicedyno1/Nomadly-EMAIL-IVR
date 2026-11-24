import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Link2, Loader2, ShieldCheck } from 'lucide-react';
import { api, money } from '../../api';

const OPT = ' Reply STOP to opt out';
// Same split as phones: plain text 160 / 153 per part, accents or emoji 70 / 67.
const segments = (s) => { const uni = /[^\x00-\x7F£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]/.test(s), one = uni ? 70 : 160, many = uni ? 67 : 153; return s.length <= one ? 1 : Math.ceil(s.length / many); };
const hasLink = (s) => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|ca|info|biz|link|ly|me|app|site|online|shop)\b|\+?\d[\d\s().-]{8,}\d)/i.test(s);

// Step 2 — the text: live parts + price, opt-out line, consent; checked by the same scam / link screen as the bot.
export function StepMessage({ list, prices, onBack, onNext }) {
  const [text, setText] = useState(list?.rewrite || '');
  const [optOut, setOptOut] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const full = text + (optOut ? OPT : ''), parts = text.trim() ? segments(full) : 0, link = hasLink(text), unit = link ? prices.link : prices.plain
  const est = Math.round(list.sendable * parts * unit * 100) / 100;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/bulksms/campaigns', { method: 'POST', body: { text, optOut, consent: true } }); onNext(r.campaign, r.test); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="bulksms-message">
      <div><h3 className="font-semibold text-lg">Your message</h3><p className="text-sm text-[var(--c-muted)]">Going to {list.sendable.toLocaleString()} mobiles. Plain texts {money(prices.plain)} each part; texts with a link or phone number {money(prices.link)}.</p></div>
      <textarea className="civr-input w-full min-h-[140px]" maxLength={918} placeholder="Hi! Your order is ready for pickup today until 6pm." value={text} onChange={e => { setText(e.target.value); setErr(null); }} data-testid="bulksms-message-input" />
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="bulksms-message-meter">
        <span className="civr-pill">{full.length} characters</span>
        <span className={`civr-pill ${parts > 1 ? 'civr-pill-warn' : ''}`}>{parts || 0} {parts === 1 ? 'text' : 'texts'} per number</span>
        {link && <span className="civr-pill civr-pill-warn" data-testid="bulksms-message-link"><Link2 className="w-3 h-3" />Link / phone price</span>}
        <span className="civr-pill civr-pill-on" data-testid="bulksms-message-estimate">≈ {money(est)}</span>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={optOut} onChange={e => setOptOut(e.target.checked)} data-testid="bulksms-message-optout" />Add “Reply STOP to opt out” <span className="text-[var(--c-muted)]">(recommended — keeps texts out of spam)</span></label>
      {text.trim() && <div className="rounded-lg bg-[#0f0f0f] border border-[#1f1f1f] p-3 text-sm whitespace-pre-wrap" data-testid="bulksms-message-preview"><div className="civr-label mb-1">Preview</div>{full}</div>}
      <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} data-testid="bulksms-message-consent" /><span><ShieldCheck className="w-4 h-4 inline mr-1 text-[#34d399]" />Every number on this list agreed to get texts from me.</span></label>
      {err && <p className="text-sm text-[#fb7185]" role="alert" data-testid="bulksms-message-error">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className="civr-btn civr-btn-ghost" onClick={onBack} data-testid="bulksms-message-back"><ArrowLeft className="w-4 h-4" />Back</button>
        <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !text.trim() || !consent} onClick={go} data-testid="bulksms-message-next">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{busy ? 'Checking…' : 'Continue'}{!busy && <ArrowRight className="w-4 h-4" />}</button>
      </div>
    </div>
  );
}
