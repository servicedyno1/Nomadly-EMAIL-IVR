// Wallet history (/history) rendering for purchase rows of the `transactions` ledger.
// Purchases are debits. Wallet purchases also write a legacy `payments` debit row, so a
// purchase row that matches one (same amount, at or up to 45 days after it) is not shown twice.

const PURCHASE_LABELS = {
  hosting: ['🖥️', 'Hosting'],
  domain: ['🌐', 'Domain'],
  'phone-number': ['☎️', 'Cloud Phone'],
  'phone-sub-number': ['☎️', 'Cloud Phone (extra number)'],
  'cloudphone-subscription': ['☎️', 'Cloud Phone Renewal'],
}
const WINDOW_MS = 45 * 86400000

function purchaseEntry(txn) {
  const label = PURCHASE_LABELS[txn.type]
  if (!label) return null
  const m = txn.metadata || {}
  // Pre-fix hosting provisioning rows ($0/$30 placeholders) carry no payment info: skip them.
  if (txn.type === 'hosting' && !m.paymentMethod && !m.psp) return { skip: true }
  const amount = Number(txn.amount) || 0
  return {
    icon: label[0],
    isCredit: false,
    amount,
    amountStr: `$${amount.toFixed(2)}`,
    desc: m.psp ? `${label[1]} (${m.coin || 'crypto'})` : label[1],
    dateObj: txn.createdAt ? new Date(txn.createdAt) : null,
    raw: JSON.stringify(txn),
    _purchase: true,
  }
}

function dropDuplicatePurchases(parsed) {
  const legacy = parsed.filter((p) => !p.isCredit && !p._purchase && p.dateObj)
  const used = new Set()
  const hidden = new Set()
  const purchases = parsed.filter((p) => p._purchase && p.dateObj).sort((a, b) => a.dateObj - b.dateObj)
  for (const p of purchases) {
    let best = null
    for (const l of legacy) {
      const d = p.dateObj - l.dateObj
      if (used.has(l) || Math.abs(l.amount - p.amount) >= 0.01 || d < -10 * 60000 || d >= WINDOW_MS) continue
      if (!best || l.dateObj > best.dateObj) best = l
    }
    if (best) { used.add(best); hidden.add(p) }
  }
  return parsed.filter((p) => !hidden.has(p))
}

module.exports = { purchaseEntry, dropDuplicatePurchases }
