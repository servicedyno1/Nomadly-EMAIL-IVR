// Promo pipeline tests (2026-06 rewrite): copy quality, live prices, one-tap buttons,
// per-user cadence, theme segmentation, blast planning, channel post, admin preview.
// Runs against an isolated local MongoDB database — no Telegram sends.

const { MongoClient } = require('mongodb')
process.env.TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '999999'
process.env.CHAT_BOT_BRAND = process.env.CHAT_BOT_BRAND || 'Nomadly'
process.env.VPS_ENABLED = 'true'
process.env.HIDE_SMS_APP = 'false'
process.env.EMAIL_BLAST_ON = 'true'
delete process.env.APP_OPEN_API_KEY // static copy only — no OpenAI in tests
delete process.env.PROMO_CADENCE

const ap = require('../auto-promo.js')
const pc = require('../promo-copy')
const { getPromoPrices } = require('../promo-prices.js')

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

const LANGS = ['en', 'fr', 'zh', 'hi']
const COUPON = '🎁 <b>TODAY 10% OFF</b> — code <code>SAVE10</code>'

async function main() {
  const prices = getPromoPrices()

  console.log('\n[1] Prices come from config, never hardcoded')
  ok('phone starter = PHONE_STARTER_PRICE', prices.phoneStarter === `$${Number(process.env.PHONE_STARTER_PRICE || 50)}`)
  ok('hosting weekly/monthly from env', prices.hostingWeekly === `$${Number(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE || 30)}` && prices.hostingMonthly === `$${Number(process.env.PREMIUM_ANTIRED_CPANEL_PRICE || 75)}`)
  ok('lead + CNAM rates from env', prices.leadRate === `$${Number(process.env.RATE_LEAD || 0.025)}` && prices.cnamRate === `$${Number(process.env.RATE_CNAM || 0.015)}`)
  ok('VPS/RDP floors resolved from provider catalogs', /^\$\d/.test(prices.vpsFrom || '') && /^\$\d/.test(prices.rdpFrom || ''))
  ok('no null/undefined/NaN in price snapshot', !Object.values(prices).some(v => v == null || v === 'NaN' || Number.isNaN(v)))

  console.log('\n[2] Every ad: ≤ 380 visible chars, ≤ 4 emoji, no caps-shouting, no fake proof, has price + footer')
  let violations = []
  let worst = 0
  const FAKE = /competitors|already using|limited spots|this month|hundreds of|trusted by|\b\d{3,}\+ (numbers|sites|accounts|businesses)/i
  for (const lang of LANGS) for (const theme of pc.THEMES) for (const mode of ['hero', 'cross']) {
    for (let v = 0; v < pc.variantCount(theme, lang, mode); v++) {
      const r = pc.renderPromo({ theme, lang, variation: v, mode, prices, couponLine: COUPON })
      const plain = r.text.replace(/<[^>]+>/g, '')
      const len = pc.visibleLength(r.text), em = pc.emojiCount(r.text)
      worst = Math.max(worst, len)
      const shouting = /\b[A-Z]{6,}\b/.test(plain.replace(/TODAY|DMCA|CNAM|SMS|IVR|SIP|VPS|RDP|AWS|TLD|TLDs|HTML|CSV|SMTP|MX|SSL|DNS|OTP|API/g, ''))
      const problems = []
      if (len > 380) problems.push(`len=${len}`)
      if (em > 4) problems.push(`emoji=${em}`)
      if (shouting) problems.push('ALLCAPS')
      if (FAKE.test(plain)) problems.push('fake-proof')
      if (!plain.includes('/stoppromos')) problems.push('no-footer')
      if (!r.text.includes('💰')) problems.push('no-price-line')
      if (/null|undefined|NaN/.test(plain)) problems.push('bad-interp')
      if (!r.buttonLabel.endsWith('→') || !r.payload.startsWith('open_')) problems.push('bad-button')
      if (problems.length) violations.push(`${lang}/${theme}/${mode}#${v}: ${problems.join(',')}`)
    }
  }
  ok(`all ${LANGS.length * pc.THEMES.length * 2}+ variants pass copy rules (worst ${worst} chars)`, violations.length === 0, violations.slice(0, 5).join(' | '))
  ok('brand words preserved (Anti-Red / Bulletproof / DMCA-ignored) in EN hosting + domains ads',
    /Anti-Red/.test(pc.renderPromo({ theme: 'antired_hosting', lang: 'en', prices }).text) &&
    /DMCA-ignored/.test(pc.renderPromo({ theme: 'antired_hosting', lang: 'en', prices }).text) &&
    /Bulletproof/i.test(pc.renderPromo({ theme: 'domains_shortener', lang: 'en', prices }).text))
  const first = pc.renderPromo({ theme: 'cloudphone', lang: 'en', prices, couponLine: COUPON }).text.split('\n')[0]
  ok('coupon header stays first', first.startsWith('🎁'))
  const noCta = pc.renderPromo({ theme: 'cloudphone', lang: 'en', prices }).text
  ok('body never says "Type /start" (CTA is the button)', !/\/start/.test(noCta))
  ok('ad price text equals checkout price (cloudphone)', noCta.includes(`From ${prices.phoneStarter}/month`))

  console.log('\n[3] One-tap buttons + deep links')
  const kb = pc.inlineKeyboard('leads_validation', 'fr', '🎯 Ouvrir SMS Leads →')
  ok('row 1 = hub open callback', kb.inline_keyboard[0][0].callback_data === 'promo_open:leads' && kb.inline_keyboard[0][0].text.includes('→'))
  ok('row 2 = localized mute', kb.inline_keyboard[1][0].callback_data === 'promo_optout' && kb.inline_keyboard[1][0].text === pc.MUTE_BUTTON.fr)
  ok('deep link format', pc.deepLink('Nomadlybot', 'vps_rdp') === 'https://t.me/Nomadlybot?start=open_vps')
  const hubs = new Set(pc.THEMES.map(t => pc.THEME_META[t].hub))
  ok('every theme maps to a unique hub', hubs.size === pc.THEMES.length)
  const idx = require('fs').readFileSync(require('path').resolve(__dirname, '../_index.js'), 'utf8')
  const handled = [...hubs].filter(h => new RegExp(`\\b${h}:\\s*\\(\\)\\s*=>`).test(idx))
  ok(`_index.js routes all ${hubs.size} hubs via /start open_<hub>`, handled.length === hubs.size, `missing: ${[...hubs].filter(h => !handled.includes(h)).join(',')}`)
  ok('_index.js handles promo_open: callback', idx.includes("data.startsWith('promo_open:')"))

  console.log('\n[4] Cadence: one promo every other day, slot alternates weekly, deterministic')
  const day0 = new Date('2026-06-01T12:00:00Z')
  const day1 = new Date('2026-06-02T12:00:00Z')
  const ids = Array.from({ length: 2000 }, (_, i) => String(100000 + i * 7919))
  let sentDay0 = 0, both = 0, neither = 0, morning = 0
  for (const id of ids) {
    const a = ap.cadenceSlot(id, day0), b = ap.cadenceSlot(id, day1)
    if (a) sentDay0++
    if (a && b) both++
    if (!a && !b) neither++
    if (a === 'morning') morning++
  }
  ok('≈ half the users are eligible on a given day', sentDay0 > 900 && sentDay0 < 1100, `got ${sentDay0}/2000`)
  ok('nobody gets promos on two consecutive days', both === 0)
  ok('nobody is skipped two days in a row', neither === 0)
  ok('slots split roughly evenly', morning > 300 && morning < 700, `morning=${morning} of ${sentDay0}`)
  ok('deterministic for the same user/day', ap.cadenceSlot('12345', day0) === ap.cadenceSlot('12345', day0))
  let weekly = 0
  for (const id of ids.slice(0, 300)) for (let d = 0; d < 7; d++) if (ap.cadenceSlot(id, new Date(day0.getTime() + d * 86400000))) weekly++
  ok('≤ 4 promos per user per week', weekly / 300 <= 4 && weekly / 300 >= 3, `avg ${(weekly / 300).toFixed(2)}`)
  process.env.PROMO_CADENCE = 'daily'
  ok('PROMO_CADENCE=daily sends every day', !!ap.cadenceSlot('1', day0) && !!ap.cadenceSlot('1', day1))
  delete process.env.PROMO_CADENCE

  console.log('\n[5] Theme selection: browsed / cross-sell win 2 of 3 sends, then schedule, then rotation — never an owned product')
  const base = { hash: 7, dayTheme: 'marketplace', slot: 'morning', dayIndex: 1 } // tick = 4 → priority send
  ok('browsed-but-not-bought wins', ap.pickTheme({ ...base, browsed: 'vps_rdp' }).theme === 'vps_rdp')
  ok('browsed product already owned → skipped', ap.pickTheme({ ...base, browsed: 'vps_rdp', owned: new Set(['vps_rdp']) }).theme !== 'vps_rdp')
  const cs = ap.pickTheme({ ...base, owned: new Set(['leads_validation']) })
  ok('owns leads → cross-sells cloudphone in cross mode', cs.theme === 'cloudphone' && cs.mode === 'cross' && cs.reason === 'cross_sell')
  const third = ap.pickTheme({ ...base, dayIndex: 3, browsed: 'vps_rdp' }) // tick = 5 → 5 % 3 === 2 → schedule
  ok('every 3rd send falls back to the day schedule even with a browsed theme', third.theme === 'marketplace' && third.reason === 'schedule')
  ok('no signals → day schedule theme', ap.pickTheme(base).theme === 'marketplace' && ap.pickTheme(base).reason === 'schedule')
  ok('evening schedule uses cross copy', ap.pickTheme({ ...base, slot: 'evening' }).mode === 'cross')
  ok('owns scheduled theme → rotation to something else', ap.pickTheme({ ...base, owned: new Set(['marketplace']) }).theme !== 'marketplace')
  const allOwned = new Set(pc.THEMES)
  ok('owns everything → null (nothing to offer)', ap.pickTheme({ ...base, owned: allOwned }) === null)
  ok('disabled themes never picked', ap.pickTheme({ ...base, browsed: 'vps_rdp', env: { VPS_ENABLED: 'false' } }).theme !== 'vps_rdp')
  const dist = {}
  for (let h = 0; h < 200; h++) { const t = ap.pickTheme({ ...base, hash: h, owned: new Set(['marketplace']) }).theme; dist[t] = (dist[t] || 0) + 1 }
  ok('marketplace owner: mostly refer_earn cross-sell, rest rotates across themes', dist.refer_earn > 100 && Object.keys(dist).length >= 5, JSON.stringify(dist))

  console.log('\n[6] Blast planning against a seeded database (ownership + browse probes)')
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017')
  await client.connect()
  const db = client.db('autopromo_pipeline_test')
  await db.dropDatabase()
  await db.collection('state').insertMany([
    { _id: 'u_hosting', userLanguage: 'en' }, { _id: 'u_leads', userLanguage: 'en' }, { _id: 'u_browse', userLanguage: 'en' }, { _id: 'u_plain', userLanguage: 'en' },
  ])
  await db.collection('cpanelAccounts').insertOne({ _id: 'cpuser1', chatId: 'u_hosting', plan: 'Premium' })
  await db.collection('leadJobs').insertOne({ chatId: 'u_leads', status: 'done' })
  await db.collection('phoneNumbersOf').insertOne({ _id: 'u_leads', val: { numbers: [] } }) // empty → not owned
  await db.collection('browseTracking').insertOne({ chatId: 'u_browse', lastCategory: 'vps', browseCount: { vps: 3, hosting: 1 } })
  const sent = []
  const bot = {
    sendMessage: async (chatId, text, opts) => { sent.push({ chatId, text, opts }); return {} },
    sendPhoto: async (chatId, file, opts) => { sent.push({ chatId, text: opts?.caption, opts, photo: file }); return {} },
    getChat: async () => { throw new Error('n/a') },
    getMe: async () => ({ username: 'TestPromoBot' }),
  }
  const inst = ap.initAutoPromo(bot, db, db.collection('nameOf'), db.collection('state'), null)
  const profiles = await inst.buildProfiles(['u_hosting', 'u_leads', 'u_browse', 'u_plain'])
  ok('cpanelAccounts.chatId → owns antired_hosting', profiles.get('u_hosting')?.owned.has('antired_hosting'))
  ok('leadJobs.chatId → owns leads_validation', profiles.get('u_leads')?.owned.has('leads_validation'))
  ok('empty phoneNumbersOf.val.numbers → NOT owned', !profiles.get('u_leads')?.owned.has('cloudphone'))
  ok('browseTracking top category → browsed theme', profiles.get('u_browse')?.browsed === 'vps_rdp')
  const ids4 = ['u_hosting', 'u_leads', 'u_browse', 'u_plain']
  const now = new Date('2026-06-03T10:00:00Z')
  const plans = { morning: inst.planAudience({ targetChatIds: ids4, profiles, dayTheme: 'marketplace', slotType: 'morning', now }), evening: inst.planAudience({ targetChatIds: ids4, profiles, dayTheme: 'marketplace', slotType: 'evening', now }) }
  const planned = [...plans.morning.plan, ...plans.evening.plan]
  const byId = Object.fromEntries(planned.map(p => [p.chatId, p]))
  ok('each user planned at most once per day across both slots', planned.length === new Set(planned.map(p => p.chatId)).size)
  ok('cadence skips ≈ half per slot', plans.morning.cadenceSkipped + plans.evening.cadenceSkipped >= 4)
  if (byId.u_hosting) ok('hosting owner is not pitched hosting', byId.u_hosting.theme !== 'antired_hosting')
  if (byId.u_leads) ok('leads owner gets cloudphone cross-sell (or the schedule theme on the 3rd tick)', (byId.u_leads.theme === 'cloudphone' && byId.u_leads.mode === 'cross') || byId.u_leads.reason === 'schedule')
  if (byId.u_browse) ok('VPS browser gets vps_rdp (or the schedule theme on the 3rd tick)', (byId.u_browse.theme === 'vps_rdp' && byId.u_browse.reason === 'browsed') || byId.u_browse.reason === 'schedule')
  if (byId.u_plain) ok('no-signal user gets the schedule theme', byId.u_plain.theme === 'marketplace')

  console.log('\n[7] composePromo → exact Telegram payload')
  const composed = inst.composePromo({ theme: 'antired_hosting', lang: 'en', mode: 'hero', variation: 1, couponLine: COUPON, prices })
  ok('text has coupon, hook, 3 bullets, price, footer', composed.text.split('\n').filter(l => l.startsWith('• ')).length === 3 && composed.text.includes('💰') && composed.text.includes('/stoppromos'))
  ok('keyboard: open hub + mute', composed.reply_markup.inline_keyboard[0][0].callback_data === 'promo_open:hosting' && composed.reply_markup.inline_keyboard[1][0].callback_data === 'promo_optout')
  ok('AI override replaces hook/lines but never the price line', (() => {
    const c = inst.composePromo({ theme: 'cloudphone', lang: 'en', ai: { hook: 'Custom hook', lines: ['a', 'b', 'c'] }, prices })
    return c.text.includes('<b>Custom hook</b>') && c.text.includes('• a\n• b\n• c') && c.text.includes(`From ${prices.phoneStarter}/month`)
  })())
  ok('AI output is HTML-escaped', inst.composePromo({ theme: 'cloudphone', lang: 'en', ai: { hook: 'x <script>', lines: ['1', '2', '3'] }, prices }).text.includes('&lt;script&gt;'))

  console.log('\n[8] Channel post + admin preview')
  const post = await inst.buildChannelPost('digital_products', 'en')
  ok('channel post has URL deep-link button (works from a channel)', post.reply_markup.inline_keyboard[0][0].url === 'https://t.me/Nomadlybot?start=open_digital' || /t\.me\/.+\?start=open_digital$/.test(post.reply_markup.inline_keyboard[0][0].url))
  ok('channel post has no in-bot footer', !post.text.includes('/stoppromos'))
  ok('channel post is one product, not a laundry list', post.text.split('\n').filter(l => l.startsWith('• ')).length === 3)
  sent.length = 0
  const pv = await inst.previewPromo('999999', 'leads_validation', 'hi')
  ok('previewPromo sends exactly one message to admin', pv.success && sent.length === 1 && sent[0].chatId === '999999')
  ok('preview is localized (hi) with hub button', sent[0].text.includes('SMS Leads खोलें') || sent[0].opts.reply_markup.inline_keyboard[0][0].text.includes('खोलें'))

  console.log('\n[9] Brand banners: folder picked from CHAT_BOT_BRAND, never cross-brand')
  const savedBrand = process.env.CHAT_BOT_BRAND
  process.env.CHAT_BOT_BRAND = 'Nomadly'
  ok('Nomadly → assets/promo/nomadly/<theme>', (ap.bannerFor('cloudphone') || '').includes('/promo/nomadly/cloudphone.'))
  process.env.CHAT_BOT_BRAND = 'Smadav'
  ok('Smadav → assets/promo/smadav/<theme>', (ap.bannerFor('antired_hosting') || '').includes('/promo/smadav/antired_hosting.'))
  process.env.CHAT_BOT_BRAND = 'Smadav Bot'
  ok('"Smadav Bot" still resolves to the smadav folder (prefix match)', ap.brandSlug() === 'smadav')
  process.env.CHAT_BOT_BRAND = 'SomeOtherBrand'
  ok('unknown brand → no banner (text-only), never a wrong logo', ap.bannerFor('cloudphone') === null)
  process.env.CHAT_BOT_BRAND = savedBrand
  const heroSet = ['cloudphone', 'antired_hosting', 'vps_rdp', 'leads_validation', 'domains_shortener']
  for (const brand of ['nomadly', 'smadav']) {
    const have = heroSet.filter(t => require('fs').existsSync(require('path').resolve(__dirname, `../assets/promo/${brand}/${t}.jpg`)))
    ok(`${brand}: all 5 hero banners shipped`, have.length === 5, `have: ${have.join(',')}`)
  }
  ok('non-hero themes are text-only', ap.bannerFor('refer_earn') === null && ap.bannerFor('marketplace') === null)

  console.log('\n[10] Legacy exports still resolve')
  ok('promoMessages/crossSellMessages shaped { lang: { theme: [..] } }', Array.isArray(ap.promoMessages.en.cloudphone) && Array.isArray(ap.crossSellMessages.fr.antired_hosting))
  ok('_promoRetestTtlDays unchanged', ap._promoRetestTtlDays('bot_blocked', 2) === 30 && ap._promoRetestTtlDays('user_deactivated') === Infinity)

  await db.dropDatabase()
  await client.close()
  console.log(`\n──────────────────────────────\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
