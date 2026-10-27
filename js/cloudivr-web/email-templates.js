'use strict'
// Builds each CloudIVR email (subject + HTML) from its data, in the account's language. See email-copy.js for the words.
const COPY = require('./email-copy')
const L = require('./email-layout')

const PLAN_NAMES = { starter: 'Starter', pro: 'Pro', business: 'Business' }
const NEXT = { starter: 'pro', pro: 'business' }
const LOCALE = { en: 'en-US', fr: 'fr-FR', es: 'es-ES' }
const RATE = { us: 0.15, intl: 0.5 }
const enc = encodeURIComponent
const planName = (k) => PLAN_NAMES[k] || String(k || '')
const P = (text) => L.p(L.esc(text))

function fmt(lang) {
  const loc = LOCALE[lang] || LOCALE.en
  return {
    usd: (n) => new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(Math.round(Number(n || 0) * 100) / 100),
    date: (x) => new Date(x).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    short: (x) => new Date(x).toLocaleDateString(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    dt: (x) => `${new Date(x).toLocaleString(loc, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`,
    dur: (s) => {
      const n = Math.max(0, Math.round(Number(s) || 0)), m = Math.floor(n / 60), r = n % 60
      return lang === 'en' ? (m ? `${m}m ${r}s` : `${r}s`) : (m ? `${m} min ${r} s` : `${r} s`)
    },
  }
}

const call = (v, ...a) => (typeof v === 'function' ? v(...a) : v)
const head = (k, d, f) => ({ subject: call(k.subject, d, f), preheader: call(k.preheader, d, f), eyebrow: call(k.eyebrow, d, f), title: call(k.title, d, f) })

function upsell(c, plan, x) {
  const next = NEXT[plan]
  if (!next) return ''
  return L.h2(c.upsell.title(planName(next))) + L.bullets(c.adds[next]) + L.p(L.link(c.upsell.cta(planName(next)), x.app(`/app/buy?plan=${next}`)), 'margin-top:8px')
}

const B = {
  welcome: (d, c, f, x) => ({ ...head(c.welcome, d, f), t: 'brand',
    body: P(c.welcome.intro(d, f)) + L.steps(c.welcome.steps) + L.button(c.welcome.cta(d), x.app('/app/buy')) + L.small(c.welcome.ps) }),

  numberLive: (d, c, f, x) => ({ ...head(c.numberLive, d, f), t: 'ok',
    body: P(c.numberLive.intro(d, f))
      + L.rows([{ k: c.labels.number, v: L.mono(d.phone), html: true }, { k: c.labels.plan, v: d.planName }, d.country && { k: c.labels.country, v: d.country }, d.expiresAt && { k: c.labels.renews, v: f.date(d.expiresAt) }, d.price != null && { k: c.labels.monthly, v: f.usd(d.price) }])
      + L.h2(c.numberLive.nextTitle) + L.bullets(c.numberLive.next[d.plan] || c.numberLive.next.starter, 'ok')
      + L.button(c.numberLive.cta(d), x.app(`/app/numbers/${enc(d.phone)}`)) + upsell(c, d.plan, x) }),

  renewed: (d, c, f, x) => ({ ...head(c.renewed, d, f), t: 'ok',
    body: P(c.renewed.intro(d, f))
      + L.rows([{ k: c.labels.number, v: L.mono(d.phone), html: true }, { k: c.labels.plan, v: d.planName }, { k: c.labels.paid, v: f.usd(d.amount) }, d.expiresAt && { k: c.labels.next, v: f.date(d.expiresAt) }, { k: c.labels.balance, v: f.usd(d.balance) }])
      + L.button(c.renewed.cta(d), x.app(`/app/numbers/${enc(d.phone)}?tab=billing`)) + upsell(c, d.plan, x) }),

  upgraded: (d, c, f, x) => ({ ...head(c.upgraded, d, f), t: 'brand',
    body: P(c.upgraded.intro(d, f))
      + L.bullets([...(d.from === 'starter' ? c.adds.pro : []), ...(d.to === 'business' ? c.adds.business : [])], 'ok')
      + L.rows([{ k: c.labels.number, v: L.mono(d.phone), html: true }, { k: c.labels.plan, v: d.toName }, d.amount != null && { k: c.labels.paid, v: f.usd(d.amount) }])
      + L.button(c.upgraded.cta(d), x.app(`/app/numbers/${enc(d.phone)}`)) + upsell(c, d.to, x) }),

  renewSoon: (d, c, f, x) => {
    const v = !d.autoRenew ? 'manual' : d.shortfall > 0 ? 'short' : 'ok', k = c.renewSoon[v]
    const href = v === 'short' ? x.app(`/app/wallet?need=${Math.ceil(d.shortfall)}`) : x.app(`/app/numbers/${enc(d.phone)}?tab=billing`)
    return { subject: k.subject(d, f), preheader: c.renewSoon.preheader(d, f), eyebrow: c.renewSoon.eyebrow, title: k.title, t: v === 'ok' ? 'ok' : 'warn',
      body: P(k.intro(d, f))
        + L.rows([{ k: c.labels.number, v: L.mono(d.phone), html: true }, { k: c.labels.plan, v: d.planName }, { k: c.labels.renews, v: f.date(d.expiresAt) }, { k: c.labels.monthly, v: f.usd(d.price) }, { k: c.labels.balance, v: f.usd(d.balance) }])
        + L.button(k.cta, href, v === 'ok' ? 'brand' : 'warn') }
  },

  renewFailed: (d, c, f, x) => ({ ...head(c.renewFailed, d, f), t: 'bad',
    body: P(c.renewFailed.intro(d, f)) + L.callout(L.esc(c.renewFailed.after), 'bad') + L.button(c.renewFailed.cta(d), x.app(`/app/wallet?need=${Math.ceil(d.shortfall)}`), 'bad') }),

  suspended: (d, c, f, x) => ({ ...head(c.suspended, d, f), t: 'bad',
    body: P(c.suspended.intro(d, f)) + L.button(c.suspended.cta(d), x.app(`/app/numbers/${enc(d.phone)}?tab=billing`), 'bad') }),

  topup: (d, c, f, x) => ({ ...head(c.topup, d, f), t: 'ok',
    body: P(c.topup.intro(d, f))
      + L.stats([{ label: c.labels.added, value: f.usd(d.amount) }, { label: c.labels.newBalance, value: f.usd(d.balance), t: 'ok' }], 2)
      + L.h2(c.topup.getsTitle(d, f)) + L.bullets(c.topup.gets(Math.floor(d.balance / RATE.us), Math.floor(d.balance / RATE.intl)), 'ok')
      + L.button(c.topup.cta(d), x.app('/app/campaigns')) + L.p(L.link(c.topup.wallet, x.app('/app/wallet'))) }),

  lowBalance: (d, c, f, x) => ({ ...head(c.lowBalance, d, f), t: 'warn',
    body: P(c.lowBalance.intro(d, f)) + L.stats([{ label: c.labels.balance, value: f.usd(d.balance), t: 'warn' }], 1)
      + (d.next ? L.callout(L.esc(c.lowBalance.next(d, f)), 'warn') : '')
      + L.button(c.lowBalance.cta(d), x.app('/app/wallet')) + L.small(L.esc(c.lowBalance.change)) }),

  walletEmpty: (d, c, f, x) => ({ ...head(c.walletEmpty, d, f), t: 'bad',
    body: P(c.walletEmpty.intro(d, f)) + L.bullets(c.walletEmpty.points) + L.button(c.walletEmpty.cta(d), x.app('/app/wallet'), 'bad') }),

  campaignDone: (d, c, f, x) => {
    const k = c.campaignDone, s = d.stats, low = d.rate < 30
    return { ...head(k, d, f), eyebrow: d.cancelled ? k.eyebrowCancelled : k.eyebrow, t: d.cancelled ? 'warn' : 'ok',
      body: P(k.intro(d, f))
        + L.stats([
          { label: c.labels.calls, value: s.total },
          { label: c.labels.answered, value: s.answered, sub: `${d.rate}%`, t: 'ok' },
          { label: c.labels.pressed, value: s.keyPressed || 0, t: 'brand' },
          d.mode === 'transfer' && { label: c.labels.transferred, value: s.transferred || 0 },
          s.voicemail ? { label: c.labels.voicemail, value: s.voicemail } : null,
          s.voicemailLeft ? { label: c.labels.messagesLeft, value: s.voicemailLeft, t: 'ok' } : null,
          { label: c.labels.noAnswer, value: (s.noAnswer || 0) + (s.hungUp || 0) },
          { label: c.labels.failed, value: (s.failed || 0) + (s.busy || 0) },
        ], 3)
        + (d.notDialed ? L.p(L.esc(k.notDialed(d.notDialed))) : '')
        + L.callout(L.esc(low ? k.tipLow : k.tipHigh), low ? 'warn' : 'ok')
        + L.button(k.cta(d), x.app(`/app/campaigns/${enc(d.id)}`)) }
  },

  voicemail: (d, c, f, x) => ({ ...head(c.voicemail, d, f), t: 'brand',
    body: P(c.voicemail.intro(d, f)) + (d.transcript ? L.quote(d.transcript) : L.p(L.esc(c.voicemail.noText), 'color:#64748b'))
      + L.rows([{ k: c.labels.from, v: L.mono(d.from), html: true }, { k: c.labels.to, v: L.mono(d.to), html: true }, { k: c.labels.length, v: f.dur(d.duration) }])
      + L.button(c.voicemail.cta(d), x.app(`/app/numbers/${enc(d.to)}?tab=logs`)) }),

  missed: (d, c, f, x) => ({ ...head(c.missed, d, f), t: 'warn',
    body: P(c.missed.intro(d, f)) + L.rows(d.calls.slice(0, 10).map(m => ({ k: f.dt(m.at), v: L.mono(m.from), html: true })))
      + L.callout(L.esc(c.missed.tip), 'brand') + L.button(c.missed.cta(d), x.app(`/app/numbers/${enc(d.to)}?tab=logs`)) }),

  weekly: (d0, c, f, x) => {
    const k = c.weekly, d = { ...d0, range: `${f.short(d0.start)} – ${f.short(d0.end)}` }
    return { ...head(k, d, f), t: 'brand',
      body: P(k.intro(d, f))
        + L.stats([
          { label: c.labels.callsIn, value: d.callsIn }, { label: c.labels.missed, value: d.missed, t: d.missed ? 'warn' : null }, { label: c.labels.voicemails, value: d.voicemails },
          { label: c.labels.texts, value: d.smsIn + d.smsOut }, { label: c.labels.outgoing, value: d.outgoing }, { label: c.labels.minutes, value: d.minutes },
        ], 3)
        + (d.campaigns ? L.callout(L.esc(k.campaigns(d, f)), 'brand') : '')
        + (d.busiest ? L.p(L.esc(k.busiest(d, f))) : '')
        + (d.renewals.length ? L.h2(k.renewalsTitle) + L.rows(d.renewals.map(r => ({ k: r.phone, v: `${f.short(r.expiresAt)} · ${f.usd(r.price)}` })))
          + L.callout(L.esc(d.shortfall > 0 ? k.short(d, f) : k.covered(d, f)), d.shortfall > 0 ? 'warn' : 'ok') : '')
        + L.button(k.cta(d), x.app(d.quiet ? '/app/quick-call' : '/app'))
        + (NEXT[d.plan] ? upsell(c, d.plan, x) : L.callout(`${L.esc(c.refer.text)}<br>${L.link(c.refer.cta, x.app('/app/settings'))}`, 'brand')) }
  },
}

const TYPES = Object.keys(B)

// ctx = { lang, name, email, base, app(path) → url, group, offUrl, supportUrl }
function render(type, d, ctx) {
  const lang = COPY[ctx.lang] ? ctx.lang : 'en'
  const c = COPY[lang], f = fmt(lang)
  const m = B[type](d, c, f, ctx)
  const body = L.p(L.esc(c.hi(ctx.name)), 'font-weight:600;color:#0f172a') + m.body
  const html = L.layout({
    lang, preheader: m.preheader, eyebrow: m.eyebrow, title: m.title, t: m.t, body, base: ctx.base,
    foot: { why: c.foot.why(ctx.email), settings: [c.foot.settings, ctx.app('/app/settings#emails')], off: ctx.group && ctx.offUrl ? [c.foot.off[ctx.group], ctx.offUrl] : null, support: ctx.supportUrl ? [c.foot.support, ctx.supportUrl] : null },
  })
  return { subject: m.subject, html }
}

// Page behind the "stop these emails" link: 'ask' (confirm button), 'done' or 'bad' (wrong / old link).
function offPage(lang, group, state, ctx) {
  const c = (COPY[lang] || COPY.en).off, what = c.what[group]
  const form = `<form method="post" action="${L.esc(ctx.action)}" style="margin:28px 0 8px"><button type="submit" style="border:0;cursor:pointer;border-radius:999px;background:#4f46e5;padding:15px 30px;font:700 16px/1 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#ffffff">${L.esc(c.ask.button)}</button></form>`
  const body = state === 'ask' ? P(c.ask.body(what)) + form + L.p(L.link(c.back, ctx.app('/app/settings#emails')))
    : (state === 'done' ? P(c.body(what)) : '') + L.button(c.back, ctx.app('/app/settings#emails'))
  return L.layout({ lang, title: state === 'ask' ? c.ask.title : state === 'done' ? c.title : c.bad, t: state === 'bad' ? 'bad' : 'brand', base: ctx.base, body, foot: { why: '' } })
}

module.exports = { render, offPage, TYPES, planName, fmt }
