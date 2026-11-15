'use strict'
// Telegram bot: standalone fax numbers — list, buy (country → type → area code → number → name/address → pay), open.
// Buying, renewals and carrier registration live in fax-numbers.js (shared with the web app).
const faxNumbers = require('./fax-numbers')
const faxService = require('./fax-service')

const BTN = {
  menu: '📠 Fax Numbers', buy: '🛒 Get a Fax Number', anyArea: '🌎 Any area code', more: '🔄 Show more',
  personal: '👤 Personal', business: '🏢 Business', pay: (p) => `✅ Pay $${p}/month from wallet`, back: 'Back',
}
let api = null, pushFn = () => {}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const flag = (cc) => String(cc).toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
const countryBtn = (c) => `${flag(c.code)} ${c.name}`
const typeBtn = (t) => `${t.label}${t.paperwork !== 'none' ? ' · name + address' : ''}`

function init(db, { notifyAdmin = () => {}, push } = {}) {
  if (push) pushFn = push
  // The web app runs its own copy for routes only; this one renews numbers and checks carrier registrations.
  api = faxNumbers.create(db, { notifyAdmin, push: (id, text) => pushFn(id, text), sweep: true })
  return api
}

const faxMenuText = (n, u) => `📠 <b>Fax number</b> — ${esc(n.phoneNumber)}\n\n🆓 Free pages left this month: <b>${u.left}/${u.free}</b>\n💵 After that: <b>$${u.pagePrice}/page</b> (sent or received) from your wallet\n🔁 $${n.price}/month · ${n.autoRenew ? 'renews' : 'ends'} ${String(n.expiresAt || '').slice(0, 10)}\n\n<i>Received faxes arrive here as PDFs.</i>`

// ctx: { chatId, message, action, info, setAction, save, send, kb, openFax(num), hub(), wallet() } → true when handled.
async function handle(ctx) {
  const { chatId, message, action, info, setAction, save, send, kb } = ctx
  if (!api) return false
  const offer = api.offer()
  const back = message === BTN.back || /^(⬅️ )?Back$/i.test(String(message || ''))
  const list = async () => {
    const mine = await api.list(chatId)
    await setAction('fxnList')
    const lines = mine.map(n => `• <b>${esc(n.phoneNumber)}</b> (${n.country}) — ${n.status === 'pending_registration' ? '⏳ waiting for carrier approval' : n.status === 'past_due' ? '⚠️ paused, top up to renew' : '✅ active'}`)
    const head = `📠 <b>Fax Numbers</b>\n\nA fax-only number sends and receives faxes (no calls or texts). <b>$${offer.price}/month</b> · ${offer.freePages} free pages a month, then $${offer.pagePrice}/page.\nAvailable in ${offer.countries.length} countries.`
    return send(`${head}\n\n${lines.length ? lines.join('\n') : '<i>You have no fax numbers yet.</i>'}`, kb([...mine.filter(n => n.status !== 'released').map(n => [`📠 ${n.phoneNumber}`]), [BTN.buy]]))
  }
  if (message === BTN.menu) return list()
  if (!String(action || '').startsWith('fxn')) return false
  if (!offer.available) { await send('Fax numbers are not available right now. Please try again later.'); return true }

  const pickCountry = async () => { await setAction('fxnCountry'); return send('🌍 <b>Where should your fax number be?</b>\n\n<i>“name + address” countries: the carrier approves the number within a few days; full refund if it says no.</i>', kb(offer.countries.map(c => [countryBtn(c) + (c.types.every(t => t.paperwork !== 'none') ? ' · name + address' : '')]))) }
  const country = offer.countries.find(c => c.code === info?.fxnCountry)
  const type = country?.types.find(t => t.type === info?.fxnType) || country?.types[0]
  const doSearch = async (areaCode) => {
    await send('🔍 Searching fax numbers…')
    let r
    try { r = await api.search(chatId, country.code, areaCode, type.type) } catch (e) { return send(`⚠️ ${e.message}`, kb([])) }
    await setAction('fxnPick')
    await save('fxnResults', r.numbers.map(n => n.phoneNumber))
    if (!r.numbers.length) return send('No fax numbers found there right now. Try another area code or country.', kb([]))
    const note = r.nearbyOnly ? `ℹ️ No fax numbers in area code ${r.areaCode} right now — these are nearby.\n\n` : ''
    return send(`${note}📠 <b>Pick your fax number</b> — ${esc(country.name)}\n\n${r.numbers.slice(0, 8).map((n, i) => `${i + 1}. <code>${n.phoneNumber}</code>${n.assigned ? '… (exact number assigned when you buy)' : ''}${n.region ? ` · ${esc(n.region)}` : ''}`).join('\n')}`, kb([...r.numbers.slice(0, 8).map(n => [`📠 ${n.phoneNumber}`]), [BTN.more]]))
  }
  const askType = async () => {
    if (country.types.length > 1) { await setAction('fxnType'); return send(`📱 <b>${esc(country.name)}</b> — which kind of number?`, kb(country.types.map(t => [typeBtn(t)]))) }
    await save('fxnType', country.types[0].type)
    if (country.areaCodes) { await setAction('fxnArea'); return send('🏙️ Type a 3-digit area code (e.g. 212), or tap “Any area code”.', kb([[BTN.anyArea]])) }
    return doSearch(null)
  }
  const confirm = async () => {
    const eu = info?.fxnEndUser
    const bal = await ctx.wallet()
    await setAction('fxnConfirm')
    const reg = type.paperwork !== 'none'
    return send(`🧾 <b>Review & pay</b>\n\n📠 <b>${esc(info.fxnPick)}</b> · ${esc(country.name)} ${type.label.toLowerCase()}\n💰 <b>$${offer.price}/month</b>, renews from your wallet\n🆓 ${offer.freePages} free pages a month, then $${offer.pagePrice}/page${reg ? `\n👤 ${esc(eu?.name)} · ${esc(eu?.address)}\n\n⏳ The carrier approves this number within a few days and your month starts when it’s live. If it says no, you get a full refund.` : ''}\n\n👛 Wallet: <b>$${bal.toFixed(2)}</b>${bal < offer.price ? ` — <b>$${(offer.price - bal).toFixed(2)} short</b>. Top up with 👛 Wallet first.` : ''}`, kb(bal >= offer.price ? [[BTN.pay(offer.price)]] : []))
  }

  if (action === 'fxnList') {
    if (back) return ctx.hub()
    if (message === BTN.buy) return pickCountry()
    const own = (await api.list(chatId)).find(n => `📠 ${n.phoneNumber}` === message)
    if (own) {
      if (own.status !== 'active') return send(own.status === 'pending_registration' ? `⏳ ${own.phoneNumber} is waiting for the carrier’s approval. We’ll message you when it’s live.` : `⚠️ ${own.phoneNumber} is paused — top up your wallet to renew it.`)
      return ctx.openFax(own.phoneNumber)
    }
    return list()
  }
  if (action === 'fxnCountry') {
    if (back) return list()
    const c = offer.countries.find(x => String(message || '').startsWith(countryBtn(x)))
    if (!c) return pickCountry()
    await save('fxnCountry', c.code); await save('fxnType', null); await save('fxnEndUser', null)
    return handle({ ...ctx, action: 'fxnCountryChosen', info: { ...info, fxnCountry: c.code, fxnType: null } })
  }
  if (action === 'fxnCountryChosen') return askType()
  if (action === 'fxnType') {
    if (back) return pickCountry()
    const t = country.types.find(x => typeBtn(x) === message)
    if (!t) return askType()
    await save('fxnType', t.type)
    return handle({ ...ctx, action: 'fxnSearchNow', info: { ...info, fxnType: t.type } })
  }
  if (action === 'fxnSearchNow') return doSearch(null)
  if (action === 'fxnArea') {
    if (back) return pickCountry()
    if (message === BTN.anyArea) return doSearch(null)
    const ac = String(message || '').replace(/\D/g, '')
    if (ac.length !== 3) return send('Type a 3-digit area code (e.g. 212), or tap “Any area code”.', kb([[BTN.anyArea]]))
    return doSearch(ac)
  }
  if (action === 'fxnPick') {
    if (back) return askType()
    if (message === BTN.more) return doSearch(null)
    const phone = String(message || '').replace(/^📠\s*/, '').trim()
    if (!(info?.fxnResults || []).includes(phone)) return send('Tap one of the numbers above to pick it.')
    await save('fxnPick', phone)
    info.fxnPick = phone
    if (type.paperwork === 'none') return confirm()
    if (type.businessOnly) { await save('fxnEndUser', { type: 'business' }); await setAction('fxnName'); return send(`🏢 ${esc(country.name)} fax numbers are sold to businesses only.\n\nType your <b>company name</b>:`, kb([])) }
    await setAction('fxnWho'); return send(`👤 ${esc(country.name)} needs the name and address of who uses this number. Is it for a person or a business?`, kb([[BTN.personal], [BTN.business]]))
  }
  if (action === 'fxnWho') {
    if (back) return doSearch(null)
    if (message !== BTN.personal && message !== BTN.business) return send('Tap Personal or Business.', kb([[BTN.personal], [BTN.business]]))
    await save('fxnEndUser', { type: message === BTN.business ? 'business' : 'personal' }); await setAction('fxnName')
    return send(message === BTN.business ? 'Type your <b>company name</b>:' : 'Type your <b>full name</b>:', kb([]))
  }
  if (action === 'fxnName') {
    if (back) return doSearch(null)
    const name = String(message || '').trim().slice(0, 120)
    if (name.length < 2) return send('Type the name in full, please.')
    await save('fxnEndUser', { ...(info?.fxnEndUser || {}), name }); await setAction('fxnAddress')
    const where = type.address === 'any' ? '' : `\n\n<i>${esc(country.name)} needs an address in ${type.address === 'area' ? 'the number’s area' : esc(country.name)}.</i>`
    return send(`🏠 Type the <b>full address</b>: street and number, postcode, city, country.${where}`, kb([]))
  }
  if (action === 'fxnAddress') {
    if (back) return doSearch(null)
    const address = String(message || '').trim().slice(0, 300)
    if (address.length < 10 || !/\d/.test(address)) return send('Please type the full address, including the street number and postcode.')
    const eu = { ...(info?.fxnEndUser || {}), address }
    await save('fxnEndUser', eu)
    info.fxnEndUser = eu
    return confirm()
  }
  if (action === 'fxnConfirm') {
    if (back) return doSearch(null)
    if (message !== BTN.pay(offer.price)) return confirm()
    try {
      const r = await api.buy(chatId, { phoneNumber: info.fxnPick, autoRenew: true, endUser: type.paperwork === 'none' ? null : info.fxnEndUser })
      await save('fxnPick', null); await save('fxnEndUser', null)
      await send(r.number.status === 'pending_registration'
        ? `✅ Paid. <b>${esc(r.number.phoneNumber)}</b> is waiting for the carrier’s approval (usually a few days). We’ll message you when it can send and receive faxes. If it’s refused, you get a full refund.`
        : `✅ <b>${esc(r.number.phoneNumber)}</b> is your fax number. It can send and receive faxes now.`)
      return list()
    } catch (e) {
      await send(`⚠️ ${e.status ? e.message : 'The fax number could not be bought right now. Please try again.'}`)
      return e.code === 'search_again' ? pickCountry() : list()
    }
  }
  return false
}

module.exports = { BTN, init, handle, faxMenuText, api: () => api }
