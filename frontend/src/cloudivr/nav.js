import { Gauge, Hash, ShoppingCart, PhoneOutgoing, Megaphone, Music, Wallet, Settings, KeyRound, Bot, Captions, BookOpen, Contact, Radio, Ban, MessageSquareText, Smartphone, MessagesSquare } from 'lucide-react';
import { cp } from './paths';

// Grouped app navigation by daily use: [group, [[path, label, Icon, testid], …]]. Alerts live behind the top-bar bell.
export const NAV = [
  ['Home', [['', 'Overview', Gauge, 'nav-dashboard'], ['messages', 'Messages', MessagesSquare, 'nav-messages'], ['live', 'Live', Radio, 'nav-live']]],
  ['Numbers', [['numbers', 'My numbers', Hash, 'nav-numbers'], ['buy', 'Buy a number', ShoppingCart, 'nav-buy'], ['esim', 'CloudIVR eSIM', Smartphone, 'nav-esim'], ['texting', 'Landline to Texting', MessageSquareText, 'nav-texting'], ['sip', 'SIP & softphones', KeyRound, 'nav-sip']]],
  ['Calling', [['contacts', 'Contacts', Contact, 'nav-contacts'], ['quick-call', 'Quick IVR call', PhoneOutgoing, 'nav-quick-call'], ['text-call', 'Text-to-voice calls', Captions, 'nav-text-call'], ['campaigns', 'Bulk IVR campaigns', Megaphone, 'nav-campaigns'], ['ai-agents', 'AI voice agents', Bot, 'nav-ai-agents'], ['audio', 'Audio library', Music, 'nav-audio'], ['do-not-call', 'Do-not-call list', Ban, 'nav-dnc']]],
  ['Account', [['wallet', 'Wallet', Wallet, 'nav-wallet'], ['settings', 'Settings', Settings, 'nav-settings'], ['help', 'Help center', BookOpen, 'nav-help']]],
];

export const NAV_ITEMS = NAV.flatMap(([, items]) => items);
export const appPath = (to) => cp(to ? `/app/${to}` : '/app');
