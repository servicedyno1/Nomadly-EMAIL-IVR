import { Home, Hash, PlusCircle, PhoneOutgoing, Megaphone, Music, Wallet, Settings, KeyRound, Captions, BookOpen, Contact, Radio, Ban, MessageSquareText, Smartphone, MessagesSquare, Printer, Workflow, PhoneForwarded, Headphones, BotMessageSquare, Bot, ScanSearch, Plane, Bell, CalendarDays, BarChart3 } from 'lucide-react';
import { cp } from './paths';

// Six areas. Group → [id, label, items]; item → [path, label, Icon, testid, subtitle?].
// Paths are unchanged so every bookmark and emailed link still works. '#phone' opens the browser phone.
export const NAV = [
  ['home', '', [['', 'Home', Home, 'nav-dashboard'], ['messages', 'Inbox', MessagesSquare, 'nav-messages']]],
  ['numbers', 'Numbers', [['numbers', 'My numbers', Hash, 'nav-numbers'], ['buy', 'Get a number', PlusCircle, 'nav-buy'], ['esim', 'eSIM', Smartphone, 'nav-esim'], ['fax', 'Fax', Printer, 'nav-fax']]],
  ['calls', 'Calls & campaigns', [['quick-call', 'Make a call', PhoneOutgoing, 'nav-calls'], ['campaigns', 'Campaigns', Megaphone, 'nav-campaigns'], ['contacts', 'Contacts & audio', Contact, 'nav-contacts'], ['#phone', 'Browser phone', Headphones, 'nav-browser-phone']]],
  ['ai', 'AI', [['receptionist', 'AI receptionist', BotMessageSquare, 'nav-ai']]],
  ['account', 'Account', [['wallet', 'Wallet & billing', Wallet, 'nav-wallet'], ['settings', 'Settings', Settings, 'nav-settings'], ['help', 'Help center', BookOpen, 'nav-help']]],
];

// Pages that share one menu entry, shown as tabs at the top of each of them. Menu id → [[path, label, Icon]].
export const HUBS = {
  'nav-messages': [['messages', 'Messages', MessagesSquare], ['inbox', 'Notifications', Bell]],
  'nav-numbers': [['numbers', 'My numbers', Hash], ['answer/forwarding', 'Answering rules', PhoneForwarded], ['answer/ivr', 'Phone menus (IVR)', Workflow], ['sip', 'SIP logins', KeyRound], ['lookup', 'Lookup & verify', ScanSearch]],
  'nav-esim': [['esim', 'USA eSIM', Smartphone], ['travel-esim', 'Travel eSIM', Plane]],
  'nav-fax': [['fax', 'Send & receive fax', Printer], ['texting', 'Landline texting', MessageSquareText]],
  'nav-calls': [['quick-call', 'Quick call', PhoneOutgoing], ['text-call', 'Voice message call', Captions]],
  'nav-campaigns': [['campaigns', 'Campaigns', Megaphone], ['ai-agents', 'AI conversations', Bot], ['live', 'Live activity', Radio]],
  'nav-contacts': [['contacts', 'Contacts', Contact], ['audio', 'Audio library', Music], ['do-not-call', 'Do-not-call list', Ban]],
  'nav-wallet': [['wallet', 'Wallet', Wallet], ['usage', 'Usage', BarChart3], ['renewals', 'Renewal calendar', CalendarDays]],
};

export const SIDE_ITEMS = NAV.flatMap(([, , items]) => items);
// Every page (menu entries and their tabs) → [path, label, Icon, id, area]; used for search and page titles.
export const NAV_ITEMS = NAV.flatMap(([, g, items]) => items.filter(it => it[0] !== '#phone').flatMap(it => (HUBS[it[3]] ? HUBS[it[3]].map(([p, l, I]) => [p, l, I, `nav-${p.replace(/\//g, '-')}`, g || 'Home']) : [[...it.slice(0, 4), g || 'Home']])));
export const appPath = (to) => cp(to ? `/app/${to}` : '/app');

const under = (pathname, p) => pathname === p || pathname.startsWith(`${p}/`);
// Old pages that now live under a menu item (orders → Get a number, verification → My numbers).
const ALSO = { buy: ['orders', 'texting-number', 'international-texting'], numbers: ['verification'] };

export function isSideActive(item, pathname) {
  const [to, , , id] = item;
  if (to === '#phone') return false;
  if (to === '') return pathname === appPath('');
  const paths = [to.split('?')[0], ...(ALSO[to] || []), ...(HUBS[id] || []).map(h => h[0])];
  return paths.some(p => under(pathname, appPath(p)));
}
export const isTabActive = (path, pathname) => under(pathname, appPath(path)) || (ALSO[path] || []).some(p => under(pathname, appPath(p)));

// The menu group (and item) the current page belongs to — for breadcrumbs and the page tabs.
export function groupOf(pathname, search) {
  for (const g of NAV) { const it = g[2].find(i => isSideActive(i, pathname, search)); if (it) return [g, it]; }
  return [null, null];
}
