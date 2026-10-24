import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Minus, PhoneOff, Plus } from 'lucide-react';
import { api, money, secs } from '../../api';
import { Spinner } from '../../ui';
import { Transcript, TEXT_SIZES } from './Transcript';
import { Composer } from './Composer';

const SIZE_KEY = 'civr_relay_text_size';
const OUTCOME = { completed: 'Call ended', no_answer: 'No answer', busy: 'The line was busy', cancelled: 'Call cancelled', out_of_funds: 'Ended — balance ran out', ended: 'Call ended' };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Polls the call (~1 s) while it is going; returns the latest state.
function useRelayCall(id) {
  const [call, setCall] = useState(null);
  useEffect(() => {
    let stop = false, t;
    const tick = async () => {
      try { const d = await api(`/relay/calls/${id}`); if (stop) return; setCall(d.call); if (d.call.status === 'ended') return; } catch (_) { /* retry */ }
      if (!stop) t = setTimeout(tick, 900);
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [id]);
  return [call, setCall];
}

// Flashes the conversation border (and buzzes phones) when they start talking or a new line lands.
function useFlash(call) {
  const [flash, setFlash] = useState(false);
  const seen = useRef({ them: 0, interim: false });
  useEffect(() => {
    if (!call) return;
    const them = call.lines.filter(l => l.who === 'them').length, interim = !!call.interim;
    if (them > seen.current.them || (interim && !seen.current.interim)) {
      setFlash(true); navigator.vibrate?.(80);
      const t = setTimeout(() => setFlash(false), 900);
      seen.current = { them, interim };
      return () => clearTimeout(t);
    }
    seen.current = { them, interim };
  }, [call]);
  return flash;
}

function Status({ call }) {
  if (call.status === 'ringing') return <span className="civr-pill civr-pill-warn" data-testid="relay-status"><Loader2 className="w-3 h-3 animate-spin" />Ringing…</span>;
  if (call.status === 'live') return <span className="civr-pill civr-pill-on" data-testid="relay-status"><span className="civr-pulse">●</span>Connected · <span className="font-mono">{clock(call.duration)}</span></span>;
  return <span className="civr-pill" data-testid="relay-status">{OUTCOME[call.outcome] || 'Call ended'}</span>;
}

function Ended({ call, onClose }) {
  const copy = () => navigator.clipboard?.writeText(call.lines.filter(l => ['me', 'them'].includes(l.who)).map(l => `${l.who === 'me' ? 'Me' : 'Them'}: ${l.text}`).join('\n')).then(() => toast.success('Transcript copied'));
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4" data-testid="relay-ended">
      <div className="text-sm text-[#a1a1aa] flex-1" data-testid="relay-summary">{secs(call.duration)} · {call.dryRun ? 'Preview — not billed' : money(call.charge)}</div>
      <button type="button" onClick={copy} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="relay-copy-button"><Copy className="w-4 h-4" />Copy transcript</button>
      <button type="button" onClick={onClose} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="relay-new-call-button">New text call</button>
    </div>
  );
}

function TextSize({ resize }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Text size">
      <button type="button" onClick={() => resize(-1)} className="civr-btn civr-btn-ghost civr-btn-sm !px-2" aria-label="Smaller text" data-testid="relay-text-smaller"><Minus className="w-4 h-4" /></button>
      <span className="text-xs text-[#a1a1aa] w-7 text-center">Aa</span>
      <button type="button" onClick={() => resize(1)} className="civr-btn civr-btn-ghost civr-btn-sm !px-2" aria-label="Bigger text" data-testid="relay-text-bigger"><Plus className="w-4 h-4" /></button>
    </div>
  );
}

export function LiveCall({ id, onClose }) {
  const [call, setCall] = useRelayCall(id);
  const flash = useFlash(call);
  const card = useRef(null);
  const [size, setSize] = useState(() => Number(localStorage.getItem(SIZE_KEY) ?? 1));
  const [ending, setEnding] = useState(false);
  const live = call?.status === 'live';
  // When they answer, fit the whole call screen (conversation + typing box) in view.
  useEffect(() => { if (live) card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [live]);
  const resize = (d) => setSize(s => { const n = Math.min(TEXT_SIZES - 1, Math.max(0, s + d)); localStorage.setItem(SIZE_KEY, String(n)); return n; });
  const hang = async () => { setEnding(true); try { const d = await api(`/relay/calls/${id}/hangup`, { method: 'POST', body: {} }); setCall(d.call); } catch (err) { toast.error(err.message); } finally { setEnding(false); } };
  if (!call) return <div className="civr-card p-6"><Spinner label="Connecting…" /></div>;
  const ended = call.status === 'ended';
  return (
    <div ref={card} className="civr-card p-4 md:p-6 space-y-4 civr-rise scroll-mt-20" data-testid="relay-live">
      <div className="flex flex-wrap items-center gap-3">
        <div className="basis-full sm:basis-auto sm:flex-1 min-w-0"><div className="font-mono text-lg truncate" data-testid="relay-to">{call.to}</div><div className="text-xs text-[#a1a1aa]" data-testid="relay-direction">{call.direction === 'inbound' ? `Incoming call to ${call.callerId}` : `from ${call.callerId}`} · {money(call.rate)}/min</div></div>
        <Status call={call} />
        {!ended && <button type="button" onClick={hang} disabled={ending} className="civr-btn civr-btn-danger civr-btn-sm ml-auto sm:ml-0" data-testid="relay-hangup-button"><PhoneOff className="w-4 h-4" />Hang up</button>}
      </div>
      <Transcript call={call} sizeIdx={size} flash={flash} />
      {ended ? <Ended call={call} onClose={onClose} /> : <Composer call={call} extra={<TextSize resize={resize} />} />}
    </div>
  );
}
