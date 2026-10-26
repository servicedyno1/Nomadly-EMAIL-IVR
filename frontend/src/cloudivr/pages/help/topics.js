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
  [/\/app\/campaigns/, 'campaigns', 'Bulk IVR campaigns'],
  [/\/app\/wallet/, 'wallet', 'Wallet'],
  [/\/app\/inbox/, 'inbox', 'Inbox'],
  [/\/app\/settings/, 'settings', 'Settings'],
  [/\/app\/help/, 'help', 'Help center'],
];
const TABS = {
  overview: 'Overview', forwarding: 'Forwarding', browser: 'Browser ring', hours: 'Hours', ivr: 'Keypad menu', ai: 'AI voice agent',
  voicemail: 'Voicemail', sms: 'SMS', sip: 'SIP', recording: 'Recording', logs: 'Logs', billing: 'Billing', ringgroup: 'Ring group', triggers: 'Text Triggers',
};
// Number-page tabs → help page key, so "help for this page" opens the right articles.
const TAB_TOPIC = { forwarding: 'forwarding', hours: 'hours', ivr: 'keypad', ai: 'ai', voicemail: 'voicemail', sip: 'sip', billing: 'billing', browser: 'browser', recording: 'recording', ringgroup: 'ringgroup', triggers: 'triggers', logs: 'logs' };

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
  audio: 'Audio library', 'quick-call': 'Quick IVR call', 'text-call': 'Text calls', ai: 'AI voice agents', campaigns: 'Bulk IVR campaigns', wallet: 'Wallet',
  inbox: 'Inbox', settings: 'Settings', forwarding: 'Forwarding', hours: 'Hours', keypad: 'Keypad menu', voicemail: 'Voicemail', billing: 'Billing',
  browser: 'Browser ring', recording: 'Recording', ringgroup: 'Ring group', triggers: 'Text Triggers', logs: 'Logs',
};

// { id, group, topics: page/tab keys it belongs to, q, a, to: [path under /app, button label] }
export const ARTICLES = [
  { id: 'get-started', group: 'start', topics: ['overview', 'buy', 'numbers'], q: 'How do I get started?', a: 'Buy a number on the Buy a number page, choose a plan and pay from your wallet or with crypto. Then open the number in My numbers and choose what callers get: forwarding, voicemail, a keypad menu or an AI voice agent.', to: ['buy', 'Buy a number'] },
  { id: 'what-callers-get', group: 'start', topics: ['number', 'numbers'], q: 'How do I see what callers get right now?', a: 'Open the number. The Overview tab sums up what happens when someone calls, and which settings are skipped because another one answers first. Use “Test my number” to hear it yourself.', to: ['numbers', 'My numbers'] },
  { id: 'find-fast', group: 'start', topics: ['overview', 'numbers', 'inbox', 'campaigns', 'audio', 'ai', 'number'], q: 'How do I find something quickly?', a: 'Lists have a search box at the top: type part of a name, a word from a message or a few digits of a number. On a computer, press / to jump to the search box and ? to open help for the page you are on.', to: null },
  { id: 'verification', group: 'start', topics: ['verification', 'buy'], q: 'Why does my number need an ID check?', a: 'Some countries require proof of identity before a number goes live. After paying, upload your document on the Verification page. We tell you as soon as it is approved.', to: ['verification', 'Open Verification'] },

  { id: 'forwarding', group: 'numbers', topics: ['forwarding', 'number'], q: 'How do I forward calls to my mobile?', a: 'Open your number, then the Forwarding tab. Choose when to forward, enter your phone number with the country code (for example +14155550100) and save. Forwarded minutes are billed from your wallet.', to: ['numbers', 'My numbers'] },
  { id: 'hours', group: 'numbers', topics: ['hours', 'number'], q: 'How do I set business hours?', a: 'Open your number, then the Hours tab. Pick the days and times you are open. Outside those hours your number does not ring: callers go to voicemail, hear a short closed message, or are forwarded to up to 5 backup numbers in turn.', to: ['numbers', 'My numbers'] },
  { id: 'keypad', group: 'numbers', topics: ['keypad', 'number'], q: 'How do I set up a keypad menu (IVR)?', a: 'Open your number, then the Keypad menu tab (Pro plan and up). Type or record a greeting, add a key for each choice (forward, message, voicemail or a sub-menu) and press Save keypad menu. Starting from a template saves time.', to: ['numbers', 'My numbers'] },
  { id: 'one-answers', group: 'numbers', topics: ['keypad', 'ai', 'number'], q: 'Can a number use a keypad menu and an AI voice agent together?', a: 'No. A number uses one or the other. Turning one on switches the other off, and the tab warns you before you save.', to: ['numbers', 'My numbers'] },
  { id: 'voicemail', group: 'numbers', topics: ['voicemail', 'number', 'inbox'], q: 'How do I set up voicemail?', a: 'Open your number, then the Voicemail tab (Pro plan and up). Pick the greeting language or record your own greeting. New messages arrive in your Inbox with a written transcript.', to: ['numbers', 'My numbers'] },
  { id: 'recording', group: 'numbers', topics: ['recording', 'number'], q: 'How do I record calls?', a: 'Open your number, then the Recording tab (Pro plan and up), and turn recording on. Recordings appear in the number’s Logs and in your Inbox.', to: ['numbers', 'My numbers'] },
  { id: 'ring-group', group: 'numbers', topics: ['ringgroup', 'forwarding', 'number'], q: 'How do I ring several phones at once?', a: 'Open your number, then the Ring group tab (Pro plan and up). Add up to 5 phones and switch it on. Every call rings them all at the same time and the first to answer gets the caller. Choose what happens when nobody answers: voicemail, one backup number, or a short message.', to: ['numbers', 'My numbers'] },
  { id: 'text-triggers', group: 'numbers', topics: ['triggers', 'number', 'inbox'], q: 'What are Text Triggers?', a: 'Text Triggers start a call when a text arrives on your number (Business plan). Auto Callback rings your phone first and reads you the text — press 1 to call them back. Text-to-Call message calls the person who texted and reads your message. AI agent calls them back uses your AI voice agent. Each trigger can run only on a keyword, only during business hours and once per sender per hour. Use “Try a text” to check your setup without dialing.', to: ['numbers', 'My numbers'] },
  { id: 'ai-summaries', group: 'numbers', topics: ['logs', 'voicemail', 'recording', 'number'], q: 'How do AI summaries and caller mood work?', a: 'Open your number, then the Logs tab (Pro plan and up). Switch on AI summaries to get a short summary, the caller’s mood and follow-ups for every new voicemail and recorded call, or tap Summarize on any one. It costs a small per-minute fee from your wallet; if nothing can be summarised you are not charged.', to: ['numbers', 'My numbers'] },
  { id: 'extra-numbers', group: 'numbers', topics: ['billing', 'number', 'numbers'], q: 'How do I add an extra number?', a: 'Open your main number, then Billing → Extra numbers. Search and buy. Extra numbers share the main number’s plan, minutes and SMS.', to: ['numbers', 'My numbers'] },

  { id: 'browser-phone', group: 'calling', topics: ['overview', 'browser', 'number'], q: 'Can I make and answer calls in my browser?', a: 'Yes. The phone icon in the top bar opens the browser phone. To answer incoming calls in the browser, open your number and turn on the Browser ring tab.', to: ['numbers', 'My numbers'] },
  { id: 'sip', group: 'calling', topics: ['sip', 'number'], q: 'How do I use a softphone app (SIP)?', a: 'Open SIP & softphones (Pro plan and up). Copy the username, password and server into Zoiper, Linphone or MicroSIP. The setup guide on that page shows each step.', to: ['sip', 'Open SIP & softphones'] },
  { id: 'in-vs-out', group: 'calling', topics: ['keypad', 'quick-call', 'campaigns', 'number'], q: 'What’s the difference between the keypad menu and Quick or Bulk IVR?', a: 'They work in opposite directions. The keypad menu answers people who call your number: they hear your greeting and press a key to reach the right person, a message or voicemail. Quick IVR and Bulk IVR call people for you: they hear your message, then press a key to reach you, type a code or pick an option. Quick IVR is for up to 10 numbers at once, Bulk IVR campaigns for a whole list. All three are on the Pro plan and up.', to: ['quick-call', 'Open Quick IVR call'] },
  { id: 'quick-call', group: 'calling', topics: ['quick-call'], q: 'How do I send a Quick IVR call?', a: 'Open Quick IVR call. Pick your caller number (Pro or Business), type the message or start from a template, add up to 10 numbers and choose what a key press does: connect them to you, collect a code you accept or decline, or route each key. Calls are billed per minute from your wallet. Scheduling a call for later and saved presets are on the Business plan.', to: ['quick-call', 'Open Quick IVR call'] },
  { id: 'otp', group: 'calling', topics: ['quick-call', 'inbox'], q: 'How does code collection (OTP) work?', a: 'Choose “Collect a code” on a Quick IVR call. The person presses a key, types the code and waits on hold. A banner pops up at the top of whatever page you are on: Accept to confirm the code (and connect them if you added a number), Decline to ask again (3 tries in all), or Hang up. You have 90 seconds to answer; the code also shows in your Inbox. Pro plan and up; your own accept / decline messages are on Business.', to: ['quick-call', 'Open Quick IVR call'] },
  { id: 'free-quick-call', group: 'start', topics: ['overview', 'quick-call', 'campaigns', 'buy'], q: 'Can I try a Quick IVR call for free?', a: 'Yes. Until you have a number on the Pro plan or higher, your account gets one free Quick IVR call. It rings the number you enter from our shared demo number, plays your script, then connects them to your phone when they press 1 or collects a code you accept or decline. It only counts once someone answers. No wallet balance needed.', to: ['quick-call', 'Place my free call'] },
  { id: 'campaigns', group: 'calling', topics: ['campaigns'], q: 'How do I run a Bulk IVR campaign?', a: 'Open Bulk IVR campaigns, then New campaign. Pick the caller number, paste or upload your list (CSV) and choose a message or an AI voice agent. You can pause, resume or cancel at any time and download a CSV report.', to: ['campaigns/new', 'New campaign'] },
  { id: 'text-calls', group: 'calling', topics: ['text-call', 'browser'], q: 'What are text calls?', a: 'Text calls help deaf and hard-of-hearing people call by typing. A natural voice reads each sentence to the other person as soon as you finish it, they hear soft typing while you write, and what they say appears as live text. Both options can be switched off under the typing box. Text calls are on the Business plan.', to: ['text-call', 'Open Text calls'] },
  { id: 'audio', group: 'calling', topics: ['audio', 'keypad', 'campaigns'], q: 'How do I add my own audio?', a: 'Open the Audio library to upload a recording or create one with an AI voice. You can then pick it as a greeting in a keypad menu, a voicemail or a campaign.', to: ['audio', 'Open Audio library'] },

  { id: 'ai-agent', group: 'ai', topics: ['ai'], q: 'How do I let an AI voice agent answer calls?', a: 'Open AI voice agents, create an agent, describe what it should do and add your FAQs, then test it free in your browser. Next, open your number’s AI voice agent tab, pick the agent and save. Needs the Business plan; calls are billed per minute from your wallet.', to: ['ai-agents', 'Open AI voice agents'] },
  { id: 'do-not-call', group: 'ai', topics: ['ai', 'campaigns'], q: 'How do I stop the AI agent calling someone?', a: 'Add the number to the do-not-call list on the AI voice agents page. Anyone who asks the agent not to call again is added automatically.', to: ['ai-agents', 'Open AI voice agents'] },

  { id: 'wallet', group: 'billing', topics: ['wallet', 'buy'], q: 'How do I top up my wallet?', a: 'Open Wallet, enter an amount and choose a coin. Send the exact amount to the address shown. Your balance updates once the network confirms the deposit.', to: ['wallet', 'Open Wallet'] },
  { id: 'renewals', group: 'billing', topics: ['billing', 'wallet', 'number'], q: 'How do renewals work?', a: 'With auto-renew on, each number renews from your wallet on its renewal date, so keep enough balance. You can also renew early in the number’s Billing tab.', to: ['numbers', 'My numbers'] },
  { id: 'change-plan', group: 'billing', topics: ['billing', 'number'], q: 'How do I change my plan?', a: 'Open the number, then the Billing tab. Upgrading keeps your renewal date. Moving to a smaller plan happens right away, with no refund for the current month.', to: ['numbers', 'My numbers'] },

  { id: 'private-mode', group: 'account', topics: ['overview', 'inbox', 'settings'], q: 'How do I hide numbers on screen?', a: 'Turn on Private mode with the eye button in the top bar (on phones: More → Private mode). Numbers and messages stay hidden until you turn it off.', to: ['', 'Go to Overview'] },
  { id: 'webhooks', group: 'account', topics: ['settings'], q: 'How do I send call events to my CRM or Zapier?', a: 'Open Settings → Call events (webhooks & Zapier). Paste a URL that starts with https:// — for Zapier use “Webhooks by Zapier” → Catch Hook. Pick the events (call started, call ended, voicemail left, text received, AI summary ready), save and send a test event. Each event is signed so your server can check it came from us.', to: ['settings', 'Open Settings'] },
  { id: 'install-app', group: 'account', topics: ['settings', 'overview'], q: 'Can I install CloudIVR on my phone?', a: 'Yes. On Android (Chrome) open Settings → Install the app and tap Install. On iPhone, open CloudIVR in Safari, tap Share, then Add to Home Screen. It opens full screen like a normal app.', to: ['settings', 'Open Settings'] },
  { id: 'language', group: 'account', topics: ['settings'], q: 'How do I change the language?', a: 'Use the language menu in the top bar (on phones: More → Language) or Settings. Spoken keypad menus follow the app language.', to: ['settings', 'Open Settings'] },
  { id: 'undo', group: 'account', topics: ['overview', 'campaigns', 'ai', 'quick-call'], q: 'I deleted something by mistake', a: 'Quick deletes show an Undo button for a few seconds. Bigger actions ask you to confirm first, and we warn you before you leave a page with unsaved changes. If something is already gone, message support and we will help.', to: null },
];
