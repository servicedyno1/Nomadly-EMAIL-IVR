#!/usr/bin/env node
// Scenario H (iteration_109 retest): fix 3 (no "Purchasing your number" before verification intro),
// fix 5 (sub-number blocked BEFORE payment at country select + number select), fix 8 (hub shows ₦ amount for bank sessions),
// fix 9 (number-gone retry reuses address id + doc ids → single POST /addresses + /documents)
const H = require('./tx_payfirst_harness')
const { check, strip, txt, last } = H
const near = (a, b) => Math.abs(a - b) < 0.01
const run = k => !process.argv[2] || process.argv[2].split(',').includes(k)
;(async () => {
  await H.connect()
  const users = []
  try {
    if (run('purch')) {
      const U = '990300101'; users.push(U)
      for (const cc of ['NL', 'GB']) {
        await H.seed(U, cc, 'mobile')
        const { afterPay } = await H.selectAndPay(U)
        const t = txt(afterPay)
        check(`H1 ${cc} wallet pay → NO "Purchasing your number" msg`, !/Purchasing your number/i.test(t), t.slice(0, 400))
        check(`H2 ${cc} wallet pay → Payment received / Step 2 intro`, /Payment received/i.test(t) && /Step 2/i.test(t), t.slice(0, 400))
        check(`H2b ${cc} session collecting`, !!(await H.sess(U)))
      }
    }
    if (run('sub')) {
      const U = '990300102'; users.push(U)
      await H.cleanup(U)
      await H.db.collection('walletOf').insertOne({ _id: U, usdIn: 500, usdOut: 0 })
      await H.db.collection('state').insertOne({ _id: U, userLanguage: 'en', action: 'cpSubAddCountry', firstSessionIntentDone: true, cpSubParentNumber: '+15550001111', cpIsSubNumber: true })
      for (const name of ['🇳🇱 Netherlands', '🇬🇧 United Kingdom', '🇭🇰 Hong Kong']) {
        await H.db.collection('state').updateOne({ _id: U }, { $set: { action: 'cpSubAddCountry' } })
        const r = await H.sendText(U, name)
        const st = await H.stateOf(U)
        check(`H3 sub country select ${name} → blocked before payment`, /can.t be added as an extra number/.test(txt(r)) && st.action === 'cpSubAddCountry', txt(r).slice(0, 300) + ' action=' + st.action)
      }
      // non-verify country still proceeds to type selection
      await H.db.collection('state').updateOne({ _id: U }, { $set: { action: 'cpSubAddCountry' } })
      let r = await H.sendText(U, '🇺🇸 United States')
      check('H4 sub country select US → proceeds (type select)', (await H.stateOf(U)).action === 'cpSubAddType', txt(r).slice(0, 200) + ' action=' + (await H.stateOf(U)).action)
      // number select with live requirements (NL mobile)
      await H.db.collection('state').updateOne({ _id: U }, { $set: {
        action: 'cpSubAddNumber', cpCountryCode: 'NL', cpCountryName: '🇳🇱 Netherlands', cpNumberType: 'mobile', cpProvider: 'telnyx',
        cpSearchResults: [{ phone_number: H.NUMS.NL, _provider: 'telnyx', _bulkIvrCapable: true, _capabilities: { voice: true, sms: false } }] } })
      r = await H.sendText(U, '1', { max: 20000 })
      const st = await H.stateOf(U); const w = await H.wallet(U)
      check('H5 sub number select (NL live reqs) → blocked, no confirm step', /can.t be added as an extra number/.test(txt(r)) && st.action !== 'cpSubAddConfirm', txt(r).slice(0, 300) + ' action=' + st.action)
      check('H6 sub number select → wallet untouched, no session', near(w.usdIn, 500) && !(w.usdOut > 0) && !(await H.anySess(U)), JSON.stringify(w))
    }
    if (run('hub')) {
      const U = '990300103'; users.push(U)
      await H.seed(U, 'NL', 'mobile')
      await H.selectAndPay(U)
      await H.db.collection('telnyxRegSessions').updateOne({ chatId: U, status: 'collecting' }, { $set: { 'payment.refund': { currency: 'ngn', amount: 75000 }, 'payment.paymentMethod': 'bank_ngn' } })
      await H.sendText(U, '/start')
      const r = await H.sendText(U, '📞 Cloud IVR + SIP')
      const m = strip(last(r).text)
      check('H7 hub Incomplete Verification shows ₦75,000 for bank session', /Incomplete Verification Found/.test(m) && m.includes('₦75,000'), m)
      check('H7b hub does not show a $ price for ngn session', !/\(paid \$/.test(m), m)
      const w0 = await H.wallet(U)
      const r2 = await H.sendText(U, '❌ Cancel & Refund')
      const w1 = await H.wallet(U)
      check('H8 Cancel & Refund on ngn session → ₦75,000 credited (wallet converts NGN→USD) + ₦ msg', w1.usdIn > w0.usdIn + 1 && /₦75,000/.test(txt(r2)), JSON.stringify({ w0, w1 }) + txt(r2))
    }
    if (run('gone')) {
      const U = '990300104'; users.push(U)
      // GB mobile: has address + document requirements (exercises _addressId + _docIds reuse)
      await H.seed(U, 'GB', 'mobile')
      await H.selectAndPay(U)
      await H.walkTo(U, 'review', { ...H.DEFAULT_ANS, phone: '+447700900123', street: '10 Downing Street', city: 'London', postal: 'SW1A 2AA', country: 'GB' }, false)
      const s0 = await H.sess(U)
      const nDocs = Object.values(s0.docs || {}).filter(f => f && f.file_id).length
      await H.mtxConfig({ ...H.MTX_DEFAULT, order_error: 'Phone number +447700900001 is not available' }); await H.mtxClear()
      await H.sendText(U, '✅ Submit for verification', { max: 45000, settle: 4000 })
      const calls = await H.mtxCalls()
      const cnt = p => calls.filter(c => c.method === 'POST' && c.path === p).length
      console.log('  POST counts: addresses', cnt('/addresses'), 'documents', cnt('/documents'), 'number_orders', cnt('/number_orders'), 'requirement_groups', cnt('/requirement_groups'), 'nDocs', nDocs)
      check('H9 number gone → 2 order attempts', cnt('/number_orders') === 2, cnt('/number_orders'))
      check('H10 retry reuses address → exactly 1 POST /addresses', cnt('/addresses') === 1, cnt('/addresses'))
      check('H11 retry reuses docs → POST /documents == doc count (no dup)', cnt('/documents') === nDocs, `${cnt('/documents')} vs ${nDocs}`)
      const orders = calls.filter(c => c.method === 'POST' && c.path === '/number_orders')
      const ids = o => JSON.stringify((o.body.phone_numbers?.[0]?.regulatory_requirements || []).map(v => v.field_value).sort())
      if (orders.length === 2) check('H12 both attempts carry identical requirement values', ids(orders[0]) === ids(orders[1]), ids(orders[0]) + ' | ' + ids(orders[1]))
      const s = await H.anySess(U)
      check('H13 retry failed → refunded', s?.status === 'refunded' && near((await H.wallet(U)).usdIn, 500 + s.payment.refund.amount), s?.status)
    }
  } catch (e) { console.log('ERROR', e.stack) } finally {
    await H.mtxConfig(H.MTX_DEFAULT)
    for (const U of users) await H.cleanup(U)
    H.summaryOut(); await H.close()
  }
})()
