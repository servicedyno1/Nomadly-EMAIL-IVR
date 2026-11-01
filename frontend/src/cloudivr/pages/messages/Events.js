import React, { useEffect } from 'react';
import { PhoneMissed, PhoneIncoming, PhoneOutgoing, Voicemail, X, AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { apiUrl, playUrl, secs } from '../../api';

const loc = () => document.documentElement.lang || undefined;
export const timeOf = (d) => new Date(d).toLocaleTimeString(loc(), { hour: 'numeric', minute: '2-digit' });
export const dayOf = (d) => {
  const x = new Date(d), t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (x.toDateString() === t.toDateString()) return 'Today';
  if (x.toDateString() === y.toDateString()) return 'Yesterday';
  return x.toLocaleDateString(loc(), { weekday: 'short', month: 'short', day: 'numeric', ...(x.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
};
export const mediaSrc = (id) => apiUrl(`/public/media/${id}`);

const STATUS = { sending: ['Sending', Clock], preview: ['Sent (preview)', Check], sent: ['Sent', Check], unconfirmed: ['Sent', Check], delivered: ['Delivered', CheckCheck], failed: ['Failed', AlertCircle] };
function Status({ e }) {
  const [label, Icon] = STATUS[e.status] || STATUS.sent;
  return (
    <div className={`flex items-center justify-end gap-1 text-xs mt-1 ${e.status === 'failed' ? 'text-[#e11d48]' : 'text-[var(--c-muted)]'}`} data-testid={`msg-status-${e.id}`}>
      <Icon className="w-3.5 h-3.5" />{label}{e.reason ? ` · ${e.reason}` : ''}
    </div>
  );
}

export function Bubble({ e, tight, last, onView }) {
  return (
    <div className={`flex ${e.out ? 'justify-end' : 'justify-start'} ${tight ? 'mt-0.5' : 'mt-3'} civr-msg-in`} data-testid={`msg-text-${e.id}`}>
      <div className="max-w-[80%] sm:max-w-[70%]">
        {e.media?.length > 0 && (
          <div className={`flex flex-wrap gap-1 mb-1 ${e.out ? 'justify-end' : ''}`}>
            {e.media.map(m => <button key={m.id} type="button" onClick={() => onView(m.id)} className="rounded-2xl overflow-hidden border border-[var(--c-border)] focus-visible:outline-2" aria-label="Open picture" data-testid={`msg-picture-${m.id}`}><img src={mediaSrc(m.id)} alt="Picture message" className="block max-h-56 max-w-[220px] object-cover" loading="lazy" /></button>)}
          </div>
        )}
        {e.body && <div className={`px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap break-words ${e.out ? 'bg-[var(--c-accent-strong)] text-white rounded-[20px] rounded-br-md' : 'civr-bubble-in rounded-[20px] rounded-bl-md'}`}>{e.body}</div>}
        <div className={`text-[11px] text-[var(--c-muted)] mt-0.5 ${e.out ? 'text-right' : ''}`}>{timeOf(e.at)}</div>
        {e.out && (last || e.status === 'failed' || e.status === 'sending') && <Status e={e} />}
      </div>
    </div>
  );
}

const CALL = { missed: ['Missed call', PhoneMissed, true], off_hours: ['Missed call · after hours', PhoneMissed, true], forward_failed: ['Missed call · forward didn’t connect', PhoneMissed, true], forwarded: ['Answered', PhoneIncoming, false], outbound_sip: ['Outgoing', PhoneOutgoing, false], outbound_ivr: ['Outgoing IVR call', PhoneOutgoing, false] };
export function CallRow({ e }) {
  const [label, Icon, missed] = CALL[e.type] || ['Call', PhoneIncoming, false];
  return (
    <div className="flex justify-center my-3" data-testid={`msg-call-${e.id}`}>
      <div className="inline-flex items-center gap-2 text-xs text-[var(--c-muted)] px-3 py-1.5 rounded-full border border-[var(--c-border)]">
        <Icon className={`w-3.5 h-3.5 ${missed ? 'text-[#f43f5e]' : 'text-[var(--c-accent)]'}`} />
        <span>{label}{!missed && e.duration ? ` · ${secs(e.duration)}` : ''} · {timeOf(e.at)}</span>
      </div>
    </div>
  );
}

export function VoicemailCard({ e }) {
  return (
    <div className="flex justify-start mt-3" data-testid={`msg-voicemail-${e.id}`}>
      <div className="w-full max-w-[85%] sm:max-w-[420px] rounded-2xl border border-[var(--c-border)] bg-[var(--c-card)] p-3.5 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><Voicemail className="w-4 h-4 text-[var(--c-accent)]" />Voicemail · {secs(e.duration)}<span className="ml-auto text-[11px] font-normal text-[var(--c-muted)]">{timeOf(e.at)}</span></div>
        {e.recordingUrl ? <audio controls preload="none" src={playUrl(e.recordingUrl)} className="w-full h-9" aria-label="Play voicemail" data-testid={`msg-voicemail-play-${e.id}`} /> : <div className="text-xs text-[var(--c-muted)]">Recording not available</div>}
        {e.transcript && <p className="text-sm text-[var(--c-muted)] italic" data-testid={`msg-voicemail-transcript-${e.id}`}>“{e.transcript}”</p>}
      </div>
    </div>
  );
}

export function DaySep({ label }) {
  return <div className="flex items-center gap-3 my-5 text-xs font-medium text-[var(--c-muted)]"><span className="flex-1 h-px bg-[var(--c-border)]" />{label}<span className="flex-1 h-px bg-[var(--c-border)]" /></div>;
}

export function Viewer({ id, onClose }) {
  useEffect(() => { const k = (ev) => ev.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Picture" onClick={onClose} data-testid="msg-picture-viewer">
      <button type="button" onClick={onClose} className="absolute top-4 right-4 w-11 h-11 grid place-items-center rounded-full bg-white/10 text-white" aria-label="Close picture" data-testid="msg-picture-viewer-close"><X className="w-5 h-5" /></button>
      <img src={mediaSrc(id)} alt="Picture message" className="max-w-full max-h-[90vh] rounded-xl" onClick={ev => ev.stopPropagation()} />
    </div>
  );
}

// Timeline: day separators, grouped bubbles, call rows and voicemail cards in time order.
export function Timeline({ events, onView }) {
  const lastOut = [...events].reverse().find(x => x.kind === 'text' && x.out)?.id;
  let prevDay = null, prev = null;
  return events.map(e => {
    const d = new Date(e.at).toDateString();
    const sep = d !== prevDay ? <DaySep key={`d-${d}`} label={dayOf(e.at)} /> : null;
    const tight = !sep && prev && prev.kind === 'text' && e.kind === 'text' && prev.out === e.out && new Date(e.at) - new Date(prev.at) < 180000;
    prevDay = d; prev = e;
    const item = e.kind === 'text' ? <Bubble key={e.id} e={e} tight={tight} last={e.id === lastOut} onView={onView} /> : e.kind === 'voicemail' ? <VoicemailCard key={e.id} e={e} /> : <CallRow key={e.id} e={e} />;
    return sep ? [sep, item] : item;
  });
}
