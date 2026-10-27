// Unit: js/ai-agent/opening.js + bridge.instructions() (run from /app: node backend/tests/test_ai_opening_unit.js)
const assert = require('assert')
const o = require('../../js/ai-agent/opening')
const { instructions } = require('../../js/ai-agent/bridge')
let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log('PASS', n) } catch (e) { fail++; console.log('FAIL', n, e.message) } }

t('fill tokens', () => assert.strictEqual(o.fill('Hi {lead_name|there} {name} {business}', { name: 'Ava', business: 'SD', leadName: 'Bo' }), 'Hi Bo Ava SD'))
t('fill fallback', () => assert.strictEqual(o.fill('Hi {lead_name|there}', { name: 'Ava' }), 'Hi there'))
t('fill [First Name]', () => assert.strictEqual(o.fill('Hi [First Name]!', { leadName: 'Bo' }), 'Hi Bo!'))
t('stripNotes', () => assert.strictEqual(o.stripNotes('Hello. [PAUSE] How are you? [PAUSE BRIEFLY for reply] ok'), 'Hello. How are you? ok'))
t('stripNotes caps paren', () => assert.ok(!o.stripNotes('Hi (WAIT FOR ANSWER) there').includes('WAIT')))
const agent = { name: 'Ava', businessName: 'Sunrise Dental', language: 'en', goal: 'Hi [Client Full Name], this is Ava. [PAUSE] Ask [First Name] about a cleaning. [PAUSE BRIEFLY to let them answer] Then book.', firstMessage: 'Hi, may I speak with {lead_name}?' }
t('openingInfo custom', () => {
  const i = o.openingInfo(agent, 'outbound', true, 'Alex')
  assert.strictEqual(i.text, "Hi, I'm Ava, an AI assistant. This call may be recorded. May I speak with Alex?")
  assert.ok(i.aiAdded && i.recAdded && i.custom)
})
t('openingInfo inbound no lead', () => assert.ok(o.openingInfo(agent, 'inbound', false).text.includes('the right person')))
t('openingInfo empty msg standard', () => assert.strictEqual(o.openingInfo({ ...agent, firstMessage: '' }, 'outbound', false).custom, false))
t('openingInfo only notes -> standard', () => assert.strictEqual(o.openingInfo({ ...agent, firstMessage: '[PAUSE]' }, 'outbound', false).custom, false))
t('prepare', () => {
  const p = o.prepare(agent.goal, agent, 'Alex')
  assert.ok(!/\[|PAUSE/.test(p), p); assert.ok(p.includes('Hi Alex') && p.includes('Ask Alex'), p)
})
t('prepare no lead', () => assert.ok(o.prepare('Ask [First Name] now', agent, null).includes('the person')))
t('instructions', () => {
  const s = instructions(agent, { direction: 'outbound', leadName: 'Alex', record: true })
  assert.ok(s.includes('# How the call started'))
  assert.ok(s.includes(`"Hi, I'm Ava, an AI assistant. This call may be recorded. May I speak with Alex?"`))
  assert.ok(s.includes('You have already greeted and introduced yourself; never greet or introduce yourself again.'))
  const goal = s.split('# Your goal\n')[1].split('\n')[0]
  assert.ok(!/PAUSE|\[/.test(goal), goal); assert.ok(goal.includes('Hi Alex') && goal.includes('Ask Alex'), goal)
})
t('no screen module', () => { assert.throws(() => require('../../js/ai-agent/screen')) })
console.log(`RESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
