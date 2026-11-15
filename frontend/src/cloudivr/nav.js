import { Home, Hash, PlusCircle, PhoneOutgoing, Megaphone, Music, Wallet, Settings, KeyRound, Bot, Captions, BookOpen, Contact, Radio, Ban, MessageSquareText, MessageSquare, Smartphone, MessagesSquare, Printer, Workflow, PhoneForwarded, Headphones, BotMessageSquare, Globe, ScanSearch, Plane } from 'lucide-react';
import { cp } from './paths';

// Job-based menu. Group → [id, label, items]; item → [path, label, Icon, testid, subtitle?].
// Paths are unchanged from the old menu so every bookmark and emailed link still works.
// A path of '#phone' opens the browser phone instead of a page.
export const NAV = [
  ['home', '', [['', 'Home', Home, 'nav-dashboard'], ['messages', 'Messages', MessagesSquare, 'nav-messages'], ['live', 'Live activity', Radio, 'nav-live']]],
  ['numbers', 'Numbers', [['numbers', 'My numbers', Hash, 'nav-numbers'], ['buy', 'Get a number', PlusCircle, 'nav-buy'], ['lookup', 'Number & email lookup', ScanSearch, 'nav-lookup']]],
  ['calls', 'Calling', [
    ['quick-call', 'Quick call', PhoneOutgoing, 'nav-calls'], ['answer/forwarding', 'Call forwarding & voicemail', PhoneForwarded, 'nav-answer-forwarding'], ['answer/ivr', 'Keypad menus', Workflow, 'nav-answer-ivr', 'IVR'],
    ['campaigns', 'Bulk campaigns', Megaphone, 'nav-campaigns', 'IVR'], ['text-call', 'Text-to-voice call', Captions, 'nav-text-call'], ['sip', 'Softphone logins', KeyRound, 'nav-sip', 'SIP'], ['#phone', 'Browser phone', Headphones, 'nav-browser-phone'],
  ]],
  ['ai', 'AI', [['receptionist', 'AI receptionist', BotMessageSquare, 'nav-ai-receptionist'], ['ai-agents', 'AI calling agents', Bot, 'nav-ai-agents']]],
  ['messaging', 'Texting', [
    ['texting-number', 'USA Texting Number', MessageSquare, 'nav-texting-number'], ['international-texting', 'International Texting', Globe, 'nav-international-texting', 'Soon'], ['texting', 'Landline texting', MessageSquareText, 'nav-texting', 'Soon'],
  ]],
  ['more', 'Fax & eSIM', [['fax', 'Fax', Printer, 'nav-fax'], ['travel-esim', 'Travel eSIM', Plane, 'nav-travel-esim'], ['esim', 'USA eSIM', Smartphone, 'nav-esim']]],
  ['tools', 'Tools', [['contacts', 'Contacts', Contact, 'nav-contacts'], ['audio', 'Audio library', Music, 'nav-audio'], ['do-not-call', 'Do-not-call list', Ban, 'nav-dnc']]],
  ['account', 'Account', [['wallet', 'Wallet & billing', Wallet, 'nav-wallet'], ['settings', 'Settings', Settings, 'nav-settings'], ['help', 'Help center', BookOpen, 'nav-help']]],
];

export const SIDE_ITEMS = NAV.flatMap(([, , items]) => items);
// Every page in the menu (used for search and page titles).
export const NAV_ITEMS = SIDE_ITEMS.filter(it => it[0] !== '#phone');
export const appPath = (to) => cp(to ? `/app/${to}` : '/app');

const under = (pathname, p) => pathname === p || pathname.startsWith(`${p}/`);
// Old pages that now live under a menu item (orders → Get a number, verification → My numbers).
const ALSO = { buy: ['orders'], numbers: ['verification'] };

export function isSideActive(item, pathname, search = '') {
  const [to] = item;
  if (to === '#phone') return false;
  if (to === '') return pathname === appPath('');
  const [path] = to.split('?');
  return [path, ...(ALSO[path] || [])].some(p => under(pathname, appPath(p)));
}

// The menu group (and item) the current page belongs to — for breadcrumbs and the phone tab strip.
export function groupOf(pathname, search) {
  for (const g of NAV) { const it = g[2].find(i => isSideActive(i, pathname, search)); if (it) return [g, it]; }
  return [null, null];
}
