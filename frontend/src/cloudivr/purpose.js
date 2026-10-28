import { TrendingUp, LifeBuoy, CalendarCheck, MessageSquareText, Captions, Sparkles } from 'lucide-react';

// Onboarding purposes → what the app puts first for them ([label, app path]).
export const PURPOSES = [
  ['sales', TrendingUp, 'Sales & lead calling', 'Call lists, connect the hot leads', [['Start a Bulk IVR campaign', '/app/campaigns/new'], ['Quick IVR call', '/app/quick-call'], ['Import contacts', '/app/contacts']]],
  ['support', LifeBuoy, 'Customer support line', 'Menus, forwarding, voicemail', [['Buy a number', '/app/buy'], ['Watch calls live', '/app/live'], ['Read your inbox', '/app/inbox']]],
  ['bookings', CalendarCheck, 'Appointments & bookings', 'An AI agent answers 24/7', [['Set up an AI voice agent', '/app/ai-agents'], ['Buy a number', '/app/buy'], ['Read your inbox', '/app/inbox']]],
  ['texting', MessageSquareText, 'Business texting', 'Text from your number or landline', [['Landline to Texting', '/app/texting'], ['Read your inbox', '/app/inbox'], ['Buy a number', '/app/buy']]],
  ['accessible', Captions, 'Type-to-talk calls', 'Type; a voice speaks for you', [['Make a text-to-voice call', '/app/text-call'], ['Buy a number', '/app/buy'], ['Contacts', '/app/contacts']]],
  ['other', Sparkles, 'Something else', 'Explore everything', [['Buy a number', '/app/buy'], ['Watch calls live', '/app/live'], ['Help center', '/app/help']]],
];

// Up to 3 unique suggestions across the picked purposes.
export function suggestionsFor(ids) {
  const seen = new Set();
  return PURPOSES.filter(p => (ids || []).includes(p[0])).flatMap(p => p[4]).filter(([, to]) => !seen.has(to) && seen.add(to)).slice(0, 3);
}
