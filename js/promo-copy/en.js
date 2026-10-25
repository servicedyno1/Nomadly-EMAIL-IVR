// English promo copy — structured, short, price-free (prices are injected from
// promo-prices.js so ads always match checkout). Sentence case, no fake proof.
const { CLOUD_COUNTRY_COUNT: N } = require('../phone-config')
module.exports = {
  cloudphone: {
    hooks: ['Give your business a real phone line', `A phone number in ${N} countries, most live in minutes`],
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
    hooks: ['Hosting that stays up when takedowns hit', 'Anti-Red Hosting: offshore, DMCA-ignored, cPanel included'],
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
    hooks: ['Phone leads with real owner names', 'Stop dialing dead numbers'],
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
    hooks: ['Bulletproof domains, registered in minutes', 'Own a domain nobody can take from you'],
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
    hooks: ['Verified Twilio, Telnyx and AWS accounts, delivered in Telegram', 'Skip the verification queue'],
    cross: ['Need SMS or voice at scale? Get a verified account', 'Pair your number with a verified Twilio account'],
    lines: _p => [
      'Twilio, Telnyx, AWS, Google Cloud, Workspace, Zoho, eSIM',
      'Fully verified and ready to use, delivered to your chat',
      'Pay with wallet, crypto or bank transfer',
    ],
    price: p => `eSIM from ${p.dpEsim} · Twilio sub-account ${p.dpTwilioSub}`,
    button: 'Open Digital Products',
  },
  cards_bundles: {
    hooks: ['A virtual card for payments that need one', 'Load a card in a minute, use it anywhere online'],
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
    hooks: ['Clean your email list before you send', 'Bounces kill campaigns. Validate first'],
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
    hooks: ['Buy and sell digital goods with escrow', 'Your tools, listed where buyers already are'],
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
    hooks: ['Linux VPS or Windows RDP, ready in minutes', 'Your own server, port 25 open'],
    cross: ['Need a server for your sender? Deploy one now', 'Run your tools on a server that is yours'],
    lines: _p => [
      'Full root or admin access, install anything',
      'DMCA-ignored, port 25 open by default',
      'Pay 3, 6 or 12 months and save up to 25%',
    ],
    price: p => `Linux VPS from ${p.vpsFrom}/month · Windows RDP from ${p.rdpFrom}/month`,
    button: 'Open VPS / RDP',
  },
  bulksms_app: {
    hooks: ['Send bulk SMS from your own phone number', 'BulkSMS campaigns from your Android, managed here'],
    cross: ['Got leads? Text them from your own number', 'Pair your leads with the BulkSMS app'],
    lines: p => [
      'Your SIM, your sender ID — no shared gateways',
      'Schedule sends, control gaps, track delivery live',
      `Free trial: ${p.smsTrial} SMS, no subscription needed`,
    ],
    price: p => `Daily ${p.smsDaily} · Weekly ${p.smsWeekly} · Monthly ${p.smsMonthly}`,
    button: 'Open BulkSMS',
  },
  email_blast: {
    hooks: ['Email campaigns without leaving Telegram', 'Upload a list, write once, send to thousands'],
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
    hooks: ['Earn from every friend you bring', 'Your link, their purchase, your reward'],
    cross: ['Know someone who needs this? Refer them', 'Share once, get paid when they buy'],
    lines: p => [
      'Share your personal link anywhere',
      `${p.referReward} to your wallet when a referral spends ${p.referSpend}`,
      'Works across every service in the bot',
    ],
    price: _p => 'Free to join · rewards paid to wallet',
    button: 'Open Refer & Earn',
  },
}
