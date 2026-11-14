import { Home, Hash, PlusCircle, PhoneOutgoing, Megaphone, Music, Wallet, Settings, KeyRound, Bot, Captions, BookOpen, Contact, Radio, Ban, MessageSquareText, MessageSquare, Smartphone, MessagesSquare, Printer, Workflow, PhoneForwarded, Headphones, BotMessageSquare, Globe, ScanSearch } from 'lucide-react';
import { cp } from './paths';

// Job-based menu. Group → [id, label, items]; item → [path, label, Icon, testid, subtitle?].
// Paths are unchanged from the old menu so every bookmark and emailed link still works.
// A path of '#phone' opens the browser phone instead of a page.
export const NAV = [
  ['home', 'Home', [
    ['', 'Home', Home, 'nav-dashboard'], ['messages', 'Messages', MessagesSquare, 'nav-messages'], ['live', 'Live activity', Radio, 'nav-live'],
  ]],
  ['numbers', 'Phone numbers', [
    ['numbers', 'My numbers', Hash, 'nav-numbers'], ['buy', 'Get a number', PlusCircle, 'nav-buy'], ['texting-number', 'Texting Number', MessageSquare, 'nav-texting-number'], ['international-texting', 'International Texting', Globe, 'nav-international-texting'], ['esim', 'USA eSIM', Smartphone, 'nav-esim'],
    ['texting', 'Landline texting', MessageSquareText, 'nav-texting', 'Soon'], ['lookup', 'Number lookup', ScanSearch, 'nav-lookup'], ['fax', 'Fax', Printer, 'nav-fax'],
  ]],
  ['answer', 'Answer calls', [
    ['answer/ivr', 'Keypad menus', Workflow, 'nav-answer-ivr', 'IVR'], ['answer/forwarding', 'Call forwarding & voicemail', PhoneForwarded, 'nav-answer-forwarding'],
    ['ai-agents?use=inbound', 'AI receptionist', BotMessageSquare, 'nav-ai-receptionist'],
  ]],
  ['calls', 'Make calls', [
    ['quick-call', 'Quick call', PhoneOutgoing, 'nav-calls'], ['text-call', 'Text-to-voice call', Captions, 'nav-text-call'],
    ['campaigns', 'Bulk campaigns', Megaphone, 'nav-campaigns', 'IVR'], ['ai-agents', 'AI calling agents', Bot, 'nav-ai-agents'], ['do-not-call', 'Do-not-call list', Ban, 'nav-dnc'],
  ]],
  ['media', 'Contacts & media', [['contacts', 'Contacts', Contact, 'nav-contacts'], ['audio', 'Audio library', Music, 'nav-audio']]],
  ['devices', 'Connect devices', [['sip', 'Softphone logins', KeyRound, 'nav-sip', 'SIP'], ['#phone', 'Browser phone', Headphones, 'nav-browser-phone']]],
  ['account', 'Account', [['wallet', 'Wallet & billing', Wallet, 'nav-wallet'], ['settings', 'Settings', Settings, 'nav-settings'], ['help', 'Help center', BookOpen, 'nav-help']]],
];

export const SIDE_ITEMS = NAV.flatMap(([, , items]) => items);
// Every page in the menu (used for search and page titles).
export const NAV_ITEMS = SIDE_ITEMS.filter(it => it[0] !== '#phone');
export const appPath = (to) => cp(to ? `/app/${to}` : '/app');

const under = (pathname, p) => pathname === p || pathname.startsWith(`${p}/`);
const purposeOf = (search) => new URLSearchParams(search || '').get('use');
// Old pages that now live under a menu item (orders → Get a number, verification → My numbers).
const ALSO = { buy: ['orders'], numbers: ['verification'] };

export function isSideActive(item, pathname, search = '') {
  const [to] = item;
  if (to === '#phone') return false;
  if (to === '') return pathname === appPath('');
  const [path, q] = to.split('?');
  if (path === 'ai-agents') {
    if (!under(pathname, appPath('ai-agents'))) return false;
    return q ? purposeOf(search) === 'inbound' : purposeOf(search) !== 'inbound';
  }
  return [path, ...(ALSO[path] || [])].some(p => under(pathname, appPath(p)));
}

// The menu group (and item) the current page belongs to — for breadcrumbs and the phone tab strip.
export function groupOf(pathname, search) {
  for (const g of NAV) { const it = g[2].find(i => isSideActive(i, pathname, search)); if (it) return [g, it]; }
  return [null, null];
}
