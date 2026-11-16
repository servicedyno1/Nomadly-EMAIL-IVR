// English promo copy — structured, short, price-free (prices are injected from
// promo-prices.js so ads always match checkout). Sentence case, no fake proof.
const { CLOUD_COUNTRY_COUNT: N } = require('../phone-config')
module.exports = {
  cloudphone: {
    hooks: ["Nomads: one number that follows you across borders", "Founders: a business line without the phone contract", "Shop owners: never lose a customer to a missed call", "Remote team? One number that rings everyone", "Sales teams: a local number people actually answer"],
    cross: ['Got leads? Now call them', 'Your leads need a number that rings'],
    lines: p => [
      `Virtual numbers in ${N} countries — no SIM, no contract`,
      'IVR menu, voicemail, SMS to Telegram, SIP for softphones',
      `Starter includes ${p.phoneStarterMin} min + ${p.phoneStarterSms} SMS a month`,
    ],
    price: p => `From ${p.phoneStarter}/month · cancel anytime`,
    button: 'Open Cloud IVR',
  },
  antired_hosting: {
    hooks: ["Nomads: host offshore, manage it from anywhere", "Founders: launch on hosting that stays up", "Small business: keep your site online, whatever hits", "Agencies: client sites that stay online", "Marketers: landing pages that outlive the campaign"],
    cross: ['Got a domain? Host it bulletproof', 'Your site deserves an offshore home'],
    lines: _p => [
      'DMCA-ignored offshore servers',
      'Anti-Red scanner blocks bots and flaggers before they land',
      'Full cPanel, free SSL, weekly or monthly billing',
    ],
    price: p => `${p.hostingWeekly}/week or ${p.hostingMonthly}/month`,
    button: 'Open Anti-Red Hosting',
  },
  leads_validation: {
    hooks: ["Nomads: find clients in any country from your laptop", "Founders: get your first prospect list today", "Local business: reach phone owners in your area code", "Agencies: verified leads for every client", "Sales teams: stop dialing dead numbers"],
    cross: ['Got a number? Now get people to call', 'Fill your dialer with verified numbers'],
    lines: _p => [
      'Filter by country, state, area code and carrier',
      'Live-line validation — only active numbers delivered',
      'CNAM lookup shows the name behind each number',
    ],
    price: p => `Leads ${p.leadRate} each · CNAM ${p.cnamRate} per lookup`,
    button: 'Open SMS Leads',
  },
  domains_shortener: {
    hooks: ["Nomads: a bulletproof domain, yours in every country", "Founders: claim your brand name before someone else", "Small business: a real domain beats a social page", "Agencies: register client domains in minutes", "Marketers: short links on your own domain"],
    cross: ['Hosting ready? Put a bulletproof domain on it', 'Short links look better on your own domain'],
    lines: p => [
      '400+ TLDs · DMCA-ignored offshore registration',
      'Cloudflare DNS and nameserver management built in',
      `${p.freeLinks} free branded short links to start`,
    ],
    price: p => `Domains from ${p.domainFrom}/year`,
    button: 'Open Bulletproof Domains',
  },
  digital_products: {
    hooks: ["Nomads: a USA eSIM without setting foot in the USA", "Founders: skip the verification queue, start building", "Small business: a ready Workspace or Zoho account today", "Dev teams: verified Twilio, Telnyx and AWS, delivered here", "Sales teams: SMS and voice accounts, ready to send"],
    cross: ['Need SMS or voice at scale? Get a verified account', 'Pair your number with a verified Twilio account'],
    lines: _p => [
      'Twilio, Telnyx, AWS, Google Cloud, Workspace, Zoho, eSIM',
      'Fully verified and ready to use, delivered to your chat',
      'Pay with wallet, crypto or bank transfer',
    ],
    price: p => `USA T-Mobile eSIM ${p.dpEsim}/month · Twilio sub-account ${p.dpTwilioSub}`,
    button: 'Open Digital Products',
  },
  cards_bundles: {
    hooks: ["Nomads: a card for when your bank says no abroad", "Founders: pay for tools and sign-ups with a virtual card", "Small business: keep online spending on its own card", "Teams: one loaded card per project or client", "Marketers: pay for ads and tools with a virtual card"],
    cross: ['Pay for ads and tools with a virtual card', 'Need a card for sign-ups? Load one now'],
    lines: _p => [
      'Virtual debit card loaded with the amount you choose',
      'Works for online payments and verifications worldwide',
      'Instant delivery, $50 to $1,000 per card',
    ],
    price: _p => 'Pay from your wallet · crypto or bank top-up',
    button: 'Open Virtual Card',
  },
  email_validation: {
    hooks: ["Freelancers: clean your client list before you send", "Founders: your launch email should reach the inbox", "Small business: stop your newsletter bouncing", "Agencies: validate every client list first", "Sales teams: bounces kill campaigns. Validate first"],
    cross: ['Sending email? Validate the list first', 'Protect your SMTP reputation'],
    lines: p => [
      '7-layer check: syntax, MX, SMTP, catch-all, disposable',
      'Gmail, Yahoo, Outlook and private domains',
      `Free ${p.evFreeTrial}-email trial, lists up to 100K`,
    ],
    price: p => `From ${p.evRateBulk} to ${p.evRate} per email`,
    button: 'Open Email Validation',
  },
  marketplace: {
    hooks: ["Nomads: sell your digital goods from anywhere", "Founders: list your tool where buyers already are", "Small sellers: get paid safely with escrow", "Agencies: buy tools from members, escrow-protected", "Sales teams: find the tools your next campaign needs"],
    cross: ['Have something to sell? List it here', 'Browse tools from other members'],
    lines: _p => [
      'Funds held in escrow until delivery is confirmed',
      'Chat with buyers and sellers inside Telegram',
      'Up to 10 active listings, broadcast to all users',
    ],
    price: _p => 'Free to browse · pay from wallet',
    button: 'Open Marketplace',
  },
  vps_rdp: {
    hooks: ["Nomads: your desktop in the cloud, from any laptop", "Founders: ship your app on a server that is yours", "Small business: your own server, ready in minutes", "Remote teams: one Windows RDP everyone can reach", "Outreach teams: your own server, port 25 open"],
    cross: ['Need a server for your sender? Deploy one now', 'Run your tools on a server that is yours'],
    lines: _p => [
      'Full root or admin access, install anything',
      'DMCA-ignored, port 25 open by default',
      'Pay 3, 6 or 12 months and save up to 25%',
    ],
    price: p => `Linux VPS from ${p.vpsFrom}/month · Windows RDP from ${p.rdpFrom}/month`,
    button: 'Open VPS / RDP',
  },
  bulksms_esim: {
    hooks: ["Nomads: text US & Canadian clients without a US SIM", "Founders: announce your launch by text in minutes", "Shops: text your offer to every customer at once", "Agencies: run client SMS campaigns from one chat", "Sales teams: turn US leads into replies by SMS"],
    cross: ["Got leads? Text them today — no SIM needed", "Turn your US leads into replies by SMS"],
    lines: () => ["Upload numbers, write once, send in minutes", "Real US numbers, every major carrier", "Free test SMS · replies right here"],
    price: () => "$50 / 500 SMS · −10% booked a day ahead",
    button: "Open BulkSMS",
  },
  email_blast: {
    hooks: ["Nomads: run email campaigns from your phone", "Founders: tell your whole list about the launch", "Small business: a newsletter with nothing to set up", "Agencies: send client campaigns, no SMTP to manage", "Sales teams: upload a list, write once, reach thousands"],
    cross: ['List validated? Send the campaign', 'Reach your leads by email too'],
    lines: _p => [
      'Custom subject, full HTML body, CSV upload',
      'Live progress: sent, failed, pending',
      'Built-in SMTP, nothing to configure',
    ],
    price: _p => 'Pay per campaign from your wallet',
    button: 'Open Email Blast',
  },
  refer_earn: {
    hooks: ["Nomads: earn from anywhere, one link at a time", "Founders: know other founders? Get paid to refer them", "Small business: recommend us, earn wallet credit", "Agencies: refer clients, earn when they buy", "Sales pros: your network is worth money here"],
    cross: ['Know someone who needs this? Refer them', 'Share once, get paid when they buy'],
    lines: p => [
      'Share your personal link anywhere',
      `${p.referReward} to your wallet when a referral spends ${p.referSpend}`,
      'Works across every service in the bot',
    ],
    price: _p => 'Free to join · rewards paid to wallet',
    button: 'Open Refer & Earn',
  },
  web_hosta: {
    hooks: ["Nomads: run your sites and servers from any browser", "Founders: domain, hosting and server in one sign-up", "Small business: your website live, SSL set up for you", "Agencies: every client domain and server in one tab", "Marketers: a landing page server, live in minutes"],
    cross: ['Prefer a browser? Get your next server on jujucloud.com', 'Your domains and hosting, one tab away'],
    lines: _p => [
      'Private domains in all popular TLDs, WHOIS privacy included',
      'cPanel hosting, Linux VPS and Windows RDP, live in minutes',
      'SSL and DNS set up for you, full root or admin access',
    ],
    price: _p => 'jujucloud.com · sign up with just an email · pay with crypto',
    button: 'Open jujucloud.com',
  },
  web_cloudivr: {
    hooks: ["Landline to Texting: text from the number your customers already know", "Nomads: your business number in a browser tab", "Founders: a full front desk at cloudivr.net", "Small business: keep your landline, add texting", "Remote teams: numbers, menus and calls in one place", "Sales teams: watch your call campaigns live"],
    cross: ['Prefer a big screen? Try CloudIVR on the web', 'Watch your call campaigns live in the browser'],
    lines: _p => [
      'Landline to Texting — keep your office number and calls, send and receive texts on cloudivr.net',
      'Virtual numbers, keypad menus and voicemail with transcripts',
      'Bulk IVR campaigns with a live call view and CSV reports',
      'Browser phone, SIP and AI voice agents',
    ],
    price: _p => 'cloudivr.net · free sign-up with your email · top up with crypto',
    button: 'Open cloudivr.net',
  },
}
