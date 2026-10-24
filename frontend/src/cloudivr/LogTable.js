import React, { useState } from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail, MessageSquare, Mic, Printer, Clock } from 'lucide-react';
import { when, secs } from './api';
import { usePrivacy } from './privacy';
import { NoteCell, canNote } from './CallNote';
import { QuickReply, TextBackButton, TextBackDone, useTextBack } from './QuickReply';

const LABEL = {
  missed: ['Missed call', PhoneMissed, '#fb7185'], voicemail: ['Voicemail', Voicemail, '#a78bfa'], forwarded: ['Forwarded call', PhoneIncoming, '#34d399'],
  forward_failed: ['Forward failed', PhoneMissed, '#fbbf24'], call_recording: ['Recorded call', Mic, '#38bdf8'], outbound_ivr: ['Quick IVR call', PhoneOutgoing, '#38bdf8'],
  outbound_ivr_bulk: ['Campaign call', PhoneOutgoing, '#22d3ee'], ivr_transfer_leg: ['IVR transfer', PhoneIncoming, '#34d399'], sms: ['SMS', MessageSquare, '#34d399'],
  fax: ['Fax', Printer, '#888'], outbound_sip: ['Browser / SIP call', PhoneOutgoing, '#38bdf8'], BulkIVR: ['Campaign charge', PhoneOutgoing, '#888'],
  off_hours: ['Call outside hours', Clock, '#fbbf24'], sms_out: ['SMS sent', MessageSquare, '#38bdf8'],
};
const labelOf = (t) => LABEL[t] || [String(t || 'Event').replace(/_/g, ' '), PhoneIncoming, '#888'];
const TRANSCRIPT_HINT = { empty: 'No speech detected', failed: 'Couldn’t transcribe this message', too_large: 'Too long to transcribe' };

function Transcript({ l, i, testid }) {
  const pv = usePrivacy();
  if (l.transcript) return <p className="mt-1.5 text-[#e4e4e7] italic whitespace-pre-line break-words" data-testid={`${testid}-transcript-${i}`}>{pv.on ? 'Transcript hidden' : `“${l.transcript}”`}</p>;
  const hint = TRANSCRIPT_HINT[l.transcriptStatus];
  return hint ? <p className="mt-1.5 text-[#a1a1aa]" data-testid={`${testid}-transcript-status-${i}`}>{hint}</p> : null;
}

// Missed-call "Text back" in a log row: button / sent reply in the Details cell, reply box as a full-width row below.
function useRowReply(l, onDone) {
  const [open, setOpen] = useState(false);
  const tb = useTextBack(l.id, l.reply, onDone);
  const done = tb.done || l.reply || null;
  return { ...tb, done, open, setOpen, show: !!done || l.canReply };
}

function LogRow({ l, i, cols, showNumber, testid, notePhone, onNotesChange }) {
  const pv = usePrivacy();
  const [name, Icon, color] = labelOf(l.type);
  const r = useRowReply(l, onNotesChange);
  const rid = `${testid}-reply-${l.id}`;
  return (
    <>
      <tr data-testid={`${testid}-row-${i}`}>
        <td><span className="flex items-center gap-2"><Icon className="w-4 h-4" style={{ color }} />{name}</span></td>
        {showNumber && <td className="font-mono text-xs" data-testid={`${testid}-number-${i}`}>{pv.phone(l.phoneNumber)}</td>}
        <td className="font-mono text-xs" data-testid={`${testid}-from-${i}`}>{pv.phone(l.from) || '—'}</td>
        <td className="font-mono text-xs" data-testid={`${testid}-to-${i}`}>{pv.phone(l.forwardTo || l.to) || '—'}</td>
        <td className="font-mono text-xs">{l.duration ? secs(l.duration) : '—'}</td>
        <td className="text-xs max-w-xs">
          {l.body && <span className="text-[#e4e4e7]" data-testid={`${testid}-body-${i}`}>{pv.text(l.body, 'Message hidden')}</span>}
          {l.digit && <span className="civr-pill civr-pill-on ml-1">key {l.digit}</span>}
          {l.recordingUrl && <audio controls preload="none" src={l.recordingUrl} className="h-8 mt-1" data-testid={`${testid}-recording-${i}`} />}
          <Transcript l={l} i={i} testid={testid} />
          {notePhone && r.show && (r.done ? <TextBackDone reply={r.done} testid={`${rid}-done`} /> : <TextBackButton onClick={() => r.setOpen(o => !o)} open={r.open} testid={`${rid}-button`} />)}
          {notePhone && canNote(l) && <NoteCell log={l} phone={notePhone} onSaved={onNotesChange} testid={`${testid}-note-${i}`} />}
        </td>
        <td className="text-xs text-[#a1a1aa] whitespace-nowrap">{when(l.timestamp)}</td>
      </tr>
      {notePhone && r.open && !r.done && <tr><td colSpan={cols}><div className="sticky left-0 w-[min(36rem,calc(100vw-5rem))]"><QuickReply onSend={r.send} busy={r.busy} testid={rid} /></div></td></tr>}
    </>
  );
}

// `notePhone` (the number the rows belong to) turns on per-row call notes + missed-call "Text back"; `onNotesChange` reloads the rows.
export function LogTable({ logs, showNumber = false, testid = 'log-table', notePhone, onNotesChange }) {
  if (!logs?.length) return <div className="text-sm text-[#a1a1aa] py-8 text-center" data-testid={`${testid}-empty`}>No activity yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="civr-table" data-testid={testid}>
        <thead><tr><th>Event</th>{showNumber && <th>Number</th>}<th>From</th><th>To</th><th>Length</th><th>Details</th><th>When</th></tr></thead>
        <tbody>
          {logs.map((l, i) => <LogRow key={l.id} l={l} i={i} cols={showNumber ? 7 : 6} showNumber={showNumber} testid={testid} notePhone={notePhone} onNotesChange={onNotesChange} />)}
        </tbody>
      </table>
    </div>
  );
}
