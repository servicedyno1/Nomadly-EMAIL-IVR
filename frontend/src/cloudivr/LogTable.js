import React from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail, MessageSquare, Mic, Printer, Clock } from 'lucide-react';
import { when, secs } from './api';
import { usePrivacy } from './privacy';
import { NoteCell, canNote } from './CallNote';

const LABEL = {
  missed: ['Missed call', PhoneMissed, '#fb7185'], voicemail: ['Voicemail', Voicemail, '#a78bfa'], forwarded: ['Forwarded call', PhoneIncoming, '#34d399'],
  forward_failed: ['Forward failed', PhoneMissed, '#fbbf24'], call_recording: ['Recorded call', Mic, '#38bdf8'], outbound_ivr: ['Quick IVR call', PhoneOutgoing, '#38bdf8'],
  outbound_ivr_bulk: ['Campaign call', PhoneOutgoing, '#22d3ee'], ivr_transfer_leg: ['IVR transfer', PhoneIncoming, '#34d399'], sms: ['SMS', MessageSquare, '#34d399'],
  fax: ['Fax', Printer, '#888'], outbound_sip: ['Browser / SIP call', PhoneOutgoing, '#38bdf8'], BulkIVR: ['Campaign charge', PhoneOutgoing, '#888'],
  off_hours: ['Call outside hours', Clock, '#fbbf24'],
};
const labelOf = (t) => LABEL[t] || [String(t || 'Event').replace(/_/g, ' '), PhoneIncoming, '#888'];
const TRANSCRIPT_HINT = { empty: 'No speech detected', failed: 'Couldn’t transcribe this message', too_large: 'Too long to transcribe' };

function Transcript({ l, i, testid }) {
  const pv = usePrivacy();
  if (l.transcript) return <p className="mt-1.5 text-[#ccc] italic whitespace-pre-line break-words" data-testid={`${testid}-transcript-${i}`}>{pv.on ? 'Transcript hidden' : `“${l.transcript}”`}</p>;
  const hint = TRANSCRIPT_HINT[l.transcriptStatus];
  return hint ? <p className="mt-1.5 text-[#8a8a8a]" data-testid={`${testid}-transcript-status-${i}`}>{hint}</p> : null;
}

// `notePhone` (the number the rows belong to) turns on per-row call notes; `onNotesChange` reloads the rows.
export function LogTable({ logs, showNumber = false, testid = 'log-table', notePhone, onNotesChange }) {
  const pv = usePrivacy();
  if (!logs?.length) return <div className="text-sm text-[#8a8a8a] py-8 text-center" data-testid={`${testid}-empty`}>No activity yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="civr-table" data-testid={testid}>
        <thead><tr><th>Event</th>{showNumber && <th>Number</th>}<th>From</th><th>To</th><th>Length</th><th>Details</th><th>When</th></tr></thead>
        <tbody>
          {logs.map((l, i) => {
            const [name, Icon, color] = labelOf(l.type);
            return (
              <tr key={l.id} data-testid={`${testid}-row-${i}`}>
                <td><span className="flex items-center gap-2"><Icon className="w-4 h-4" style={{ color }} />{name}</span></td>
                {showNumber && <td className="font-mono text-xs" data-testid={`${testid}-number-${i}`}>{pv.phone(l.phoneNumber)}</td>}
                <td className="font-mono text-xs" data-testid={`${testid}-from-${i}`}>{pv.phone(l.from) || '—'}</td>
                <td className="font-mono text-xs" data-testid={`${testid}-to-${i}`}>{pv.phone(l.forwardTo || l.to) || '—'}</td>
                <td className="font-mono text-xs">{l.duration ? secs(l.duration) : '—'}</td>
                <td className="text-xs max-w-xs">
                  {l.body && <span className="text-[#ccc]" data-testid={`${testid}-body-${i}`}>{pv.text(l.body, 'Message hidden')}</span>}
                  {l.digit && <span className="civr-pill civr-pill-on ml-1">key {l.digit}</span>}
                  {l.recordingUrl && <audio controls preload="none" src={l.recordingUrl} className="h-8 mt-1" data-testid={`${testid}-recording-${i}`} />}
                  <Transcript l={l} i={i} testid={testid} />
                  {notePhone && canNote(l) && <NoteCell log={l} phone={notePhone} onSaved={onNotesChange} testid={`${testid}-note-${i}`} />}
                </td>
                <td className="text-xs text-[#888] whitespace-nowrap">{when(l.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
