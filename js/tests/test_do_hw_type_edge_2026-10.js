'use strict'
// Edge-case tests for js/do-hw-type.js — called out by main agent:
// • unknown / weird slugs (g-*, Azure SKUs, empty, null, numbers)
// • RDP product ids ("pro-1m") not DO sizes
// • slugOfProduct precedence (quote.size_slug > do_size_slug > productId)
// • HTML/injection safety of labels (nothing fancy returned)
// • no mutation of existing cpu/storage_type semantics (classOf returns Regular tags separately)
const assert = require('assert')
const { classOf, apiFields, botLabel, slugOfProduct } = require('../do-hw-type')

let pass = 0, fail = 0
function t(name, fn){ try { fn(); console.log('  ✅ ' + name); pass++ } catch (e) { console.log('  ❌ ' + name + ' — ' + e.message); fail++ } }

console.log('── do-hw-type edge cases ──')

t('classOf AMD slug', () => {
  const c = classOf('s-4vcpu-8gb-amd')
  assert.strictEqual(c.cpu_type, 'Premium AMD')
  assert.strictEqual(c.storage_type, 'NVMe SSD')
  assert.strictEqual(c.hardware, 'Premium AMD · NVMe SSD')
  assert.strictEqual(c.size_slug, 's-4vcpu-8gb-amd')
})

t('classOf Intel slug', () => {
  const c = classOf('s-2vcpu-4gb-intel')
  assert.strictEqual(c.cpu_type, 'Premium Intel')
  assert.strictEqual(c.hardware, 'Premium Intel · NVMe SSD')
})

t('classOf Regular (no suffix)', () => {
  const c = classOf('s-1vcpu-1gb')
  assert.strictEqual(c.cpu_type, 'Regular')
  assert.strictEqual(c.storage_type, 'SSD')
  assert.strictEqual(c.hardware, 'Regular CPU · SSD')
})

t('classOf uppercase normalises', () => {
  const c = classOf('S-4VCPU-8GB-AMD')
  assert.strictEqual(c.cpu_type, 'Premium AMD')
  assert.strictEqual(c.size_slug, 's-4vcpu-8gb-amd')
})

t('classOf g-* (general purpose) → null (not a Basic droplet)', () => {
  assert.strictEqual(classOf('g-2vcpu-8gb'), null)
})

t('classOf CPU-optimised c-* → null', () => {
  assert.strictEqual(classOf('c-4'), null)
})

t('classOf memory-optimised m-* → null', () => {
  assert.strictEqual(classOf('m-2vcpu-16gb'), null)
})

t('classOf Azure SKU → null', () => {
  assert.strictEqual(classOf('Standard_B2s'), null)
})

t('classOf Vultr vc2-* → null', () => {
  assert.strictEqual(classOf('vc2-1c-1gb'), null)
})

t('classOf RDP tier id "pro-1m" → null', () => {
  assert.strictEqual(classOf('pro-1m'), null)
})

t('classOf empty / null / undefined / number → null', () => {
  assert.strictEqual(classOf(''), null)
  assert.strictEqual(classOf(null), null)
  assert.strictEqual(classOf(undefined), null)
  assert.strictEqual(classOf(0), null)
  assert.strictEqual(classOf(42), null)
})

t('classOf whitespace trimmed', () => {
  const c = classOf('  s-4vcpu-8gb-amd  ')
  assert.strictEqual(c && c.cpu_type, 'Premium AMD')
})

t('classOf "-amd" without s- prefix → null', () => {
  assert.strictEqual(classOf('foo-amd'), null)
})

t('apiFields: fully null for unknown', () => {
  assert.deepStrictEqual(apiFields('g-2vcpu-8gb'), { cpu_type: null, size_slug: null, hardware: null })
  assert.deepStrictEqual(apiFields(null), { cpu_type: null, size_slug: null, hardware: null })
})

t('apiFields: Intel', () => {
  assert.deepStrictEqual(apiFields('s-2vcpu-4gb-intel'), {
    cpu_type: 'Premium Intel', size_slug: 's-2vcpu-4gb-intel', hardware: 'Premium Intel · NVMe SSD'
  })
})

t('botLabel for AMD / Intel / Regular / unknown', () => {
  assert.strictEqual(botLabel('s-4vcpu-8gb-amd'), '⚡ Premium AMD · NVMe SSD')
  assert.strictEqual(botLabel('s-2vcpu-4gb-intel'), '⚡ Premium Intel · NVMe SSD')
  assert.strictEqual(botLabel('s-1vcpu-1gb'), '💾 Regular CPU · SSD')
  assert.strictEqual(botLabel('pro-1m'), null)
  assert.strictEqual(botLabel(null), null)
})

t('botLabel is a plain string (no HTML / markdown injection)', () => {
  const label = botLabel('s-4vcpu-8gb-amd')
  assert.ok(!/[<>]/.test(label), 'no angle brackets')
  assert.ok(!/[*_`[\]]/.test(label), 'no markdown control chars')
})

t('slugOfProduct: null for empty', () => {
  assert.strictEqual(slugOfProduct(null), null)
  assert.strictEqual(slugOfProduct(undefined), null)
  assert.strictEqual(slugOfProduct({}), null)
})

t('slugOfProduct: quote > do_size_slug > productId', () => {
  const slug = slugOfProduct({ quote: { size_slug: 's-4vcpu-8gb-amd' }, do_size_slug: 's-2vcpu-4gb', productId: 's-1vcpu-1gb' })
  assert.strictEqual(slug, 's-4vcpu-8gb-amd')
})

t('slugOfProduct: do_size_slug used when no quote', () => {
  assert.strictEqual(slugOfProduct({ do_size_slug: 's-2vcpu-4gb-intel' }), 's-2vcpu-4gb-intel')
})

t('slugOfProduct: productId is a DO size (VPS catalogue)', () => {
  assert.strictEqual(slugOfProduct({ productId: 's-4vcpu-8gb-amd' }), 's-4vcpu-8gb-amd')
})

t('slugOfProduct: productId not a DO size (RDP tier id)', () => {
  assert.strictEqual(slugOfProduct({ productId: 'pro-1m' }), null)
  assert.strictEqual(slugOfProduct({ _id: 'standard-3m' }), null)
})

t('slugOfProduct: _id fallback when productId missing', () => {
  assert.strictEqual(slugOfProduct({ _id: 's-1vcpu-1gb' }), 's-1vcpu-1gb')
})

t('slugOfProduct: quote present but empty string → next source', () => {
  assert.strictEqual(slugOfProduct({ quote: { size_slug: '' }, do_size_slug: 's-2vcpu-4gb' }), 's-2vcpu-4gb')
})

// legacy-record simulation: hwFromRecord is in reseller-api.js, but the module here must stay stable
t('legacy / non-DO record (Azure/Vultr) → classOf of their slugs is null, apiFields all null', () => {
  for (const slug of ['Standard_B2s', 'vc2-1c-1gb', 'cx11', '']) {
    const f = apiFields(slug)
    assert.strictEqual(f.cpu_type, null)
    assert.strictEqual(f.size_slug, null)
    assert.strictEqual(f.hardware, null)
    assert.strictEqual(botLabel(slug), null)
  }
})

t('existing values untouched: Regular keeps storage SSD (NOT NVMe)', () => {
  const c = classOf('s-1vcpu-1gb')
  assert.strictEqual(c.storage_type, 'SSD')
  assert.notStrictEqual(c.storage_type, 'NVMe SSD')
})

t('export surface', () => {
  const mod = require('../do-hw-type')
  assert.deepStrictEqual(Object.keys(mod).sort(), ['apiFields', 'botLabel', 'classOf', 'slugOfProduct'])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
