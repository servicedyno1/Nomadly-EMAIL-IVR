import { Gauge, Hash, ShoppingCart, PhoneOutgoing, Megaphone, Music, Wallet, Settings, KeyRound, Bot, Captions, BookOpen, Contact, Radio, Ban, MessageSquareText, Smartphone, MessagesSquare } from 'lucide-react';
import { cp } from './paths';

// Sidebar links: [path, label, Icon, testid, tabs?, alsoMatches?]; tabs: [path, label, Icon, testid]. Alerts live behind the top-bar bell.
export const NAV = [
  ['Home', [['', 'Overview', Gauge, 'nav-dashboard'], ['messages', 'Messages', MessagesSquare, 'nav-messages'], ['live', 'Live', Radio, 'nav-live']]],
  ['Numbers', [['numbers', 'Numbers', Hash, 'nav-numbers', [
    ['numbers', 'My numbers', Hash, 'tab-numbers'], ['buy', 'Buy a number', ShoppingCart, 'tab-buy'], ['esim', 'eSIM & mobile numbers', Smartphone, 'tab-esim'],
    ['texting', 'Landline to Texting', MessageSquareText, 'tab-texting'], ['sip', 'SIP & softphones', KeyRound, 'tab-sip'],
  ], ['orders', 'verification']]]],
  ['Calling', [
    ['quick-call', 'Calls', PhoneOutgoing, 'nav-calls', [['quick-call', 'Quick IVR call', PhoneOutgoing, 'tab-quick-call'], ['text-call', 'Text-to-voice calls', Captions, 'tab-text-call']]],
    ['campaigns', 'Campaigns', Megaphone, 'nav-campaigns', [['campaigns', 'Bulk IVR campaigns', Megaphone, 'tab-campaigns'], ['do-not-call', 'Do-not-call list', Ban, 'tab-dnc']]],
    ['contacts', 'Contacts', Contact, 'nav-contacts'], ['ai-agents', 'AI voice agents', Bot, 'nav-ai-agents'], ['audio', 'Audio library', Music, 'nav-audio'],
  ]],
  ['Account', [['wallet', 'Wallet', Wallet, 'nav-wallet'], ['settings', 'Settings', Settings, 'nav-settings'], ['help', 'Help center', BookOpen, 'nav-help']]],
];

export const SIDE_ITEMS = NAV.flatMap(([, items]) => items);
// Every page (sidebar links + tabs), used for search and page titles.
export const NAV_ITEMS = SIDE_ITEMS.flatMap((it) => (it[4] ? it[4] : [it]));
export const appPath = (to) => cp(to ? `/app/${to}` : '/app');

const under = (pathname, to) => { const p = appPath(to); return pathname === p || pathname.startsWith(`${p}/`); };
export const sectionOf = (pathname) => SIDE_ITEMS.find(([, , , , tabs, also = []]) => tabs && [...tabs.map(t => t[0]), ...also].some(to => under(pathname, to)));
export const isSideActive = (item, pathname) => (item[4] ? sectionOf(pathname) === item : (item[0] === '' ? pathname === appPath('') : under(pathname, item[0])));
