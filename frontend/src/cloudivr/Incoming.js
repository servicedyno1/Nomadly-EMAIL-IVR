import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Keyboard, Loader2, MessageSquareReply, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { api, money } from './api';
import { cp } from './paths';
import { usePrivacy } from './privacy';
import { useRtc } from './rtc';
import { every, useRingNotify, useTitleFlash } from './ringAlerts';
import { QuickReply } from './QuickReply';

// Fired when a ringing call goes away (answered elsewhere, declined, timed out) so lists like the Inbox can refresh.
export const RING_ENDED = 'civr:ring-ended';
const ended = () => [1500, 6000].forEach(ms => setTimeout(() => window.dispatchEvent(new Event(RING_ENDED)), ms));
const same = (a, b) => a.length === b.length && a.every((c, i) => c.id === b[i].id && c.answerMode === b[i].answerMode);

// Calls ringing for this account. Polling also tells the server this tab is open, so new calls ring here.
function useRinging() {
  const [calls, setCalls] = useState([]);
  const [skew, setSkew] = useState(0);
  const gone = useRef(new Set());
  useEffect(() => {
    let alive = true, busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const d = await api('/incoming');
        if (!alive) return;
        const ids = new Set(d.calls.map(c => c.id));
        gone.current.forEach(id => { if (!ids.has(id)) gone.current.delete(id); });
        if (d.now) setSkew(Date.now() - Date.parse(d.now));
        const next = d.calls.filter(c => !gone.current.has(c.id));
        setCalls(prev => { if (prev.some(c => !ids.has(c.id))) ended(); return same(prev, next) ? prev : next; });
      } catch (_) { /* next tick */ } finally { busy = false; }
    };
    tick();
    const stop = every(2000, tick);
    return () => { alive = false; stop(); };
  }, []);
  const drop = useCallback((id) => { gone.current.add(id); setCalls(l => l.filter(c => c.id !== id)); ended(); }, []);
  return { calls, skew, drop };
}

// The banner sits just under the top bar (lower while the preview strip above it is still on screen).
function useBelowTopBar() {
  const [top, setTop] = useState(64);
  useEffect(() => {
    const measure = () => setTop(Math.max(0, Math.round(document.querySelector('[data-civr-topbar]')?.getBoundingClientRect().bottom ?? 64)));
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, []);
  return top;
}

function Countdown({ c, skew }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  if (!c.timeoutAt) return null;
  const left = Math.max(0, Math.round((Date.parse(c.timeoutAt) + skew - now) / 1000));
  return <span className="block text-xs sm:text-sm text-[#d4d4d8] mt-1" data-testid="incoming-countdown">{`${left}s left, then it is ${c.fallback || 'your usual fallback'}`}</span>;
}

function Caller({ c, more, skew }) {
  const pv = usePrivacy();
  return (
    <div className="flex items-center gap-4 min-w-0 flex-1">
      <span className="civr-incoming-ring w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-full bg-[#34d399] text-[#04130d] flex items-center justify-center"><PhoneIncoming className="w-6 h-6" /></span>
      <div className="min-w-0">
        <div className="text-xs font-mono uppercase tracking-widest text-[#34d399]" data-testid="incoming-label">{more > 0 ? `Incoming call · ${more} more ringing` : 'Incoming call'}</div>
        <div className="font-mono text-2xl sm:text-3xl font-bold text-white truncate" data-no-translate data-testid="incoming-from">{c.from ? pv.phone(c.from) : '—'}</div>
        <div className="text-xs sm:text-sm text-[#a1a1aa]" data-testid="incoming-to">{`To your number ${pv.phone(c.phone)}`}</div>
        <Countdown c={c} skew={skew} />
      </div>
    </div>
  );
}

function Actions({ c, busy, voiceFirst, onText, onVoice, onDecline }) {
  const hi = 'civr-btn civr-btn-primary', lo = 'civr-btn civr-btn-ghost';
  return (
    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 md:justify-end shrink-0">
      {!c.rtcOnly && <button type="button" onClick={() => onText()} disabled={!c.canText || !!busy} className={`${voiceFirst ? lo : hi} col-span-2 sm:col-span-1`} data-testid="incoming-text-button">{busy === 'text' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Keyboard className="w-4 h-4" />}Answer as text</button>}
      <button type="button" onClick={onVoice} disabled={!c.canVoice || !!busy} className={`${voiceFirst ? hi : lo} ${c.rtcOnly ? 'col-span-2 sm:col-span-1' : ''}`} data-testid="incoming-voice-button"><Phone className="w-4 h-4" /><span className="sm:hidden">Voice</span><span className="hidden sm:inline">Answer with voice</span></button>
      <button type="button" onClick={onDecline} disabled={!!busy} className="civr-btn civr-btn-danger" data-testid="incoming-decline-button">{busy === 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOff className="w-4 h-4" />}Decline</button>
    </div>
  );
}

function Footer({ c, remember, setRemember, auto, cancelAuto, note, onMessage }) {
  const voiceHint = c.canVoice ? '' : c.simulated ? 'Preview calls can only be answered as text.' : 'To answer by voice, create a SIP login for this number (SIP tab).';
  return (
    <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#a1a1aa]">
      {!c.rtcOnly && <label className="inline-flex items-center gap-2 cursor-pointer text-[#e4e4e7]"><input type="checkbox" className="accent-[#34d399] w-4 h-4" checked={remember} onChange={e => setRemember(e.target.checked)} data-testid="incoming-remember-checkbox" />Remember for this number</label>}
      {c.canText && !c.rtcOnly && <span data-testid="incoming-text-rate">{`Text answer: ${money(c.textRate)}/min from your wallet`}</span>}
      {voiceHint && <span data-testid="incoming-voice-hint">{voiceHint}</span>}
      {!c.rtcOnly && <button type="button" onClick={onMessage} className="inline-flex items-center gap-1.5 underline text-[#e4e4e7] hover:text-white" data-testid="incoming-decline-message-button"><MessageSquareReply className="w-3.5 h-3.5" />Decline with a text message</button>}
      {auto !== null && <span className="inline-flex items-center gap-2 text-[#34d399] font-medium" data-testid="incoming-auto-text">{`Answering as text in ${auto}s…`}<button type="button" onClick={cancelAuto} className="underline text-[#f4f4f5]" data-testid="incoming-auto-cancel-button">Cancel</button></span>}
      {note && <span className="basis-full text-[#fbbf24]" data-testid="incoming-error">{note}</span>}
    </div>
  );
}

// Answer / decline logic for one ringing call. `ringing` = the browser phone's own ringing call for this number.
function IncomingBanner({ c, more, skew, drop, ringing, openPhone }) {
  const rtc = useRtc();
  const nav = useNavigate();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(c.answerMode === 'text' && c.canText ? 3 : null);
  const [waitVoice, setWaitVoice] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const top = useBelowTopBar();

  const text = async (keep = remember) => {
    setAuto(null); setBusy('text'); setErr('');
    try {
      const d = await api(`/incoming/${c.id}/text`, { method: 'POST', body: { remember: keep, lang: c.lang, voice: c.voice, announce: c.announce } });
      drop(c.id);
      toast.success('Answered as text');
      nav(cp('/app/text-call'), { state: { liveId: d.call.id } });
    } catch (e) {
      if (e.code === 'not_ringing') { drop(c.id); toast.error(e.message); } else { setErr(e.message); setBusy(''); }
    }
  };
  const answerRtc = useCallback((r) => { r.ref.answer(); drop(c.id); openPhone(); }, [c.id, drop, openPhone]);
  useEffect(() => { if (waitVoice && ringing) answerRtc(ringing); }, [waitVoice, ringing, answerRtc]);
  const voice = () => {
    setAuto(null); setErr('');
    if (remember && !c.rtcOnly) api(`/incoming/${c.id}/voice`, { method: 'POST', body: { remember: true } }).catch(() => {});
    if (ringing) return answerRtc(ringing);
    if (rtc.phone !== c.phone || rtc.status !== 'ready') rtc.connect(c.phone);
    setWaitVoice(true);
  };
  // reply = "Decline with a text message": the caller also gets this SMS.
  const decline = async (reply = '') => {
    setAuto(null); setBusy('decline');
    if (c.rtcOnly) { ringing?.ref.hangup(); drop(c.id); return; }
    try {
      const d = await api(`/incoming/${c.id}/decline`, { method: 'POST', body: reply ? { reply } : {} });
      if (d.replyError) toast.error(d.replyError);
      else if (d.reply) toast.success(d.reply.status === 'preview' ? 'Declined — text saved (preview, not sent)' : 'Declined — text sent to the caller');
      else toast('Declined — the call goes to your usual fallback');
    } catch (e) { toast.error(e.message); }
    drop(c.id);
  };
  useEffect(() => {
    if (auto === null) return undefined;
    if (auto === 0) { text(false); return undefined; }
    const t = setTimeout(() => setAuto(a => (a === null ? null : a - 1)), 1000);
    return () => clearTimeout(t);
  }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps
  const voiceNote = waitVoice && !ringing ? (rtc.status === 'error' && rtc.phone === c.phone ? rtc.msg : 'Connecting the browser phone — the call is answered as soon as it reaches this browser…') : '';

  return (
    <div className="fixed inset-x-0 z-[70] p-2 sm:px-4 sm:pt-3 pointer-events-none" style={{ top }} data-testid="incoming-overlay">
      <div role="alertdialog" aria-live="assertive" aria-label="Incoming call" className="civr-incoming pointer-events-auto mx-auto max-w-4xl rounded-2xl border-2 border-[#34d399] bg-[#04130d] p-4 sm:p-5 shadow-2xl" data-testid="incoming-banner">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <Caller c={c} more={more} skew={skew} />
          <Actions c={c} busy={busy} voiceFirst={c.answerMode === 'voice' || c.rtcOnly} onText={text} onVoice={voice} onDecline={() => decline()} />
        </div>
        <Footer c={c} remember={remember} setRemember={setRemember} auto={auto} cancelAuto={() => setAuto(null)} note={err || voiceNote} onMessage={() => { setAuto(null); setMsgOpen(o => !o); }} />
        {msgOpen && <div className="mt-3" data-testid="incoming-message-box"><QuickReply onSend={decline} busy={busy === 'decline'} sendLabel="Decline & send" testid="incoming-message" /></div>}
      </div>
    </div>
  );
}

// Big ringing banner on every page while a call rings for one of the account's numbers.
export function IncomingCalls({ openPhone }) {
  const { calls, skew, drop } = useRinging();
  const rtc = useRtc();
  const pv = usePrivacy();
  const ringing = rtc.call?.inbound && rtc.call.state === 'ringing' ? rtc.call : null;
  const list = calls.length ? calls : ringing ? [{ id: 'rtc', from: ringing.peer, phone: rtc.phone, canVoice: true, canText: false, answerMode: 'voice', rtcOnly: true }] : [];
  const describe = useCallback((c) => `${pv.phone(c.from)} → ${pv.phone(c.phone)}`, [pv]);
  useTitleFlash(list.length > 0);
  useRingNotify(list, describe);
  if (!list.length) return null;
  const c = list[0];
  return <IncomingBanner key={c.id} c={c} more={list.length - 1} skew={skew} drop={drop} ringing={ringing && (c.rtcOnly || rtc.phone === c.phone) ? ringing : null} openPhone={openPhone} />;
}
