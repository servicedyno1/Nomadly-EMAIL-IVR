import { Hash, Workflow, Bot, Megaphone, Headphones, Inbox, TrendingUp, LifeBuoy, CalendarCheck, Globe2, Captions, MessageSquareText, Smartphone, ShieldCheck, Printer, Plane, ScanSearch } from 'lucide-react';

// Top menu + footer: [id, Icon, title, description, target]. Target = platform tab id, or '#anchor'.
export const PRODUCTS = [
  ['numbers', Hash, 'Business numbers', 'USA, Canada or UK included with every plan; more countries as extras.', '#coverage'],
  ['ivr', Workflow, 'Keypad menu (IVR)', 'Press 1 for sales, 2 for support — every caller routed in under a second.', 'ivr'],
  ['ai', Bot, 'AI receptionist & agents', 'Answers calls 24/7, books visits and calls your leads. $0.10 a minute.', 'ai'],
  ['campaigns', Megaphone, 'Quick & Bulk IVR campaigns', 'Call a whole list, watch it live and connect everyone who presses 1.', 'campaigns'],
  ['phone', Headphones, 'Browser phone & SIP', 'Call from any browser tab, or sign in from a softphone or desk phone.', 'phone'],
  ['text', Captions, 'Text-to-voice calls', 'Type and a natural voice speaks for you; read their reply live.', 'text'],
  ['inbox', Inbox, 'Voicemail inbox', 'Every voicemail transcribed, in the app and in your email.', 'voicemail'],
  ['mobile', MessageSquareText, 'USA Texting Number', 'Unlimited texts on a real USA carrier number, $50 a month.', '#product-usa-texting'],
  ['tendlc', ShieldCheck, 'USA 10DLC registration', 'Register your brand to text USA customers. $49 once.', '#product-ten-dlc'],
  ['intl', Globe2, 'Texting in more countries', 'Two-way texts and calls on numbers outside the USA.', '#product-intl-texting'],
  ['hosted', MessageSquareText, 'Landline to Texting (soon)', 'Texts on the landline number you already have — coming soon.', 'hosted'],
  ['fax', Printer, 'Fax number', 'Send and receive faxes online, $50 a month with 25 free pages.', '#product-fax'],
  ['esim', Smartphone, 'USA eSIM', 'A downloadable USA line on your own phone, installed with a QR code.', '#esim-card'],
  ['travel', Plane, 'Travel eSIM', 'Mobile data in 187 countries.', '#product-travel-esim'],
  ['lookup', ScanSearch, 'Number & email lookup', 'Check numbers ($0.015) and emails ($0.0015), one at a time or 1,000 at once.', '#product-lookup'],
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
