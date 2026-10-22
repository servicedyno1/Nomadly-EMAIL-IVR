#!/usr/bin/env node
// Scenario B: NL/IL — order failure refund, number-gone retry, Cancel (double/concurrent), /cancel, resume menu, IL email, FR, sub-number block
const H = require('./tx_payfirst_harness')
const { check, strip, last, txt } = H
const only = process.argv[2]
const run = name => !only || only.split(',').includes(name)
const near = (a, b) => Math.abs(a - b) < 0.01

async function paidAt(U, cc = 'NL', type = 'mobile', opts) {
  await H.seed(U, cc, type, opts)
  const r = await H.selectAndPay(U)
  if (!(await H.sess(U))) console.log('  !! no session after pay:', H.txt(r.afterPay).slice(0, 300))
  return r
}

;(async () => {
  await H.connect()
  const users = []
  try {
    if (run('fail')) {
      const U = '990300031'; users.push(U)
      await H.mtxConfig({ ...H.MTX_DEFAULT, order_error: 'some error' }); await H.mtxClear()
      const { price } = await paidAt(U)
      await H.walkTo(U, 'review', H.DEFAULT_ANS, false)
      const r = await H.sendText(U, '✅ Submit for verification', { max: 30000, settle: 3000 })
      const s = await H.anySess(U); const w = await H.wallet(U)
      check('B1 order error → session refunded', s?.status === 'refunded', s?.status)
      check('B2 order error → wallet usdIn +price', near(w.usdIn, 500 + price), JSON.stringify(w))
      check('B3 order error → carrier couldn\'t accept msg', /carrier couldn.t accept/i.test(txt(r)) && /refunded/i.test(txt(r)), txt(r))
      check('B4 no pending order created', !(await H.db.collection('telnyxPendingOrders').findOne({ chatId: U })))
    }
    if (run('gone')) {
      const U = '990300032'; users.push(U)
      await H.mtxConfig({ ...H.MTX_DEFAULT, order_error: 'Phone number +3197000000001 is not available' }); await H.mtxClear()
      const { price } = await paidAt(U)
      await H.walkTo(U, 'review', H.DEFAULT_ANS, false)
      const r = await H.sendText(U, '✅ Submit for verification', { max: 45000, settle: 4000 })
      const orders = (await H.mtxCalls()).filter(c => c.method === 'POST' && c.path === '/number_orders')
      console.log('  ordered numbers:', orders.map(o => o.body.phone_numbers?.[0]?.phone_number))
      check('B5 number gone → retried once with a different number', orders.length === 2 && orders[0].body.phone_numbers[0].phone_number !== orders[1].body.phone_numbers[0].phone_number, orders.length)
      const s = await H.anySess(U); const w = await H.wallet(U)
      check('B6 retry also failed → refunded once', s?.status === 'refunded' && near(w.usdIn, 500 + price), s?.status + ' ' + JSON.stringify(w))
      check('B6b replacedNumber recorded', !!s?.replacedNumber, JSON.stringify({ sel: s?.selectedNumber, rep: s?.replacedNumber }))
      // retry succeeding: second POST must succeed → switch config after first call is not possible synchronously; covered by code review
    }
    await H.mtxConfig(H.MTX_DEFAULT)
    if (run('cancel')) {
      const U = '990300033'; users.push(U)
      const { price } = await paidAt(U)
      const since = Date.now()
      await Promise.all([H.post(U, { text: '❌ Cancel' }), H.post(U, { text: '❌ Cancel' })])
      const r = await H.waitMsgs(U, since, { settle: 2500 })
      const w = await H.wallet(U); const s = await H.anySess(U)
      check('B7 concurrent double Cancel → refunded exactly once', near(w.usdIn, 500 + price), JSON.stringify(w) + ' price=' + price)
      check('B8 session cancelled, action none', s?.status === 'cancelled' && (await H.stateOf(U)).action === 'none', s?.status + ' ' + (await H.stateOf(U)).action)
      check('B9 cancel message text', /Verification cancelled/.test(txt(r)) && txt(r).includes(`$${price.toFixed(2)} has been refunded to your wallet`), txt(r))
      console.log('  cancel msgs count:', r.length, r.map(c => strip(c.text).slice(0, 60)))
      await H.sendText(U, '❌ Cancel')
      check('B10 third Cancel (sequential) no extra refund', near((await H.wallet(U)).usdIn, 500 + price))
    }
    if (run('slash')) {
      const U = '990300034'; users.push(U)
      const { price } = await paidAt(U)
      await H.sendText(U, 'Maria Jansen')
      const r = await H.sendText(U, '/cancel')
      check('B11 /cancel in flow → refund + cancelled', near((await H.wallet(U)).usdIn, 500 + price) && (await H.anySess(U)).status === 'cancelled' && /cancelled/i.test(txt(r)), txt(r) + JSON.stringify(await H.wallet(U)))
      // /cancel from main menu with open paid session
      const U2 = '990300035'; users.push(U2)
      const p2 = await paidAt(U2)
      await H.db.collection('state').updateOne({ _id: U2 }, { $set: { action: 'none' } })
      const r2 = await H.sendText(U2, '/cancel')
      check('B12 /cancel from main menu with paid session → refund', near((await H.wallet(U2)).usdIn, 500 + p2.price) && (await H.anySess(U2)).status === 'cancelled', txt(r2))
    }
    if (run('resume')) {
      const U = '990300036'; users.push(U)
      const { price } = await paidAt(U)
      await H.sendText(U, 'Maria Jansen'); await H.sendText(U, '👤 Individual (no company)')
      let r = await H.sendText(U, '/start', { settle: 2500 })
      console.log('  /start →', strip(last(r).text).slice(0, 100), 'action=', (await H.stateOf(U)).action)
      check('B13 /start leaves flow (action != cpTxReg), session still collecting', (await H.stateOf(U)).action !== 'cpTxReg' && !!(await H.sess(U)))
      r = await H.sendText(U, '📞 Cloud IVR + SIP')
      const m = last(r)
      check('B14 hub shows Incomplete Verification Found + 3 buttons', /Incomplete Verification Found/.test(strip(m.text)) && ['▶️ Resume Verification', '🔄 Start Over', '❌ Cancel & Refund'].every(b => (m.buttons || []).includes(b)), strip(m.text) + JSON.stringify(m.buttons))
      check('B14b hub shows paid price', strip(m.text).includes(`$${price.toFixed(2)}`), strip(m.text))
      r = await H.sendText(U, '▶️ Resume Verification')
      let s = await H.sess(U)
      check('B15 Resume re-shows current step (phone) + action cpTxReg', s.steps[s.idx] === 'phone' && /phone/i.test(strip(last(r).text)) && (await H.stateOf(U)).action === 'cpTxReg', strip(last(r).text).slice(0, 200))
      await H.sendText(U, '+31612345678')
      await H.sendText(U, '/start'); await H.sendText(U, '📞 Cloud IVR + SIP')
      r = await H.sendText(U, '🔄 Start Over')
      s = await H.sess(U)
      check('B16 Start Over resets answers, keeps payment', s.idx === 0 && !s.profile.fullName && s.payment?.refund?.amount === price && (await H.stateOf(U)).action === 'cpTxReg' && near((await H.wallet(U)).usdIn, 500), JSON.stringify({ idx: s.idx, p: s.profile }))
      await H.sendText(U, '/start'); await H.sendText(U, '📞 Cloud IVR + SIP')
      r = await H.sendText(U, '❌ Cancel & Refund')
      check('B17 Cancel & Refund refunds', near((await H.wallet(U)).usdIn, 500 + price) && (await H.anySess(U)).status === 'cancelled' && /refunded/i.test(txt(r)), txt(r))
    }
    if (run('il')) {
      const U = '990300037'; users.push(U)
      await paidAt(U, 'IL', 'mobile')
      await H.walkTo(U, 'email', { ...H.DEFAULT_ANS, phone: '+972501234567' }, false)
      let r = await H.sendText(U, 'not-an-email')
      let s = await H.sess(U)
      check('B18 IL bad email rejected', s.steps[s.idx] === 'email' && /mail/i.test(strip(last(r).text)), strip(last(r).text))
      r = await H.sendText(U, 'Maria@Example.com')
      s = await H.sess(U)
      check('B19 IL email accepted (lowercased)', s.profile.email === 'maria@example.com' && s.steps[s.idx] === 'street', s.profile.email)
      // address that Telnyx flags invalid → addr_check buttons
      await H.sendText(U, 'Xyzzy Nowhere 99999'); await H.sendText(U, 'Qwertyville'); await H.sendText(U, '⏭ Skip'); await H.sendText(U, '9999999')
      r = await H.sendText(U, 'IL', { max: 25000, settle: 2500 })
      s = await H.sess(U)
      console.log('  IL after country:', s.steps[s.idx], JSON.stringify(s.addrCheck), JSON.stringify(last(r).buttons))
      if (s.steps[s.idx] === 'addr_check') {
        check('B20 addr_check offers Keep / Re-enter', (last(r).buttons || []).some(b => /Keep/.test(b)) && (last(r).buttons || []).some(b => /Re-enter/i.test(b)), JSON.stringify(last(r).buttons))
        r = await H.sendText(U, (last(r).buttons || []).find(b => /Re-enter/i.test(b)))
        s = await H.sess(U)
        check('B21 Re-enter → street step', s.steps[s.idx] === 'street', s.steps[s.idx])
      } else console.log('  (Telnyx validation did not flag this address invalid; addr_check UI not exercised)')
      await H.sendText(U, '/cancel')
    }
    if (run('fr')) {
      const U = '990300038'; users.push(U)
      const { summary, afterPay, price } = await paidAt(U, 'NL', 'mobile', { lang: 'fr' })
      check('B22 FR summary note', /Vérification après paiement/.test(strip(summary.text)), strip(summary.text).slice(-300))
      check('B23 FR intro', /Paiement reçu/.test(txt(afterPay)) && /Étape 2 sur 2/.test(txt(afterPay)), txt(afterPay).slice(0, 300))
      check('B24 FR cancel button', (last(afterPay).buttons || []).includes('❌ Annuler'), JSON.stringify(last(afterPay).buttons))
      const r = await H.sendText(U, '❌ Annuler')
      check('B25 FR cancel message + refund', /Vérification annulée/.test(txt(r)) && near((await H.wallet(U)).usdIn, 500 + price), txt(r))
    }
    if (run('sub')) {
      const U = '990300039'; users.push(U)
      await H.cleanup(U)
      await H.db.collection('state').insertOne({ _id: U, userLanguage: 'en', action: 'cpSubAddCountry', cpIsSubNumber: true, firstSessionIntentDone: true })
      const r = await H.sendText(U, '🇳🇱 Netherlands')
      check('B26 sub-number verify country blocked', /needs identity verification, so it can.t be added as an extra number/.test(txt(r)), txt(r))
    }
    if (run('race')) {
      // text answer + Cancel at nearly the same time → must not resurrect a cancelled session (double refund risk)
      const U = '990300040'; users.push(U)
      const { price } = await paidAt(U)
      await H.walkTo(U, 'country', H.DEFAULT_ANS, false)
      const since = Date.now()
      await Promise.all([H.post(U, { text: 'Netherlands' }), (async () => { await H.sleep(150); return H.post(U, { text: '❌ Cancel' }) })()])
      await H.waitMsgs(U, since, { settle: 4000, max: 30000 })
      const all = await H.db.collection('telnyxRegSessions').find({ chatId: U }).toArray()
      console.log('  race sessions:', all.map(x => x.status), 'wallet', JSON.stringify(await H.wallet(U)))
      check('B27 race text+Cancel: session not resurrected to collecting after cancel', !all.some(x => x.status === 'collecting') || !all.some(x => x.cancelledAt), JSON.stringify(all.map(x => ({ st: x.status, c: !!x.cancelledAt }))))
      const r2 = await H.sendText(U, '/cancel')
      check('B28 race: no second refund possible', near((await H.wallet(U)).usdIn, 500 + price), JSON.stringify(await H.wallet(U)) + ' ' + txt(r2))
    }
  } catch (e) { console.log('ERROR', e.stack) } finally {
    await H.mtxConfig(H.MTX_DEFAULT)
    if (!process.env.KEEP) for (const u of users) await H.cleanup(u)
    H.summaryOut(); await H.close()
  }
})()
