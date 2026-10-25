import React, { useState } from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail, MessageSquare, Mic, Printer, Clock } from 'lucide-react';
import { when, secs } from './api';
import { usePrivacy } from './privacy';
import { NoteCell, canNote } from './CallNote';
import { QuickReply, TextBackButton, TextBackDone, useTextBack } from './QuickReply';
import { ShowMore, useIsPhone, usePaged } from './ui';

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

// Message text, pressed key, recording, transcript, text-back and note for one log entry.
function Details({ l, i, testid, notePhone, onNotesChange, r, rid }) {
  const pv = usePrivacy();
  return (
    <>
      {l.body && <span className="text-[#e4e4e7] break-words" data-testid={`${testid}-body-${i}`}>{pv.text(l.body, 'Message hidden')}</span>}
      {l.digit && <span className="civr-pill civr-pill-on ml-1">key {l.digit}</span>}
      {l.recordingUrl && <audio controls preload="none" src={l.recordingUrl} className="h-8 mt-1 max-w-full" data-testid={`${testid}-recording-${i}`} />}
      <Transcript l={l} i={i} testid={testid} />
      {notePhone && r.show && (r.done ? <TextBackDone reply={r.done} testid={`${rid}-done`} /> : <TextBackButton onClick={() => r.setOpen(o => !o)} open={r.open} testid={`${rid}-button`} />)}
      {notePhone && canNote(l) && <NoteCell log={l} phone={notePhone} onSaved={onNotesChange} testid={`${testid}-note-${i}`} />}
    </>
  );
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
        <td className="text-xs max-w-xs"><Details l={l} i={i} testid={testid} notePhone={notePhone} onNotesChange={onNotesChange} r={r} rid={rid} /></td>
        <td className="text-xs text-[#a1a1aa] whitespace-nowrap">{when(l.timestamp)}</td>
      </tr>
      {notePhone && r.open && !r.done && <tr><td colSpan={cols}><div className="sticky left-0 w-[min(36rem,calc(100vw-5rem))]"><QuickReply onSend={r.send} busy={r.busy} testid={rid} /></div></td></tr>}
    </>
  );
}

// Phones: one stacked card per entry — nothing scrolls sideways.
function LogCard({ l, i, showNumber, testid, notePhone, onNotesChange }) {
  const pv = usePrivacy();
  const [name, Icon, color] = labelOf(l.type);
  const r = useRowReply(l, onNotesChange);
  const rid = `${testid}-reply-${l.id}`;
  const cell = (k, v, id) => <><span className="text-[#a1a1aa]">{k}</span><span className="font-mono text-[#e4e4e7] break-all" data-testid={id}>{v}</span></>;
  return (
    <li className="py-4 first:pt-0 last:pb-0" data-testid={`${testid}-row-${i}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#f3f4f6]"><Icon className="w-4 h-4 shrink-0" style={{ color }} />{name}</span>
        <span className="text-xs text-[#a1a1aa] whitespace-nowrap pt-0.5">{when(l.timestamp)}</span>
      </div>
      <div className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
        {showNumber && cell('Number', pv.phone(l.phoneNumber), `${testid}-number-${i}`)}
        {cell('From', pv.phone(l.from) || '—', `${testid}-from-${i}`)}
        {cell('To', pv.phone(l.forwardTo || l.to) || '—', `${testid}-to-${i}`)}
        {l.duration ? cell('Length', secs(l.duration)) : null}
      </div>
      <div className="text-xs mt-1.5 flex flex-col items-start gap-1"><Details l={l} i={i} testid={testid} notePhone={notePhone} onNotesChange={onNotesChange} r={r} rid={rid} /></div>
      {notePhone && r.open && !r.done && <div className="mt-3"><QuickReply onSend={r.send} busy={r.busy} testid={rid} /></div>}
    </li>
  );
}

// `notePhone` (the number the rows belong to) turns on per-row call notes + missed-call "Text back"; `onNotesChange` reloads the rows.
export function LogTable({ logs, showNumber = false, testid = 'log-table', notePhone, onNotesChange, pageSize = 20, resetKey }) {
  const phone = useIsPhone();
  const { shown, rest, more } = usePaged(logs, pageSize, resetKey);
  if (!logs?.length) return <div className="text-sm text-[#a1a1aa] py-8 text-center" data-testid={`${testid}-empty`}>No activity yet.</div>;
  const common = { showNumber, testid, notePhone, onNotesChange };
  return (
    <>
      {phone ? (
        <ul className="divide-y divide-[#1f1f1f]" data-testid={testid}>{shown.map((l, i) => <LogCard key={l.id} l={l} i={i} {...common} />)}</ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="civr-table" data-testid={testid}>
            <thead><tr><th>Event</th>{showNumber && <th>Number</th>}<th>From</th><th>To</th><th>Length</th><th>Details</th><th>When</th></tr></thead>
            <tbody>{shown.map((l, i) => <LogRow key={l.id} l={l} i={i} cols={showNumber ? 7 : 6} {...common} />)}</tbody>
          </table>
        </div>
      )}
      <ShowMore rest={rest} onClick={more} testid={`${testid}-show-more`} />
    </>
  );
}
