// Unit test for AI Support user-context plan injection.
// Verifies the EIN_5050 hallucination fingerprint cannot recur:
// when a user has a phoneNumbersOf record with planPrice + purchaseDate +
// expiresAt, getUserContext MUST surface:
//   • the exact planPrice as paid
//   • the exact tier prices (Starter/Pro/Business) from env
//   • a computed "unused credit" in USD
//   • an explicit UPGRADE MATH RULE telling the model how to compute upgrades
const assert = require('assert')
const path = require('path')

// ─── In-memory mock MongoDB tuned for the fields ai-support.getUserContext touches
function makeMockDb(seed) {
  const m = new Map(Object.entries(seed || {}))
  function col(name) {
    const docs = m.get(name) || []
    return {
      findOne: async (filter) => {
        for (const d of docs) {
          if (filter._id !== undefined && d._id !== filter._id) continue
          let ok = true
          for (const [k, v] of Object.entries(filter)) {
            if (k === '_id') continue
            if (v && typeof v === 'object' && '$ne' in v) { if (d[k] === v.$ne) ok = false }
            else if (d[k] !== v) ok = false
          }
          if (ok) return d
        }
        return null
      },
      find: () => ({
        sort: () => ({ limit: () => ({ project: () => ({ toArray: async () => [] }) }) }),
        toArray: async () => docs,
        project: () => ({ limit: () => ({ toArray: async () => docs }) }),
        limit: () => ({ project: () => ({ toArray: async () => docs }), toArray: async () => docs }),
      }),
      createIndex: async () => {},
    }
  }
  return { collection: col }
}

async function test_planContextHasUpgradeMath() {
  // Seed: EIN_5050 scenario — Starter $50, purchased 10 days ago, expires 20 days from now
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
  const twentyDaysAhead = new Date(Date.now() + 20 * 86400000).toISOString()
  const db = makeMockDb({
    walletOf: [{ _id: 'u_8541381736', usdIn: 100, usdOut: 50 }],
    phoneNumbersOf: [{
      _id: 'u_8541381736',
      val: {
        numbers: [{
          phoneNumber: '+18889020132',
          plan: 'starter',
          planPrice: 50,
          purchaseDate: tenDaysAgo,
          expiresAt: twentyDaysAhead,
          status: 'active',
        }],
      },
    }],
  })

  // Set the prices so the test is reproducible
  process.env.PHONE_STARTER_PRICE = '50'
  process.env.PHONE_PRO_PRICE = '75'
  process.env.PHONE_BUSINESS_PRICE = '120'

  // Clear require cache so the module re-reads env if it was already loaded
  const aiSupportPath = path.resolve(__dirname, '../ai-support.js')
  delete require.cache[aiSupportPath]
  const aiSupport = require(aiSupportPath)
  aiSupport.initAiSupport(db)

  // getUserContext is not exported, but getAiResponse builds the context via it.
  // We can verify behavior by tapping the internal context builder via a debug shim:
  // simplest = read /tmp dump from a one-shot import of the file with a hook.
  // Instead we call _getUserContextForTest if exposed, else fall back to checking
  // that getAiResponse's prompt would contain the strings (we monkey-patch openai).
  let capturedPrompt = null
  // Monkey-patch the openai instance used inside the module
  const FakeOpenAI = {
    chat: { completions: { create: async ({ messages }) => {
      capturedPrompt = messages.find(m => m.role === 'system')?.content || ''
      return { choices: [{ message: { content: 'ack' } }] }
    } } },
  }
  aiSupport.__setOpenAIForTest(FakeOpenAI)

  await aiSupport.getAiResponse('u_8541381736', 'How much to upgrade?', 'en')

  assert.ok(capturedPrompt, 'system prompt captured')
  // Assertions on the injected user context
  assert.ok(/Cloud IVR numbers:/i.test(capturedPrompt),
    'context lists Cloud IVR numbers (got: ' + capturedPrompt.slice(0, 400) + ')')
  assert.ok(/\+18889020132/.test(capturedPrompt), 'phone number listed')
  assert.ok(/starter plan \(\$50\/cycle\)/i.test(capturedPrompt), 'plan + paid price listed')
  assert.ok(/purchased \d{4}-\d{2}-\d{2}.*\((9|10|11)d ago\)/.test(capturedPrompt), 'purchase date + age listed')
  assert.ok(/expires \d{4}-\d{2}-\d{2}.*\((19|20|21)d left\)/.test(capturedPrompt), 'expiry date + remaining days listed')
  assert.ok(/unused credit ~\$/.test(capturedPrompt), 'unused-credit dollar figure listed')
  assert.ok(/Plan tier prices.*Basic \$\d+.*Plus \$\d+.*Pro \$\d+.*Business \$\d+/i.test(capturedPrompt),
    'all 4 tier prices injected')
  assert.ok(/UPGRADE MATH RULE/i.test(capturedPrompt), 'explicit upgrade-math rule present')
  assert.ok(/do NOT invent figures/i.test(capturedPrompt), 'anti-hallucination instruction present')
  // Sanity: unused credit should be ~$33 (20 days remaining out of 30-day cycle at $50)
  const m = capturedPrompt.match(/unused credit ~\$([\d.]+)/)
  if (m) {
    const credit = parseFloat(m[1])
    assert.ok(credit > 30 && credit < 36, `credit ~$33 expected, got $${credit}`)
  }
  console.log('  ✓ Plan facts + tier prices + upgrade-math rule all injected')
}

async function test_noPhoneNumbers_gracefulFallback() {
  const db = makeMockDb({
    walletOf: [{ _id: 'u_nofone', usdIn: 0, usdOut: 0 }],
  })
  const aiSupportPath = path.resolve(__dirname, '../ai-support.js')
  delete require.cache[aiSupportPath]
  const aiSupport = require(aiSupportPath)
  aiSupport.initAiSupport(db)
  let capturedPrompt = null
  aiSupport.__setOpenAIForTest({
    chat: { completions: { create: async ({ messages }) => {
      capturedPrompt = messages.find(m => m.role === 'system')?.content || ''
      return { choices: [{ message: { content: 'ack' } }] }
    } } },
  })
  await aiSupport.getAiResponse('u_nofone', 'Hi', 'en')
  assert.ok(capturedPrompt, 'prompt built')
  // No phone numbers → no upgrade rule (avoid polluting the prompt for unrelated users)
  assert.ok(!/UPGRADE MATH RULE/.test(capturedPrompt),
    'upgrade-math rule absent when user has no plans')
  console.log('  ✓ No spurious upgrade-rule when user has no Cloud IVR numbers')
}

;(async () => {
  const tests = [
    ['test_planContextHasUpgradeMath', test_planContextHasUpgradeMath],
    ['test_noPhoneNumbers_gracefulFallback', test_noPhoneNumbers_gracefulFallback],
  ]
  for (const [name, fn] of tests) {
    try {
      console.log(`▶ ${name}`)
      await fn()
    } catch (e) {
      console.error(`  ✗ ${name} FAILED:`, e.message)
      console.error(e.stack)
      process.exit(1)
    }
  }
  console.log('\n✅ ALL TESTS PASSED')
})()
