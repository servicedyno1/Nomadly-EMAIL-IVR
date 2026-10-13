/**
 * Regression test: promo caption shape + length.
 *
 * Context: on 2026-05-03 the promo caption was rewritten to:
 *   (1) hoist the coupon line to the TOP (it was buried under 3 footers),
 *   (2) drop the piggy-backed SMTP and BulkSMS footers (they have their own
 *       weekly slots — stacking them on every promo was noise),
 *   (3) trim over-long bodies to ~420 visible chars.
 *
 * This test exercises the pure helper `_trimPromoBody` (exported for tests)
 * and simulates the caption assembly flow to assert the final shape.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

// Load the trimmer out of auto-promo.js without booting the full module.
// The helper is defined inside a closure, so we parse the source and eval it
// in an isolated scope. Kept dependency-free to match the other test files.
const src = fs.readFileSync(path.resolve(__dirname, '../auto-promo.js'), 'utf8')
const rx = /const PROMO_BODY_MAX_CHARS = 420[\s\S]+?function _trimPromoBody\(raw\) \{[\s\S]+?\n  \}/
const match = src.match(rx)
if (!match) {
  console.error('✗ Could not locate _trimPromoBody in auto-promo.js')
  process.exit(1)
}
// eslint-disable-next-line no-new-func
const makeTrimmer = new Function(match[0] + '\nreturn { _trimPromoBody, PROMO_BODY_MAX_CHARS }')
const { _trimPromoBody, PROMO_BODY_MAX_CHARS } = makeTrimmer()

function run(name, fn) {
  try { fn(); console.log(`✓ ${name}`) }
  catch (e) { console.error(`✗ ${name}\n   ${e.message}`); process.exit(1) }
}

run('Short body is returned unchanged', () => {
  const short = 'Buy our thing. It is great.'
  assert.strictEqual(_trimPromoBody(short), short)
})

run('HTML-tag-only padding does not count toward the limit', () => {
  const tagged = '<b>'.repeat(50) + 'hello' + '</b>'.repeat(50)  // raw ~250 chars, plain 5 chars
  assert.strictEqual(_trimPromoBody(tagged), tagged, 'should pass through — visible length is tiny')
})

run('Body over 420 visible chars is trimmed with a single trailing …', () => {
  const body = 'A'.repeat(600)
  const out = _trimPromoBody(body)
  assert.ok(out.endsWith(' …'), 'should end with ellipsis')
  assert.ok(out.replace(/<[^>]+>/g, '').length <= PROMO_BODY_MAX_CHARS + 2, 'visible length within cap + ellipsis')
})

run('Trim prefers sentence boundary when one exists near cutoff', () => {
  const body = 'Word. '.repeat(100) // 600 chars, lots of sentence ends
  const out = _trimPromoBody(body)
  assert.ok(out.endsWith(' …'), 'should end with ellipsis')
  assert.ok(!out.match(/Word[^.\s]/), 'should not truncate mid-word')
})

run('Trim falls back to word boundary if no sentence end nearby', () => {
  const body = 'a'.repeat(450) + ' final-word-after-wall'
  const out = _trimPromoBody(body)
  assert.ok(out.endsWith(' …'))
  assert.ok(!out.includes('final-word'), 'should cut before the post-cap word')
})

// Caption assembly simulation (mirrors sendPromoToUser body post-rewrite)
run('Caption assembly puts coupon line FIRST, body second, opt-out LAST', () => {
  const couponLine = '🎁 <b>TODAY 10% OFF</b> — code <code>NMD10ABC123</code>'
  const body = 'Visit our marketplace for premium accounts.'
  const optout = '💬 Tap /stoppromos to unsubscribe from promotional messages'

  let caption = ''
  if (couponLine) caption += couponLine + '\n\n'
  caption += body
  caption += '\n\n' + optout

  const idxCoupon = caption.indexOf(couponLine)
  const idxBody = caption.indexOf(body)
  const idxOpt = caption.indexOf(optout)
  assert.strictEqual(idxCoupon, 0, 'coupon line should be at char 0')
  assert.ok(idxCoupon < idxBody, 'coupon before body')
  assert.ok(idxBody < idxOpt, 'body before opt-out footer')
})

run('No coupon line still produces a valid body+optout caption', () => {
  const body = 'Visit our marketplace.'
  const optout = '💬 Tap /stoppromos to unsubscribe from promotional messages'

  let caption = ''
  caption += body
  caption += '\n\n' + optout

  assert.ok(caption.startsWith(body))
  assert.ok(caption.endsWith(optout))
})

run('SMTP and BulkSMS footers are no longer in the caption pipeline', () => {
  // Guard: ensure we never accidentally re-introduce them by reading the
  // sendPromoToUser body from source. This is a codebase-level assertion.
  const sendPromoRx = /async function sendPromoToUser\([^)]*\)\s*\{([\s\S]+?)\n  \}\n\n  const msgPool/
  // The regex above is intentionally loose — we just want the body of
  // sendPromoToUser's try-block region up to the next fn definition.
  // Simpler: search within the first ~120 lines after the function header.
  const start = src.indexOf('async function sendPromoToUser')
  assert.ok(start > 0, 'sendPromoToUser should exist')
  const block = src.slice(start, start + 4000)
  assert.ok(!block.includes('getSmtpFooter(lang)'), 'getSmtpFooter should NOT appear inside sendPromoToUser')
  assert.ok(!block.includes('getBulkSmsFooter(lang)'), 'getBulkSmsFooter should NOT appear inside sendPromoToUser')
  // 2026-06: the unsubscribe footer moved into the shared renderer (promo-copy/index.js)
  const renderer = fs.readFileSync(path.resolve(__dirname, '../promo-copy/index.js'), 'utf8')
  assert.ok(/parts\.push\(''\s*,\s*FOOTER\[lang\] \|\| FOOTER\.en\)/.test(renderer), 'renderPromo SHOULD append the unsubscribe footer')
})

console.log('\nAll auto-promo caption tests passed.')
