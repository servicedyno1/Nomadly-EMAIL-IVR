import { Plane, Rocket, Store, Users, Megaphone, Headphones, Voicemail, Globe2, Wallet, Bot, Workflow, PhoneForwarded, MessageSquareText, Printer, Clock, PhoneCall, Radio, ShieldCheck, ScanSearch, CalendarClock, Smartphone } from 'lucide-react';

// One page per audience (cloudivr.net/for/<slug>). Everything here is plain copy: who it is for, the three
// problems they arrive with, and the parts of CloudIVR that solve them. `plan` pre-selects a plan at sign-up.
export const AUDIENCES = [
  {
    slug: 'nomads', icon: Plane, name: 'Digital nomads & travellers', short: 'Nomads & travellers',
    card: 'Keep one number while the country changes.',
    title: ['Your number stays put. ', 'You don’t have to.'],
    sub: 'A USA, Canada or UK number that rings in your browser wherever you open your laptop. No SIM to swap, no roaming bill, no contract.',
    pains: [
      ['Your bank and clients still call a number back home', 'Keep a local number and answer it from any browser tab, on any Wi-Fi.'],
      ['You miss calls while you sleep in another time zone', 'Voicemail is written out and sent to your email, so you read it over coffee.'],
      ['Local cards and bank transfers are a pain abroad', 'Top up your wallet with crypto and pay month to month. Stop any time.'],
    ],
    features: [
      [Headphones, 'Browser phone on every plan', 'Call and answer from a tab. Nothing to install.'],
      [Voicemail, 'Voicemail you can read', 'Each message is transcribed and emailed to you.'],
      [Smartphone, 'USA eSIM and travel data', 'A USA line on your own phone, plus data eSIMs for 187 countries.'],
      [Wallet, 'Pay with crypto or wallet', 'No local bank account needed.'],
    ],
    faq: [
      ['Can I use it from any country?', 'Yes. The browser phone works anywhere you have internet. Your callers dial your normal number.'],
      ['Do I need a phone or SIM card?', 'No. A laptop or phone browser is enough. If you want a line on your phone itself, add the USA eSIM.'],
    ],
  },
  {
    slug: 'founders', icon: Rocket, name: 'Entrepreneurs & solo founders', short: 'Founders',
    card: 'Sound like a company from day one.',
    title: ['One founder. ', 'A whole front desk.'],
    sub: 'A business number with a greeting, a menu and an AI receptionist, so every caller is answered while you build.',
    pains: [
      ['Your personal mobile is your business line', 'Give customers a separate business number and forward it to your mobile when you choose.'],
      ['You cannot pick up while you are in a meeting', 'An AI receptionist answers around the clock, takes the message and books the visit.'],
      ['You do not want a year-long phone contract', 'One monthly price per number. Cancel any time.'],
    ],
    features: [
      [Workflow, 'Greeting and keypad menu', '“Press 1 for sales, 2 for support” in minutes.'],
      [Bot, 'AI receptionist', 'Answers 24/7 for $0.10 a minute.'],
      [PhoneForwarded, 'Forward to your mobile', 'Calls follow you; your private number stays private.'],
      [Voicemail, 'Voicemail to email', 'Transcribed, so you can reply between tasks.'],
    ],
    faq: [
      ['How fast can I be live?', 'Sign up, pick a number and record or type a greeting. Most numbers work within minutes.'],
      ['Can I start small and upgrade?', 'Yes. Start on the smallest plan and move up when you need menus, voicemail or campaigns.'],
    ],
  },
  {
    slug: 'small-business', icon: Store, name: 'Small businesses & shops', short: 'Small businesses',
    card: 'Stop losing customers to a missed call.',
    title: ['Every customer call ', 'gets an answer.'],
    sub: 'A menu sends callers to the right person, closed hours get their own message, and texts, voicemails and faxes land in one inbox.',
    pains: [
      ['The phone rings while you serve a customer', 'A keypad menu or AI receptionist picks up, so nobody hears endless ringing.'],
      ['People call after closing time', 'Set your opening hours once. After hours, callers hear your message or leave a voicemail.'],
      ['Customers want to text, and some still fax', 'Add two-way texting to your number, or a fax number that works online.'],
    ],
    features: [
      [Workflow, 'Keypad menu', 'Route sales, support and bookings from one number.'],
      [Clock, 'Opening hours', 'Different handling when you are closed.'],
      [MessageSquareText, 'Calls + texting', 'Reply to customer texts from your browser.'],
      [Printer, 'Online fax', 'Send and receive faxes without a machine.'],
    ],
    faq: [
      ['Do I need new equipment?', 'No. Use the browser phone, forward calls to the phones you have, or sign in from a desk phone.'],
      ['Can staff share the number?', 'Yes. Ring several phones at once and the first to answer takes the call (Pro and up).'],
    ],
  },
  {
    slug: 'teams', icon: Users, name: 'Remote teams & agencies', short: 'Remote teams',
    card: 'One phone system for people in five cities.',
    title: ['Your team is everywhere. ', 'Your phone line is in one place.'],
    sub: 'Numbers in several countries, ring groups, softphone logins and one call history, all managed from a single account.',
    pains: [
      ['Everyone works from a different place', 'Ring up to 5 phones at once. Whoever is free takes the call.'],
      ['Each client or market needs its own local number', 'Add numbers per country or per client and manage them side by side.'],
      ['Nobody knows who spoke to the customer', 'Calls, voicemails and texts sit in one history, and calls can be recorded.'],
    ],
    features: [
      [Radio, 'Ring groups', 'Up to 5 phones ring together (Pro and up).'],
      [Headphones, 'SIP and browser phone', 'Softphones, desk phones or a browser tab.'],
      [Globe2, 'Numbers in several countries', 'A local presence for each market.'],
      [ShieldCheck, 'Verified caller ID', 'Business shows your number on every call.'],
    ],
    faq: [
      ['Can each teammate use their own app?', 'Yes. Sign in from a softphone or desk phone with a SIP login, or use the browser phone.'],
      ['Can an agency keep clients separate?', 'Yes. Each number has its own menu, greeting, hours and history.'],
    ],
    plan: 'pro',
  },
  {
    slug: 'sales', icon: Megaphone, name: 'Sales & outreach teams', short: 'Sales teams',
    card: 'Call the whole list. Talk only to the interested.',
    title: ['Call 500 leads before lunch. ', 'Talk to the ones who press 1.'],
    sub: 'Campaigns play your message to a list, connect interested people straight to you, and show every call as it happens.',
    pains: [
      ['Dialling a list by hand takes all day', 'Upload the list once. The campaign calls it and plays your recording or AI voice.'],
      ['Most calls reach nobody worth talking to', 'Only people who press 1 are connected to you. The rest are logged for follow-up.'],
      ['Bad numbers waste money', 'Check numbers before you call, and keep a do-not-call list that campaigns always respect.'],
    ],
    features: [
      [PhoneCall, 'Quick and bulk campaigns', 'One call or a whole list, with a live view.'],
      [Bot, 'AI voice agents', 'An agent holds the first conversation for $0.10 a minute.'],
      [CalendarClock, 'Scheduling', 'Start now or pick a time up to 30 days ahead.'],
      [ScanSearch, 'Number lookup', 'Clean a list from $0.015 a number.'],
    ],
    faq: [
      ['Which plan do campaigns need?', 'Outbound campaigns start on Pro. Business shows your verified caller ID on every call.'],
      ['How are campaign calls billed?', 'Per minute from your wallet. You see the estimate before the campaign starts.'],
    ],
    plan: 'business',
  },
];

export const audienceBy = (slug) => AUDIENCES.find(a => a.slug === slug);
