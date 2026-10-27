'use strict'
// ============================================================================
// CloudIVR — SEO + AI-assistant discoverability
// ============================================================================
// Pure content generators used ONLY on the CloudIVR custom domain (cloudivr.net),
// wired in via domain-guard.js. The CloudIVR web app is a client-rendered SPA, so
// crawlers that do not execute JavaScript (GPTBot, ClaudeBot, PerplexityBot, CCBot…)
// would otherwise see an empty <div id="root">. This module gives them real content:
//
//   • /robots.txt      — explicitly welcomes the major AI + search crawlers
//   • /llms.txt         — short, link-first overview (the emerging llms.txt standard)
//   • /llms-full.txt    — full written overview (features, pricing, FAQ) in Markdown
//   • /sitemap.xml      — the public pages
//   • <head> injection  — title, description, canonical, Open Graph, Twitter cards
//                         and JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage)
//   • <noscript> body   — a full written overview readable without running the app
//
// Pricing/plans/countries are read live from the same catalogue the app serves, so the
// copy stays accurate as plans change. Everything degrades gracefully if the catalogue
// is unavailable.

// ── Canonical site URL (apex of the CloudIVR domain) ────────────────────────
const apexOf = (v) => String(v || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0].replace(/^www\./, '')
const DOMAIN = apexOf(process.env.CLOUDIVR_WEB_DOMAIN) || 'cloudivr.net'
const CANONICAL = (process.env.CLOUDIVR_CANONICAL_URL || `https://${DOMAIN}`).replace(/\/+$/, '')
const BRAND = 'CloudIVR'
// Link-preview card (Telegram / WhatsApp / X): small JPEG so WhatsApp shows it too. Re-render: node scripts/promo-banners/render.js
const OG_IMAGE = `${CANONICAL}/civr/brand/og-share.jpg`
// What Telegram / WhatsApp show under the title when the home page is shared.
const SHARE_DESC = 'Reach out: Quick IVR and Bulk IVR campaigns call your list, play your message, connect interested leads and collect codes.'
const LOGO = `${CANONICAL}/civr/brand/icon-512.png`

// ── Formatting helpers ──────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const usd = (n) => { const v = Number(n) || 0; return '$' + (Number.isInteger(v) ? v : v.toFixed(2)) }
const perMin = (n) => { const v = Number(n) || 0; return '$' + (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)) }
const andList = (a) => { const x = (a || []).filter(Boolean); return x.length <= 1 ? (x[0] || '') : `${x.slice(0, -1).join(', ')} and ${x[x.length - 1]}` }

// ── Live catalogue (plans, rates, countries) — safe if engine not ready ──────
function cat() {
  try {
    const numbers = require('./numbers')
    const wallet = require('./wallet')
    const c = numbers.catalog() || {}
    const plans = (c.plans || []).filter((p) => p && p.available !== false)
    return {
      plans,
      rates: c.rates || {},
      extraNumber: c.extraNumber || null,
      minTopup: wallet.MIN_TOPUP_USD,
      countryCount: (() => { try { return (numbers.countries() || []).length } catch (_) { return 0 } })(),
    }
  } catch (_) { return null }
}

const startPrice = (c) => (c && c.plans && c.plans.length ? Math.min(...c.plans.map((p) => Number(p.price) || 0)) : null)
const plansWith = (c, key) => (c && c.plans ? c.plans.filter((p) => p.access && p.access[key]).map((p) => p.name) : [])

// Objection FAQs — what the platform does today when things don't go to plan. Shared with the landing page copy.
function objectionFaqs() {
  return [
    ['What happens if the AI agent can’t help?',
      'It never pretends to be human and never asks for card numbers, passwords or one-time codes. When a caller wants a person, the agent transfers the call to the number you set — or, if you have not set one, offers to take a message with a name, callback number and the message, which lands in your inbox. On a keypad menu, callers can always reach voicemail. Anyone who asks not to be called again is removed from the list and the call ends politely.'],
    ['Do you scrub numbers or enforce quiet hours?',
      'Your do-not-call list is enforced on every campaign — Bulk IVR and AI agent, web and Telegram bot: numbers on it are never dialed and never billed. We do not check public Do-Not-Call registries for you and we do not enforce quiet hours automatically: you schedule each campaign, set a daily call limit and repeat it daily or weekly, and you are responsible for calling only people who have agreed to hear from you, at reasonable hours where they live.'],
  ]
}

// ── Marketing facts (single source for head, noscript, llms.txt) ─────────────
const FEATURES = [
  ['Virtual phone numbers', 'Local, mobile and toll-free numbers across the US, Canada and many international countries.'],
  ['Keypad menus (IVR) for incoming calls', 'Callers hear your greeting and press a key to reach the right person, hear a message or leave voicemail, with key-press stats.'],
  ['AI voice agents', 'A natural-sounding agent that answers calls, qualifies callers, answers questions, books appointments and takes messages — in 20 languages, switching when the caller does.'],
  ['Call forwarding', 'Ring any phone number, with backup destinations and hold music.'],
  ['SMS inbox', 'Receive and reply to texts in-app, with automatic replies and text triggers.'],
  ['Voicemail', 'Custom greetings, transcription and delivery to your email.'],
  ['Browser phone on every plan', 'Make and take calls in any browser tab with the built-in browser phone — nothing to install. Pro and up also connect SIP apps and desk phones.'],
  ['Call recording', 'Record calls and play them back from your logs.'],
  ['Quick IVR calls & Bulk IVR campaigns', 'Automated outbound calls to up to 10 people at once or a whole list: play your message, then connect them on a key press, collect a code (OTP) or route each key.'],
  ['Ring groups, Text Triggers & text calls', 'Ring several phones at once, start a callback from an incoming text, or call by typing — a natural voice speaks for you and their words appear as live text.'],
  ['Logs, analytics & AI summaries', 'Searchable call and message history with AI-written call summaries.'],
  ['Wallet & auto-renew', 'Fund a wallet with crypto (cards coming soon); numbers auto-renew and usage is billed from the wallet.'],
]

const HOW = [
  ['Sign up free', 'Create a CloudIVR account with your email — no charge to start.'],
  ['Choose a number', 'Pick a country and number type, search live availability, and pay with crypto or from your wallet.'],
  ['Set it up', 'Add a greeting, a keypad menu or an AI voice agent, call forwarding and voicemail.'],
  ['Start using it', 'Answer in the browser phone or a SIP app, forward to your phone, and manage SMS, voicemail, recordings, logs and campaigns from the dashboard.'],
]

function faqs() {
  const c = cat()
  const start = startPrice(c)
  const fromTxt = start != null ? ` (from ${usd(start)}/month)` : ''
  const minTopup = c && c.minTopup != null ? usd(c.minTopup) : '$10'
  const ai = perMin(c && c.rates ? c.rates.aiAgentPerMin : 0.2)
  const extra = c && c.extraNumber ? usd(c.extraNumber.price) : '$25'
  const countries = c && c.countryCount ? c.countryCount : null
  const ivrPlans = andList(plansWith(c, 'ivr')) || 'the Business'
  return [
    ['Is CloudIVR free to start?',
      `Yes. Creating a CloudIVR account is free. You only pay when you buy a phone number${fromTxt}, plus any usage beyond your plan's included minutes and SMS.`],
    ['How do I pay?',
      `Pay with crypto, or top up your CloudIVR wallet (from ${minTopup}) and pay from it. Renewals and call charges come out of your wallet. Card payments are coming soon.`],
    ['What is a keypad menu (IVR)?',
      `An IVR is a phone keypad menu: callers hear your greeting and press a key to reach the right person, hear a message or leave voicemail. It runs on your plan's included minutes. The keypad menu is on the ${ivrPlans} plan.`],
    ['What can an AI voice agent do?',
      `Instead of a keypad menu, an AI voice agent talks naturally with callers — it answers questions, books appointments and takes messages. It is billed ${ai}/min from your wallet. Each number uses either a keypad menu or an AI agent.`],
    ['Are outgoing calls included in my minutes?',
      'No. Plan minutes cover incoming calls you answer. Outgoing calls — the browser phone, SIP, Quick IVR calls, campaigns and AI agent calls — and forwarded calls are billed per minute from your wallet, and the price is shown before you call.'],
    ['Can I use my number from a browser or a SIP app?',
      'Yes. Every plan includes the built-in browser phone — make and take calls in any browser tab, nothing to install — and call forwarding to any phone. Pro and up also connect SIP apps and desk phones.'],
    ['Which countries can I get a number in?',
      countries
        ? `Numbers are available in ${countries} countries, including the US and Canada, plus international local, mobile and toll-free numbers.`
        : 'Numbers are available across the US, Canada and many international countries, including local, mobile and toll-free numbers.'],
    ['Can I put several numbers on one plan?',
      `Yes. Add extra numbers from ${extra}/month each; they share the plan's minutes and SMS and get the same features.`],
    ...objectionFaqs(),
    ['Is this the same account as the Telegram bot?',
      'No. CloudIVR web accounts are separate from any Telegram bot account — sign up here with your email.'],
  ]
}

function tagline() {
  const c = cat()
  const start = startPrice(c)
  const countries = c && c.countryCount ? ` in ${c.countryCount} countries` : ''
  return `Virtual phone numbers${countries} with a browser phone, keypad menus (IVR), AI voice agents, call forwarding, voicemail, call recording, an SMS inbox and outbound IVR campaigns. Free to start${start != null ? `, numbers from ${usd(start)}/month` : ''}. Pay with crypto, run your whole phone system from the browser.`
}

// ── SIP sales page (/sip) — the SIP server itself (sip.<domain>) is a phone-only address, never a web page ──
const sipServer = () => { try { return require('../phone-config').WEB_SIP_DOMAIN || `sip.${DOMAIN}` } catch (_) { return `sip.${DOMAIN}` } }
const sipPlansOf = (c) => (c && c.plans ? c.plans.filter((p) => p.access && p.access.sipCredentials).sort((a, b) => a.price - b.price) : [])

function sipDesc() {
  const sp = sipPlansOf(cat())
  const from = sp.length ? ` SIP logins from ${usd(sp[0].price)}/month.` : ''
  return `Put a real phone number on Zoiper, MicroSIP, Linphone or any SIP desk phone. Server ${sipServer()}, port 5060 (UDP/TCP) or 5061 (TLS), with voicemail, a keypad menu, call recording and an SMS inbox built in.${from} No contracts.`
}

function sipFaqs() {
  const c = cat()
  const sp = sipPlansOf(c)
  const server = sipServer()
  const names = andList(sp.map((p) => p.name)) || 'the Pro plan and up'
  const from = sp.length ? `, from ${usd(sp[0].price)}/month` : ''
  const basic = c && c.plans ? c.plans.filter((p) => !(p.access && p.access.sipCredentials)).sort((a, b) => a.price - b.price)[0] : null
  return [
    [`Why doesn't ${server} open in my browser?`,
      `Because it isn't a website. ${server} is the server address your phone app connects to, so a browser has nothing to show there. Type it into your softphone or desk phone as the SIP server or domain.`],
    ['Which plan do I need for SIP?', `SIP logins come with ${names}${from}.${basic ? ` ${basic.name} includes the browser phone and call forwarding, but no SIP logins.` : ''}`],
    ['Which apps and phones work?', 'Any softphone or desk phone that takes a standard SIP account. Zoiper, MicroSIP and Linphone are free and take a minute to set up.'],
    ['What do I enter in my app?', `Server or domain: ${server}. Port 5060 over UDP or TCP, or 5061 for TLS. Your username and password are on the number's SIP tab in your dashboard.`],
    ['What do calls cost?', 'Incoming calls use your plan minutes. Outgoing calls from a softphone are billed per minute from your wallet.'],
  ]
}

// ── Per-page <head> metadata ─────────────────────────────────────────────────
function metaFor(pathname) {
  const p = (String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/')
  const start = startPrice(cat())
  const fromTxt = start != null ? ` Numbers from ${usd(start)}/month.` : ''
  const pages = {
    '/': {
      title: `${BRAND} — Virtual Phone Numbers, IVR & AI Voice Agents`,
      desc: tagline(),
      share: SHARE_DESC,
    },
    '/login': {
      title: `Sign in · ${BRAND}`,
      desc: `Sign in to your ${BRAND} account to manage numbers, keypad menus, voicemail, SMS and campaigns.`,
    },
    '/signup': {
      title: `Create your ${BRAND} account`,
      desc: `Get a virtual phone number with keypad menus (IVR), voicemail, an SMS inbox and AI voice agents. Free to sign up; pay with crypto or your wallet.${fromTxt}`,
    },
    '/forgot': {
      title: `Reset your password · ${BRAND}`,
      desc: `Reset the password for your ${BRAND} account.`,
    },
    '/terms': {
      title: `Terms of Service · ${BRAND}`,
      desc: `The rules for using ${BRAND}: accounts, phone numbers, plans and wallet payments, free calls, acceptable use, recordings and AI features.`,
    },
    '/sip': {
      title: `SIP Phone Numbers for Softphones & Desk Phones · ${BRAND}`,
      desc: sipDesc(),
    },
  }
  const indexable = !(p.startsWith('/app') || p.startsWith('/reset-password') || p === '/help')
  const meta = pages[p] || pages['/']
  return { ...meta, path: p === '/' ? '/' : p, url: `${CANONICAL}${p === '/' ? '/' : p}`, indexable }
}

// ── JSON-LD structured data ──────────────────────────────────────────────────
function jsonLd(pathname) {
  const m = metaFor(pathname)
  const c = cat()
  const nodes = [
    {
      '@type': 'Organization',
      '@id': `${CANONICAL}/#organization`,
      name: BRAND,
      url: CANONICAL,
      logo: LOGO,
      description: tagline(),
    },
    {
      '@type': 'WebSite',
      '@id': `${CANONICAL}/#website`,
      name: BRAND,
      url: CANONICAL,
      publisher: { '@id': `${CANONICAL}/#organization` },
    },
  ]

  // SoftwareApplication with plan pricing (helps assistants summarise the offer accurately).
  const app = {
    '@type': 'SoftwareApplication',
    '@id': `${CANONICAL}/#app`,
    name: BRAND,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Cloud phone, IVR & virtual numbers',
    operatingSystem: 'Web, iOS, Android (browser)',
    url: CANONICAL,
    description: tagline(),
    featureList: FEATURES.map(([t]) => t),
    publisher: { '@id': `${CANONICAL}/#organization` },
  }
  if (c && c.plans && c.plans.length) {
    const prices = c.plans.map((p) => Number(p.price) || 0)
    app.offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: String(Math.min(...prices)),
      highPrice: String(Math.max(...prices)),
      offerCount: String(c.plans.length),
      offers: c.plans.map((p) => ({
        '@type': 'Offer',
        name: `${p.name} plan`,
        price: String(Number(p.price) || 0),
        priceCurrency: 'USD',
        url: `${CANONICAL}/signup`,
        category: 'Subscription (per number, per month)',
      })),
    }
  }
  nodes.push(app)

  // FAQ only where the FAQ actually renders: the home page and the SIP page.
  const faqList = m.path === '/' ? faqs() : m.path === '/sip' ? sipFaqs() : null
  if (faqList) {
    nodes.push({
      '@type': 'FAQPage',
      '@id': `${m.url}#faq`,
      mainEntity: faqList.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    })
  }
  const graph = { '@context': 'https://schema.org', '@graph': nodes }
  // Escape "<" so a stray "</script>" in any text can never close the tag early.
  return JSON.stringify(graph).replace(/</g, '\\u003c')
}

// ── <head> tag string ────────────────────────────────────────────────────────
function headTags(pathname) {
  const m = metaFor(pathname)
  const robots = m.indexable ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow'
  const share = m.share || m.desc
  const authPage = m.path === '/login' || m.path === '/signup'
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.desc)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<meta name="keywords" content="virtual phone number, IVR, cloud phone, AI voice agent, call forwarding, voicemail, SMS, toll-free number, SIP, CloudIVR" />`,
    `<meta name="application-name" content="${BRAND}" />`,
    `<meta name="theme-color" content="#0a0a0a" />`,
    `<link rel="canonical" href="${esc(m.url)}" />`,
    // Open Graph
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(share)}" />`,
    `<meta property="og:url" content="${esc(m.url)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:secure_url" content="${OG_IMAGE}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${BRAND} — virtual phone numbers, IVR and AI voice agents" />`,
    `<meta property="og:locale" content="en_US" />`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(share)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    // Icons (brand)
    `<link rel="icon" type="image/png" href="/civr/brand/parrot-icon-48.png" />`,
    `<link rel="apple-touch-icon" href="/civr/brand/apple-touch-icon.png" />`,
    // Sign-in pages: fetch Google's sign-in script while the app boots, so the Google button paints at once.
    ...(authPage ? ['<link rel="preconnect" href="https://accounts.google.com" />', '<link rel="preload" as="script" href="https://accounts.google.com/gsi/client" />'] : []),
    // AI-readable overview
    `<link rel="alternate" type="text/markdown" href="${CANONICAL}/llms.txt" title="${BRAND} — overview for AI assistants" />`,
    // JSON-LD structured data
    `<script type="application/ld+json">${jsonLd(pathname)}</script>`,
  ].join('')
}

// ── Crawlable <noscript> overview (read by AI crawlers that don't run JS) ─────
function bodyNoscript() {
  const c = cat()
  const start = startPrice(c)
  const minTopup = c && c.minTopup != null ? usd(c.minTopup) : '$10'
  const extra = c && c.extraNumber ? usd(c.extraNumber.price) : null
  const r = (c && c.rates) || {}

  const featuresHtml = FEATURES.map(([t, d]) => `<li><strong>${esc(t)}:</strong> ${esc(d)}</li>`).join('')
  const howHtml = HOW.map(([t, d]) => `<li><strong>${esc(t)}.</strong> ${esc(d)}</li>`).join('')
  const faqHtml = faqs().map(([q, a]) => `<section><h3>${esc(q)}</h3><p>${esc(a)}</p></section>`).join('')

  let pricingHtml = ''
  if (c && c.plans && c.plans.length) {
    const rows = c.plans.map((p) => {
      const feats = (p.webFeatures || []).filter((f) => f.included).map((f) => f.label)
      return `<li><strong>${esc(p.name)} — ${esc(usd(p.price))}/month per number.</strong> ${esc(p.minutes)} incoming minutes and ${esc(p.sms)} SMS included each month.${feats.length ? ' Includes: ' + esc(feats.join(', ')) + '.' : ''}</li>`
    }).join('')
    const usage = []
    if (r.overagePerMin != null) usage.push(`extra incoming minutes ${perMin(r.overagePerMin)}/min`)
    if (r.overagePerSms != null) usage.push(`extra SMS ${perMin(r.overagePerSms)} each`)
    if (r.forwardingPerMin != null) usage.push(`forwarding to a phone ${perMin(r.forwardingPerMin)}/min`)
    if (r.aiAgentPerMin != null) usage.push(`AI voice agent ${perMin(r.aiAgentPerMin)}/min`)
    pricingHtml =
      `<h2>Pricing</h2>` +
      `<p>Free to sign up. Plans are billed monthly per number — pay with crypto or from your CloudIVR wallet (top up from ${esc(minTopup)}; cards coming soon). Auto-renew keeps your number; cancel any time. No contracts.</p>` +
      `<ul>${rows}</ul>` +
      (usage.length ? `<p>Usage beyond your plan is billed from your wallet: ${esc(usage.join(', '))}. Outgoing calls show their price before you dial.${extra ? ` Extra numbers cost from ${esc(extra)}/month each and share a plan's minutes and SMS.` : ''}</p>` : '')
  } else {
    pricingHtml = `<h2>Pricing</h2><p>Free to sign up. Numbers are billed monthly per number and paid with crypto or from your CloudIVR wallet. Auto-renew keeps your number; cancel any time.</p>`
  }

  const html =
    `<noscript>` +
    `<div style="max-width:60rem;margin:0 auto;padding:2rem;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#0a0d0e">` +
    `<h1>${BRAND} — virtual phone numbers, IVR &amp; AI voice agents</h1>` +
    `<p>${esc(tagline())}</p>` +
    `<p><a href="/signup">Create a free account</a> · <a href="/login">Sign in</a>${start != null ? ` · Numbers from ${esc(usd(start))}/month` : ''}</p>` +
    `<h2>What CloudIVR does</h2>` +
    `<p>${BRAND} turns a virtual phone number into a full cloud phone system you run from your browser. Give callers a keypad menu or an AI voice agent, forward calls to any phone, receive SMS and voicemail, record calls, and run outbound IVR campaigns — all managed online and paid for with crypto.</p>` +
    `<h2>Features</h2><ul>${featuresHtml}</ul>` +
    `<h2>How it works</h2><ol>${howHtml}</ol>` +
    pricingHtml +
    `<h2>Frequently asked questions</h2>${faqHtml}` +
    `<p><a href="/llms.txt">Overview for AI assistants (llms.txt)</a></p>` +
    `</div></noscript>`
  return html
}

// ── Inject SEO head + crawlable body into the shared SPA index.html ──────────
function injectIndex(rawHtml, pathname) {
  let out = String(rawHtml || '')
  // Remove the shared build's hosting-panel title/description/theme-color so only CloudIVR's remain.
  out = out.replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<meta\s+name="theme-color"[^>]*>/i, '')
  const head = headTags(pathname)
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${head}</head>`)
  else if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}${head}`)
  else out = `${head}${out}`
  const body = bodyNoscript()
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${body}</body>`)
  return out
}

// ── robots.txt — explicitly welcomes AI assistants + search engines ──────────
function robotsTxt() {
  const agents = [
    '*',
    // OpenAI / ChatGPT
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
    // Anthropic / Claude
    'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', 'Claude-Web',
    // Perplexity
    'PerplexityBot', 'Perplexity-User',
    // Google (incl. AI / Gemini), Bing, Apple, DuckDuckGo
    'Googlebot', 'Google-Extended', 'Bingbot', 'Applebot', 'Applebot-Extended', 'DuckDuckBot',
    // Common Crawl (feeds many LLMs) + other assistants
    'CCBot', 'Amazonbot', 'Meta-ExternalAgent', 'cohere-ai', 'YouBot', 'Bytespider', 'Diffbot',
  ]
  const block = (ua) => [
    `User-agent: ${ua}`,
    'Allow: /',
    'Disallow: /app/',
    'Disallow: /api/',
    'Disallow: /cloudivr-web/',
    'Disallow: /reset-password',
  ].join('\n')
  return [
    `# ${BRAND} — ${CANONICAL}`,
    '# AI assistants and search engines are welcome to read, index and cite this site.',
    '# Full written overview for assistants: /llms.txt and /llms-full.txt',
    '',
    agents.map(block).join('\n\n'),
    '',
    `Sitemap: ${CANONICAL}/sitemap.xml`,
    `Host: ${DOMAIN}`,
    '',
  ].join('\n')
}

// ── llms.txt — short, link-first overview (emerging standard) ────────────────
function llmsTxt() {
  const c = cat()
  const start = startPrice(c)
  return [
    `# ${BRAND}`,
    '',
    `> ${tagline()}`,
    '',
    `${BRAND} is a cloud phone platform. You buy a virtual phone number and run it entirely online: give callers a keypad menu (IVR) or an AI voice agent, forward calls, take SMS and voicemail, record calls, use a browser phone or SIP, and run outbound IVR campaigns. Accounts are free; numbers are billed monthly per number${start != null ? ` from ${usd(start)}/month` : ''} and paid with cryptocurrency.`,
    '',
    '## Key pages',
    `- [Home](${CANONICAL}/): product overview, live demo call, features, pricing and FAQ`,
    `- [SIP numbers](${CANONICAL}/sip): use a CloudIVR number on any SIP softphone or desk phone — setup, plans and FAQ`,
    `- [Sign up](${CANONICAL}/signup): create a free account and get a number`,
    `- [Sign in](${CANONICAL}/login): access the dashboard`,
    '',
    '## Features',
    ...FEATURES.map(([t, d]) => `- ${t}: ${d}`),
    '',
    '## Detailed overview',
    `- [Full overview, pricing and FAQ](${CANONICAL}/llms-full.txt)`,
    '',
  ].join('\n')
}

// ── llms-full.txt — the complete written overview in Markdown ────────────────
function llmsFullTxt() {
  const c = cat()
  const start = startPrice(c)
  const minTopup = c && c.minTopup != null ? usd(c.minTopup) : '$10'
  const extra = c && c.extraNumber ? usd(c.extraNumber.price) : null
  const r = (c && c.rates) || {}
  const lines = []
  lines.push(`# ${BRAND} — full overview`, '', `> ${tagline()}`, '')
  lines.push(`## What ${BRAND} is`,
    `${BRAND} turns a virtual phone number into a complete cloud phone system that you set up and run from your web browser — no hardware and no app to install. It is aimed at businesses and individuals who want a professional phone presence: an auto-attendant keypad menu or an AI voice agent to answer calls, call forwarding, voicemail, an SMS inbox, call recording, and automated outbound calls and campaigns. Accounts are paid with crypto or from a prepaid wallet; card payments are coming soon.`, '')
  lines.push('## Features')
  FEATURES.forEach(([t, d]) => lines.push(`- **${t}** — ${d}`))
  lines.push('')
  lines.push('## How it works')
  HOW.forEach(([t, d], i) => lines.push(`${i + 1}. **${t}.** ${d}`))
  lines.push('')
  lines.push('## Pricing')
  lines.push(`Creating an account is free. Each number is billed monthly on the plan you choose and paid with crypto or from a CloudIVR wallet you top up (from ${minTopup}); card payments are coming soon. Numbers auto-renew and can be cancelled any time. There are no contracts.`, '')
  if (c && c.plans && c.plans.length) {
    c.plans.forEach((p) => {
      const feats = (p.webFeatures || []).filter((f) => f.included).map((f) => f.label)
      lines.push(`- **${p.name} — ${usd(p.price)}/month per number.** ${p.minutes} incoming minutes and ${p.sms} SMS included per month.${feats.length ? ' Includes: ' + feats.join(', ') + '.' : ''}`)
    })
    lines.push('')
    const usage = []
    if (r.overagePerMin != null) usage.push(`extra incoming minutes ${perMin(r.overagePerMin)}/min`)
    if (r.overagePerSms != null) usage.push(`extra SMS ${perMin(r.overagePerSms)} each`)
    if (r.forwardingPerMin != null) usage.push(`calls forwarded to a phone ${perMin(r.forwardingPerMin)}/min`)
    if (r.aiAgentPerMin != null) usage.push(`AI voice agent calls ${perMin(r.aiAgentPerMin)}/min`)
    if (usage.length) lines.push(`Usage beyond your plan is billed from your wallet: ${usage.join(', ')}. Outgoing calls (browser phone, SIP, Quick IVR, campaigns and AI agent) are billed per minute and show the price before you dial.${extra ? ` Extra numbers cost from ${extra}/month each and share the plan's minutes and SMS.` : ''}`, '')
  }
  lines.push('## Frequently asked questions')
  faqs().forEach(([q, a]) => lines.push(`### ${q}`, a, ''))
  lines.push('## Links')
  lines.push(`- Home: ${CANONICAL}/`)
  lines.push(`- Sign up (free): ${CANONICAL}/signup`)
  lines.push(`- Sign in: ${CANONICAL}/login`)
  lines.push('')
  return lines.join('\n')
}

// ── sitemap.xml — the public pages ───────────────────────────────────────────
function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10)
  const urls = [
    { loc: `${CANONICAL}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `${CANONICAL}/sip`, priority: '0.9', changefreq: 'weekly' },
    { loc: `${CANONICAL}/signup`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${CANONICAL}/login`, priority: '0.5', changefreq: 'monthly' },
    { loc: `${CANONICAL}/terms`, priority: '0.3', changefreq: 'yearly' },
  ]
  const body = urls.map((u) =>
    `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
  ).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

module.exports = {
  CANONICAL, DOMAIN, OG_IMAGE,
  injectIndex, headTags, bodyNoscript,
  robotsTxt, llmsTxt, llmsFullTxt, sitemapXml,
  faqs, sipFaqs, tagline, objectionFaqs, // exported for tests
}
