const assert = require('assert')
const { unexplained, parseOp } = require('../wallet-audit')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('✓', name) } catch (e) { fail++; console.log('✗', name, e.message) } }
const at = (s) => new Date(`2026-11-11T01:${s}Z`)

t('a deposit with its transaction is explained', () => {
  assert.strictEqual(unexplained([{ amt: 402, at: at('01:29') }], [{ a: 402, at: at('01:29') }]).length, 0)
})
t('the unrecorded $5 bonus is flagged', () => {
  const u = unexplained([{ amt: 402, at: at('01:29') }, { amt: 5, at: at('01:30') }], [{ a: 402, at: at('01:29') }])
  assert.deepStrictEqual(u.map((x) => x.amt), [5])
})
t('a failed purchase refunded seconds later cancels out', () => {
  assert.strictEqual(unexplained([{ amt: -25, at: at('00:06') }, { amt: 25, at: at('00:06') }, { amt: -25, at: at('00:13') }], [{ a: 25, at: at('00:13') }]).length, 0)
})
t('one record explains only one change', () => {
  assert.strictEqual(unexplained([{ amt: -0.15, at: at('02:00') }, { amt: -0.15, at: at('02:01') }], [{ a: 0.15, at: at('02:00') }]).length, 1)
})
t('a record far outside the time window does not count', () => {
  assert.strictEqual(unexplained([{ amt: -120, at: at('00:00') }], [{ a: 120, at: new Date('2026-11-11T02:00:00Z') }]).length, 1)
})
t('parses diff updates, $set and inserts', () => {
  assert.deepStrictEqual(parseOp({ op: 'u', o2: { _id: '1' }, o: { $v: 2, diff: { u: { usdIn: 10 } } } }).fields, { usdIn: 10 })
  assert.deepStrictEqual(parseOp({ op: 'u', o2: { _id: '1' }, o: { $set: { usdOut: 3 } } }).fields, { usdOut: 3 })
  assert.deepStrictEqual(parseOp({ op: 'i', o: { _id: '1', usdIn: 0, usdOut: 0 } }).fields, { usdIn: 0, usdOut: 0 })
  assert.strictEqual(parseOp({ op: 'u', o2: { _id: '1' }, o: { $v: 2, diff: { u: { name: 'x' } } } }), null)
})
t('card-check hold writes are marked', () => {
  assert.strictEqual(parseOp({ op: 'u', o2: { _id: '1' }, o: { $v: 2, diff: { u: { usdHeld: 0, usdOut: 96.5 } } } }).held, true)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
