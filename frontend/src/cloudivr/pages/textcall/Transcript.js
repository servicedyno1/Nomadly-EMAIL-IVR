import React, { useEffect, useRef } from 'react';
import { Hash, Info } from 'lucide-react';

const SIZES = ['text-base', 'text-lg', 'text-xl', 'text-2xl'];
const NOTES = {
  intro: 'We told them this is a typed call.',
  out_of_funds: 'Your balance ran out, so the call is ending.',
  no_transcription: 'Live text is not available on this call right now.',
};

function Line({ l, size }) {
  if (l.who === 'note') return <div className="flex justify-center"><span className="inline-flex items-center gap-1.5 text-xs text-[#a1a1aa] px-3 py-1 rounded-full border border-white/10" data-testid={`relay-note-${l.n}`}><Info className="w-3 h-3" />{NOTES[l.text] || l.text}</span></div>;
  if (l.who === 'key') return <div className="flex justify-end"><span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#fbbf24] px-3 py-1 rounded-full border border-[#fbbf24]/30" data-testid={`relay-key-${l.n}`}><Hash className="w-3 h-3" />{l.text}</span></div>;
  const me = l.who === 'me';
  return (
    <div className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 leading-snug ${size} ${me ? 'bg-[#34d399] text-[#04130d] rounded-br-md' : 'bg-[#1c1c1f] text-[#f4f4f5] border border-white/10 rounded-bl-md'}`} data-testid={`relay-line-${l.n}`}>
        <div data-no-translate>{l.text}</div>
      </div>
    </div>
  );
}

// The conversation, newest at the bottom; their live words show as a growing grey line.
export function Transcript({ call, sizeIdx, flash }) {
  const box = useRef(null);
  // Scroll only the conversation box (not the page) to the newest words.
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [call.lines.length, call.interim]);
  const size = SIZES[sizeIdx] || SIZES[1];
  return (
    <div ref={box} role="log" aria-live="polite" aria-label="Conversation" className={`h-[36vh] md:h-[40vh] min-h-[240px] overflow-y-auto space-y-3 p-4 md:p-5 rounded-2xl bg-[#0b0b0c] border transition-colors duration-300 ${flash ? 'border-[#34d399] civr-relay-flash' : 'border-white/10'}`} data-testid="relay-transcript">
      {call.lines.map(l => <Line key={l.n} l={l} size={size} />)}
      {call.interim && <div className="flex justify-start"><div className={`max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 border border-dashed border-[#34d399]/50 text-[#d4d4d8] italic ${size}`} data-testid="relay-interim"><span data-no-translate>{call.interim}</span><span className="civr-pulse not-italic text-[#34d399]"> ●</span></div></div>}
      {!call.lines.some(l => l.who === 'them') && !call.interim && call.status === 'live' && <div className="text-center text-sm text-[#a1a1aa] pt-6" data-testid="relay-waiting">Waiting for them to speak…</div>}
    </div>
  );
}

export const TEXT_SIZES = SIZES.length;
