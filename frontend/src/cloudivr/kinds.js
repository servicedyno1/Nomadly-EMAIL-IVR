import React from 'react';
import { Phone, MessageSquare, Printer } from 'lucide-react';

// The three kinds of number we sell. Everything (buying, My numbers, the bots) is grouped by these.
export const CAPS = { calls: [Phone, 'Calls'], texts: [MessageSquare, 'Texts'], fax: [Printer, 'Fax'] };
export const KINDS = [
  { id: 'calls', Icon: Phone, title: 'Calls', name: 'Calling number', caps: ['calls'], pitch: 'Answer in your browser or forward to your phone. Menus, voicemail and AI on bigger plans.', note: 'Texting can be switched on later on numbers that support it.' },
  { id: 'texting', Icon: MessageSquare, title: 'Calls + texting', name: 'Calls + texting number', caps: ['calls', 'texts'], pitch: 'Two-way texts and calls on one number. USA with unlimited texts, other countries pay per text.', note: 'Texts arrive in Messages.' },
  { id: 'fax', Icon: Printer, title: 'Fax only', name: 'Fax number', caps: ['fax'], pitch: 'Send and receive faxes online. Faxes arrive as PDFs in the app and by email.', note: 'It can’t take calls or texts.' },
];
export const kindById = (id) => KINDS.find(k => k.id === id) || null;
// Old ?purpose= values (voice, sip, sms) still open the right kind.
export const kindOfPurpose = (p) => { const x = String(p || '').split(',')[0]; return { voice: 'calls', sip: 'calls', calls: 'calls', sms: 'texting', texting: 'texting', fax: 'fax' }[x] || null; };

export function CapBadges({ caps, testid, className = '' }) {
  return (
    <span className={`inline-flex flex-wrap gap-1.5 ${className}`} data-testid={testid}>
      {caps.map(c => { const [Icon, label] = CAPS[c]; return <span key={c} className="civr-pill civr-pill-on inline-flex items-center gap-1 whitespace-nowrap" data-testid={testid ? `${testid}-${c}` : undefined}><Icon className="w-3 h-3" />{label}</span>; })}
    </span>
  );
}
