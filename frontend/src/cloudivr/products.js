import { Hash, Workflow, Megaphone, Bot, KeyRound, MessageSquare, Globe, ShieldCheck, Printer, ScanSearch, Captions, Plane, Smartphone, PlusCircle } from 'lucide-react';

// Everything we sell, grouped. Group → [id, title, tone, items]; item → [id, Icon, title, text, price, appPath, soon?].
// Used by the landing "Everything we offer" section and the in-app Home product grid.
export const PRODUCT_GROUPS = [
  ['calling', 'Calling plans', 'blue', [
    ['plan', Hash, 'Calling number + plan', 'A number for calls with every plan: USA, Canada or UK. Business can also pick the Netherlands, France or Spain. Texting is an optional add-on.', 'From $50/mo', 'buy?purpose=calls'],
    ['ivr', Workflow, 'Keypad menu (IVR)', 'Callers press 1 for sales, 2 for support or 3 for voicemail. On Pro and Business.', 'In Pro and up', 'answer/ivr'],
    ['campaigns', Megaphone, 'Quick & Bulk IVR calls', 'Call a list, play your message and connect everyone who presses 1. On Pro and Business.', 'In Pro and up', 'campaigns'],
    ['extra-number', PlusCircle, 'Extra numbers', 'Add numbers in more countries for calls. We only ask for an address or ID when the country needs it.', 'From $25/mo', 'buy?purpose=calls'],
  ]],
  ['ai', 'AI', 'violet', [
    ['receptionist', Bot, 'AI receptionist', 'Answers your calls 24/7, books visits and takes messages in 20 languages.', 'On every plan', 'receptionist'],
    ['text-call', Captions, 'Text-to-voice calls', 'You type, a natural voice speaks, and you read their reply live. On Business.', 'In Business', 'text-call'],
  ]],
  ['texting', 'Calls + texting', 'green', [
    ['usa-texting', MessageSquare, 'USA Texting Number', 'A real USA carrier number with unlimited texts, read and answered in your browser.', '$50/mo, unlimited texts', 'buy?purpose=texting&country=US'],
    ['ten-dlc', ShieldCheck, 'USA 10DLC registration', 'Register your brand to text USA customers at scale. Refunded if it is rejected.', '$49 once + carrier fees', 'texting'],
    ['intl-texting', Globe, 'Texting in more countries', 'Two-way texts and calls on one number outside the USA. No ID needed.', 'From $50/mo + per text sent', 'buy?purpose=texting'],
  ]],
  ['fax', 'Fax only', 'rose', [
    ['fax', Printer, 'Fax number', 'Send and receive faxes online in 29 countries. 25 free pages a month, then $0.05 a page.', '$50/mo', 'buy?purpose=fax'],
  ]],
  ['connect', 'Phones, data & tools', 'teal', [
    ['sip', KeyRound, 'Softphone logins (SIP)', 'Use desk phones and softphone apps on every plan. Pro gets 2 logins free, Business 5.', '$5/mo per extra login', 'sip'],
    ['travel-esim', Plane, 'Travel eSIM', 'Mobile data in 187 countries, installed with a QR code.', 'Priced per country', 'travel-esim'],
    ['usa-esim', Smartphone, 'USA eSIM', 'A downloadable USA line on a real carrier for your own phone.', 'Monthly', 'esim'],
    ['lookup', ScanSearch, 'Number & email lookup', 'Check numbers (carrier, line type, country) and emails (deliverable or risky), one at a time or 1,000 at once.', '$0.015 per number · $0.0015 per email', 'lookup'],
  ]],
];

export const ALL_PRODUCTS = PRODUCT_GROUPS.flatMap(([gid, , tone, items]) => items.map(it => [...it, gid, tone]));
