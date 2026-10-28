import { Hash, Workflow, Bot, Megaphone, Headphones, Inbox, TrendingUp, LifeBuoy, CalendarCheck, Globe2, Captions, MessageSquareText } from 'lucide-react';

// Top menu + footer: [id, Icon, title, description, target]. Target = platform tab id, or '#anchor'.
export const PRODUCTS = [
  ['numbers', Hash, 'Virtual numbers', 'Local, mobile and toll-free numbers your customers recognise — and pick up.', '#coverage'],
  ['ivr', Workflow, 'Keypad menu (IVR)', 'Press 1 for sales, 2 for support — every caller routed in under a second.', 'ivr'],
  ['ai', Bot, 'AI voice agents', 'Talks with callers in 20 languages, books visits and calls your leads.', 'ai'],
  ['campaigns', Megaphone, 'Quick & Bulk IVR campaigns', 'Call a whole list, watch it live and connect everyone who presses 1.', 'campaigns'],
  ['phone', Headphones, 'Browser phone & SIP', 'Call from any browser tab, or sign in from a softphone or desk phone.', 'phone'],
  ['text', Captions, 'Text-to-voice calls', 'Type and a natural voice speaks for you; read their reply live.', 'text'],
  ['hosted', MessageSquareText, 'Landline to Texting', 'Send and receive texts on the landline number you already have.', 'hosted'],
  ['inbox', Inbox, 'SMS & voicemail inbox', 'Every text and transcribed voicemail in one inbox.', 'sms'],
];

export const USE_CASES = [
  ['sales', TrendingUp, 'Sales & lead follow-up', 'Bulk IVR calls your list and connects the hot leads to you.', 'campaigns'],
  ['support', LifeBuoy, 'Customer support', 'A keypad menu routes every caller; voicemail catches the rest.', 'ivr'],
  ['bookings', CalendarCheck, 'Appointments & bookings', 'An AI voice agent answers around the clock and books the slot.', 'ai'],
  ['global', Globe2, 'Local presence abroad', 'A local number in each market, all in one account.', '#coverage'],
  ['access', Captions, 'Accessible calling', 'Text calls for deaf and hard-of-hearing callers.', 'text'],
];

// Opens a platform tab (or scrolls to an anchor). Off the landing page the link's own href takes over.
export function goTo(target, e) {
  const anchor = target.startsWith('#') ? target.slice(1) : 'features';
  const el = document.getElementById(anchor);
  if (!el) return;
  e?.preventDefault();
  if (!target.startsWith('#')) window.dispatchEvent(new CustomEvent('civr-platform-tab', { detail: target }));
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export const hrefOf = (base, target) => `${base}${target.startsWith('#') ? target : `#features-${target}`}`;
