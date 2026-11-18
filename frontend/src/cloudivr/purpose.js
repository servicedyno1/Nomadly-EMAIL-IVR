import { TrendingUp, LifeBuoy, CalendarCheck, MessageSquareText, Captions, Sparkles, PhoneCall, Plane, Bot, Megaphone, Printer } from 'lucide-react';

// Onboarding "What do you need?" → what the app puts first for them ([label, app path]).
export const PURPOSES = [
  ['line', PhoneCall, 'Business phone line', 'Calls, forwarding, voicemail, softphone', [['Get a Business Line', '/app/buy?purpose=voice'], ['Set up call forwarding', '/app/answer/forwarding'], ['Connect a softphone', '/app/sip']]],
  ['texting', MessageSquareText, 'Text customers', 'Two-way texts and calls on one number', [['Get a Calls + texting number', '/app/buy?purpose=texting'], ['USA number with unlimited texts', '/app/buy?purpose=texting&country=US'], ['Read your messages', '/app/messages']]],
  ['travel', Plane, 'Travel eSIM', 'Mobile data in 187 countries', [['Find a travel eSIM', '/app/travel-esim'], ['USA eSIM', '/app/esim'], ['Help center', '/app/help']]],
  ['ai', Bot, 'AI receptionist', 'Answers your calls 24/7', [['Set up an AI receptionist', '/app/receptionist'], ['Get a Business Line', '/app/buy?purpose=voice'], ['Read your messages', '/app/messages']]],
  ['bulk', Megaphone, 'Bulk calls & campaigns', 'Call lists, press-1, voicemail drops', [['Start a Bulk IVR campaign', '/app/campaigns/new'], ['Quick IVR call', '/app/quick-call'], ['Import contacts', '/app/contacts']]],
  ['fax', Printer, 'Fax', 'Send and receive faxes online', [['Get a fax number', '/app/buy?purpose=fax'], ['Send a fax', '/app/fax'], ['Help center', '/app/help']]],
  ['other', Sparkles, 'Something else', 'Explore everything', [['Get a Business Line', '/app/buy?purpose=voice'], ['Watch calls live', '/app/live'], ['Help center', '/app/help']]],
];
// Older onboarding answers still map to suggestions.
const LEGACY = [
  ['sales', TrendingUp, '', '', [['Start a Bulk IVR campaign', '/app/campaigns/new'], ['Quick IVR call', '/app/quick-call'], ['Import contacts', '/app/contacts']]],
  ['support', LifeBuoy, '', '', [['Get a Business Line', '/app/buy?purpose=voice'], ['Watch calls live', '/app/live'], ['Read your messages', '/app/messages']]],
  ['bookings', CalendarCheck, '', '', [['Set up an AI receptionist', '/app/receptionist/new'], ['Get a Business Line', '/app/buy?purpose=voice'], ['Read your messages', '/app/messages']]],
  ['accessible', Captions, '', '', [['Make a text-to-voice call', '/app/text-call'], ['Get a Business Line', '/app/buy?purpose=voice'], ['Contacts', '/app/contacts']]],
];

// Up to 3 unique suggestions, taking turns across the picked purposes.
export function suggestionsFor(ids) {
  const lists = [...PURPOSES, ...LEGACY].filter(p => (ids || []).includes(p[0])).map(p => p[4]);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < 3; i += 1) lists.forEach(l => { if (l[i] && out.length < 3 && !seen.has(l[i][1])) { seen.add(l[i][1]); out.push(l[i]); } });
  return out;
}
