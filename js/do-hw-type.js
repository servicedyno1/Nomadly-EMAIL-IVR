'use strict'
// do-hw-type.js — the REAL DigitalOcean hardware class of a VPS / RDP, read from its droplet size slug
// (2026-10-14). Used by the reseller API (cpu_type / size_slug / hardware fields — the older cpu +
// storage_type fields are unchanged) and the bot (plan list, order summary, My VPS/RDP screen).
//   s-…-amd   → Premium AMD   · NVMe SSD   (AMD EPYC, one of the 2 latest generations)
//   s-…-intel → Premium Intel · NVMe SSD   (Intel Xeon Scalable, one of the 2 latest generations)
//   s-…       → Regular CPU   · SSD        (DigitalOcean mixes older Intel Xeon / AMD EPYC — no brand guarantee)
// Anything else (non-DigitalOcean sizes, unknown) → null: we never guess a type.
const BASIC = /^s-\d+vcpu-/

function classOf(slug) {
  const s = String(slug || '').trim().toLowerCase()
  if (!BASIC.test(s)) return null
  if (s.endsWith('-amd')) return { cpu_type: 'Premium AMD', storage_type: 'NVMe SSD', size_slug: s, hardware: 'Premium AMD · NVMe SSD', emoji: '⚡' }
  if (s.endsWith('-intel')) return { cpu_type: 'Premium Intel', storage_type: 'NVMe SSD', size_slug: s, hardware: 'Premium Intel · NVMe SSD', emoji: '⚡' }
  return { cpu_type: 'Regular', storage_type: 'SSD', size_slug: s, hardware: 'Regular CPU · SSD', emoji: '💾' }
}

// Reseller API fields (always present; null when the size is not a DigitalOcean Basic droplet).
function apiFields(slug) {
  const c = classOf(slug)
  return { cpu_type: c ? c.cpu_type : null, size_slug: c ? c.size_slug : null, hardware: c ? c.hardware : null }
}

// Bot label, e.g. "⚡ Premium AMD · NVMe SSD" / "💾 Regular CPU · SSD" (null when unknown).
function botLabel(slug) {
  const c = classOf(slug)
  return c ? `${c.emoji} ${c.hardware}` : null
}

// The size a catalogue product will be / was built on: the live RDP quote (a pricier same-spec AMD size
// in that city) → the product's own DO size → a DO VPS product id (the VPS product id IS the size slug).
function slugOfProduct(p) {
  if (!p) return null
  const q = p.quote && p.quote.size_slug
  if (q) return q
  if (p.do_size_slug) return p.do_size_slug
  const id = String(p.productId || p._id || '')
  return BASIC.test(id.toLowerCase()) ? id : null
}

module.exports = { classOf, apiFields, botLabel, slugOfProduct }
