import { Gauge, Hash, ShoppingCart, PhoneOutgoing, Megaphone, Music, Wallet, Settings, Inbox, KeyRound, Bot, Captions, BookOpen, Contact, Radio, Ban } from 'lucide-react';
import { cp } from './paths';

// Grouped app navigation: [group, [[path, label, Icon, testid], …]].
export const NAV = [
  ['Numbers', [['', 'Overview', Gauge, 'nav-dashboard'], ['numbers', 'My numbers', Hash, 'nav-numbers'], ['sip', 'SIP & softphones', KeyRound, 'nav-sip'], ['buy', 'Buy a number', ShoppingCart, 'nav-buy']]],
  ['Calling', [['live', 'Live', Radio, 'nav-live'], ['contacts', 'Contacts', Contact, 'nav-contacts'], ['quick-call', 'Quick IVR call', PhoneOutgoing, 'nav-quick-call'], ['text-call', 'Text calls', Captions, 'nav-text-call'], ['ai-agents', 'AI voice agents', Bot, 'nav-ai-agents'], ['campaigns', 'Bulk IVR campaigns', Megaphone, 'nav-campaigns'], ['do-not-call', 'Do-not-call list', Ban, 'nav-dnc'], ['audio', 'Audio library', Music, 'nav-audio']]],
  ['Account', [['inbox', 'Inbox', Inbox, 'nav-inbox'], ['wallet', 'Wallet', Wallet, 'nav-wallet'], ['settings', 'Settings', Settings, 'nav-settings'], ['help', 'Help center', BookOpen, 'nav-help']]],
];

export const NAV_ITEMS = NAV.flatMap(([, items]) => items);
export const appPath = (to) => cp(to ? `/app/${to}` : '/app');
