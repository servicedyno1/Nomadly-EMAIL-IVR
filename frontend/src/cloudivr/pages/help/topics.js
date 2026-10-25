// Help center content + "which screen is this" map (also tells the help assistant where the user is).

// [path test, page key, readable name]
const PAGES = [
  [/\/app\/?$/, 'overview', 'Overview'],
  [/\/app\/numbers\/[^/]+/, 'number', 'Number details'],
  [/\/app\/numbers\/?$/, 'numbers', 'My numbers'],
  [/\/app\/sip/, 'sip', 'SIP & softphones'],
  [/\/app\/(buy|orders)/, 'buy', 'Buy a number'],
  [/\/app\/verification/, 'verification', 'Verification'],
  [/\/app\/audio/, 'audio', 'Audio library'],
  [/\/app\/quick-call/, 'quick-call', 'Quick IVR call'],
  [/\/app\/text-call/, 'text-call', 'Text calls'],
  [/\/app\/ai-agents/, 'ai', 'AI voice agents'],
  [/\/app\/campaigns/, 'campaigns', 'Campaigns'],
  [/\/app\/wallet/, 'wallet', 'Wallet'],
  [/\/app\/inbox/, 'inbox', 'Inbox'],
  [/\/app\/settings/, 'settings', 'Settings'],
  [/\/app\/help/, 'help', 'Help center'],
];
const TABS = {
  overview: 'Overview', forwarding: 'Forwarding', browser: 'Browser ring', hours: 'Hours', ivr: 'Keypad menu', ai: 'AI voice agent',
  voicemail: 'Voicemail', sms: 'SMS', sip: 'SIP', recording: 'Recording', logs: 'Logs', billing: 'Billing',
};
// Number-page tabs → help page key, so "help for this page" opens the right articles.
const TAB_TOPIC = { forwarding: 'forwarding', hours: 'hours', ivr: 'keypad', ai: 'ai', voicemail: 'voicemail', sip: 'sip', billing: 'billing', browser: 'browser', recording: 'recording' };

// → { key, topic, label } for the current screen; label is plain English for the assistant, e.g. "Number details — Keypad menu tab".
export function pageOf(pathname = '', search = '') {
  const hit = PAGES.find(([re]) => re.test(pathname));
  if (!hit) return { key: 'landing', topic: 'landing', label: 'Website (not signed in)' };
  const [, key, name] = hit;
  if (key !== 'number') return { key, topic: key, label: name };
  const tab = new URLSearchParams(search).get('tab') || 'overview';
  return { key, topic: TAB_TOPIC[tab] || 'number', label: `${name} — ${TABS[tab] || 'Overview'} tab` };
}

export const GROUPS = [
  ['start', 'Getting started'],
  ['numbers', 'Your numbers'],
  ['calling', 'Calling'],
  ['ai', 'AI voice agents'],
  ['billing', 'Billing and plans'],
  ['account', 'Account and privacy'],
  ['plans', 'Plans and prices'],
];

// Readable names of the topic keys, for the "For this page" heading.
export const TOPIC_NAMES = {
  overview: 'Overview', number: 'Number details', numbers: 'My numbers', sip: 'SIP & softphones', buy: 'Buy a number', verification: 'Verification',
  audio: 'Audio library', 'quick-call': 'Quick IVR call', 'text-call': 'Text calls', ai: 'AI voice agents', campaigns: 'Campaigns', wallet: 'Wallet',
  inbox: 'Inbox', settings: 'Settings', forwarding: 'Forwarding', hours: 'Hours', keypad: 'Keypad menu', voicemail: 'Voicemail', billing: 'Billing',
  browser: 'Browser ring', recording: 'Recording',
};

// { id, group, topics: page/tab keys it belongs to, q, a, to: [path under /app, button label] }
export const ARTICLES = [
  { id: 'get-started', group: 'start', topics: ['overview', 'buy', 'numbers'], q: 'How do I get started?', a: 'Buy a number on the Buy a number page, choose a plan and pay from your wallet or with crypto. Then open the number in My numbers and choose what callers get: forwarding, voicemail, a keypad menu or an AI voice agent.', to: ['buy', 'Buy a number'] },
  { id: 'what-callers-get', group: 'start', topics: ['number', 'numbers'], q: 'How do I see what callers get right now?', a: 'Open the number. The Overview tab sums up what happens when someone calls, and which settings are skipped because another one answers first. Use “Test my number” to hear it yourself.', to: ['numbers', 'My numbers'] },
  { id: 'find-fast', group: 'start', topics: ['overview', 'numbers', 'inbox', 'campaigns', 'audio', 'ai', 'number'], q: 'How do I find something quickly?', a: 'Lists have a search box at the top: type part of a name, a word from a message or a few digits of a number. On a computer, press / to jump to the search box and ? to open help for the page you are on.', to: null },
  { id: 'verification', group: 'start', topics: ['verification', 'buy'], q: 'Why does my number need an ID check?', a: 'Some countries require proof of identity before a number goes live. After paying, upload your document on the Verification page. We tell you as soon as it is approved.', to: ['verification', 'Open Verification'] },

  { id: 'forwarding', group: 'numbers', topics: ['forwarding', 'number'], q: 'How do I forward calls to my mobile?', a: 'Open your number, then the Forwarding tab. Choose when to forward, enter your phone number with the country code (for example +14155550100) and save. Forwarded minutes are billed from your wallet.', to: ['numbers', 'My numbers'] },
  { id: 'hours', group: 'numbers', topics: ['hours', 'number'], q: 'How do I set business hours?', a: 'Open your number, then the Hours tab. Pick the days and times you are open. Outside those hours your number does not ring or forward: callers go to voicemail or hear a short closed message.', to: ['numbers', 'My numbers'] },
  { id: 'keypad', group: 'numbers', topics: ['keypad', 'number'], q: 'How do I set up a keypad menu (IVR)?', a: 'Open your number, then the Keypad menu tab (Business plan). Type or record a greeting, add a key for each choice (forward, message, voicemail or a sub-menu) and press Save keypad menu. Starting from a template saves time.', to: ['numbers', 'My numbers'] },
  { id: 'one-answers', group: 'numbers', topics: ['keypad', 'ai', 'number'], q: 'Can a number use a keypad menu and an AI voice agent together?', a: 'No. A number uses one or the other. Turning one on switches the other off, and the tab warns you before you save.', to: ['numbers', 'My numbers'] },
  { id: 'voicemail', group: 'numbers', topics: ['voicemail', 'number', 'inbox'], q: 'How do I set up voicemail?', a: 'Open your number, then the Voicemail tab (Pro plan and up). Pick the greeting language or record your own greeting. New messages arrive in your Inbox with a written transcript.', to: ['numbers', 'My numbers'] },
  { id: 'recording', group: 'numbers', topics: ['recording', 'number'], q: 'How do I record calls?', a: 'Open your number, then the Recording tab (Pro plan and up), and turn recording on. Recordings appear in the number’s Logs and in your Inbox.', to: ['numbers', 'My numbers'] },
  { id: 'extra-numbers', group: 'numbers', topics: ['billing', 'number', 'numbers'], q: 'How do I add an extra number?', a: 'Open your main number, then Billing → Extra numbers. Search and buy. Extra numbers share the main number’s plan, minutes and SMS.', to: ['numbers', 'My numbers'] },

  { id: 'browser-phone', group: 'calling', topics: ['overview', 'browser', 'number'], q: 'Can I make and answer calls in my browser?', a: 'Yes. The phone icon in the top bar opens the browser phone. To answer incoming calls in the browser, open your number and turn on the Browser ring tab.', to: ['numbers', 'My numbers'] },
  { id: 'sip', group: 'calling', topics: ['sip', 'number'], q: 'How do I use a softphone app (SIP)?', a: 'Open SIP & softphones (Pro plan and up). Copy the username, password and server into Zoiper, Linphone or MicroSIP. The setup guide on that page shows each step.', to: ['sip', 'Open SIP & softphones'] },
  { id: 'quick-call', group: 'calling', topics: ['quick-call'], q: 'How do I send a Quick IVR call?', a: 'Open Quick IVR call. Pick your caller number (Pro or Business), type the message or start from a template, add the numbers to call and start. Calls are billed per minute from your wallet.', to: ['quick-call', 'Open Quick IVR call'] },
  { id: 'campaigns', group: 'calling', topics: ['campaigns'], q: 'How do I run a campaign?', a: 'Open Campaigns, then New campaign. Pick the caller number, paste or upload your list (CSV) and choose a message or an AI voice agent. You can pause, resume or cancel at any time and download a CSV report.', to: ['campaigns/new', 'New campaign'] },
  { id: 'text-calls', group: 'calling', topics: ['text-call', 'browser'], q: 'What are text calls?', a: 'Text calls help deaf and hard-of-hearing people call by typing. The other person hears your words spoken aloud, and what they say appears as text.', to: ['text-call', 'Open Text calls'] },
  { id: 'audio', group: 'calling', topics: ['audio', 'keypad', 'campaigns'], q: 'How do I add my own audio?', a: 'Open the Audio library to upload a recording or create one with an AI voice. You can then pick it as a greeting in a keypad menu, a voicemail or a campaign.', to: ['audio', 'Open Audio library'] },

  { id: 'ai-agent', group: 'ai', topics: ['ai'], q: 'How do I let an AI voice agent answer calls?', a: 'Open AI voice agents, create an agent, describe what it should do and add your FAQs, then test it free in your browser. Next, open your number’s AI voice agent tab, pick the agent and save. Needs the Business plan; calls are billed per minute from your wallet.', to: ['ai-agents', 'Open AI voice agents'] },
  { id: 'do-not-call', group: 'ai', topics: ['ai', 'campaigns'], q: 'How do I stop the AI agent calling someone?', a: 'Add the number to the do-not-call list on the AI voice agents page. Anyone who asks the agent not to call again is added automatically.', to: ['ai-agents', 'Open AI voice agents'] },

  { id: 'wallet', group: 'billing', topics: ['wallet', 'buy'], q: 'How do I top up my wallet?', a: 'Open Wallet, enter an amount and choose a coin. Send the exact amount to the address shown. Your balance updates once the network confirms the deposit.', to: ['wallet', 'Open Wallet'] },
  { id: 'renewals', group: 'billing', topics: ['billing', 'wallet', 'number'], q: 'How do renewals work?', a: 'With auto-renew on, each number renews from your wallet on its renewal date, so keep enough balance. You can also renew early in the number’s Billing tab.', to: ['numbers', 'My numbers'] },
  { id: 'change-plan', group: 'billing', topics: ['billing', 'number'], q: 'How do I change my plan?', a: 'Open the number, then the Billing tab. Upgrading keeps your renewal date. Moving to a smaller plan happens right away, with no refund for the current month.', to: ['numbers', 'My numbers'] },

  { id: 'private-mode', group: 'account', topics: ['overview', 'inbox', 'settings'], q: 'How do I hide numbers on screen?', a: 'Turn on Private mode with the eye button in the top bar (on phones: More → Private mode). Numbers and messages stay hidden until you turn it off.', to: ['', 'Go to Overview'] },
  { id: 'language', group: 'account', topics: ['settings'], q: 'How do I change the language?', a: 'Use the language menu in the top bar (on phones: More → Language) or Settings. Spoken keypad menus follow the app language.', to: ['settings', 'Open Settings'] },
  { id: 'undo', group: 'account', topics: ['overview', 'campaigns', 'ai', 'quick-call'], q: 'I deleted something by mistake', a: 'Quick deletes show an Undo button for a few seconds. Bigger actions ask you to confirm first, and we warn you before you leave a page with unsaved changes. If something is already gone, message support and we will help.', to: null },
];
