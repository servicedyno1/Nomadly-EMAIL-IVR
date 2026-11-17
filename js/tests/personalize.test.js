'use strict'
const p = require('../personalize')
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }

const lead = { number: '+14155550123', name: 'Anna Lee', fields: [{ label: 'Code', value: '4821' }, { label: 'Amount', value: '$45.50' }, { label: 'Policy', value: 'A-77' }] }

ok(JSON.stringify(p.tokensIn('Hi [Name], your code [Code] and [Amount] on [Policy].')) === JSON.stringify(['Name', 'Code', 'Amount', 'Policy']), 'tokensIn lists each token once')

let r = p.fillPersonal('Hi [Name], code [Code], balance [Amount], policy [Policy].', lead, { speak: true })
ok(r.text === 'Hi Anna Lee, code 4, 8, 2, 1, balance 45 dollars and 50 cents, policy A-77.' && !r.skip && !r.missing.length, `spoken: digits + money + custom column (${r.text})`)

r = p.fillPersonal('Hi [Name], code [Code].', lead, { speak: false })
ok(r.text === 'Hi Anna Lee, code 4821.', `written keeps the code as typed (${r.text})`)

r = p.fillPersonal('Hi [Name], your [Fruit] order.', { name: 'Sam', fields: [] }, { fallback: 'there' })
ok(r.text === 'Hi Sam, your there order.' && r.missing[0] === 'Fruit' && !r.skip, 'missing value uses the fallback word')

r = p.fillPersonal('Hi [Name], your [Fruit] order.', { name: 'Sam', fields: [] }, { fallback: '' })
ok(r.skip && r.missing[0] === 'Fruit', 'missing value with no fallback marks the contact to skip')

r = p.fillPersonal('Your amount is [Amount].', { fields: [{ label: 'Total Due', value: '12' }] }, { speak: true })
ok(r.text === 'Your amount is 12 dollars.', `[Amount] matches a "Total Due" column and whole dollars drop cents (${r.text})`)

ok(p.sayMoney('€9.01') === '9 euros and 1 cent', `euros + single cent (${p.sayMoney('€9.01')})`)
ok(p.fillPersonal('Call [Name] at [Phone].', lead).text === 'Call Anna Lee at +14155550123.', 'built-in [Phone] token')

console.log('DONE'); process.exit(process.exitCode || 0)
