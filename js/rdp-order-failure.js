'use strict'
// rdp-order-failure.js — a paid bot RDP order whose Windows build fails AFTER the purchase flow
// finished (e.g. conversion/RDP-port timeout ~25-90 min in, no AMD capacity at create, stuck build)
// used to only alert the admin. Now (2026-10-14): ONE wallet refund, the half-built droplet is
// destroyed, the customer is told (amount, short reason, try another city) and the admin is told.
//   • Exactly once: the vpsPlansOf record is claimed atomically (lateFailure) BEFORE the wallet credit.
//   • The purchase flow still owns failures while it is polling (record 'provisioning', < 30 min old):
//     it deletes the record and its caller refunds — so this returns retry and the sweep re-checks later.
//   • Reseller API orders are refunded by the reseller worker (rdp.provision_failed); comp servers are free.
const FOREGROUND_MS = 30 * 60000
const round2 = (n) => Math.round(n * 100) / 100

async function handle({ instanceId, reason, reasonCode, createdAt } = {}, deps = {}) {
  const { plans, credit, cancel, notifyCustomer, notifyAdmin, now = new Date() } = deps
  if (!plans || !instanceId) return { action: 'no_record' }
  const rec = await plans.findOne({ $or: [{ contaboInstanceId: instanceId }, { vpsId: instanceId }, { instanceId }] })
  if (!rec) return { action: 'no_record' }
  if (rec.source === 'reseller_api') return { action: 'reseller' }
  if (rec.comp) return { action: 'comp' }
  if (rec.lateFailure) return { action: 'already' }
  const age = now.getTime() - new Date(rec.timestamp || rec.start_time || createdAt || now).getTime()
  if (String(rec.status || '').toLowerCase() === 'provisioning' && age < FOREGROUND_MS) return { action: 'foreground', retry: true }

  const amount = round2(Number(rec.paidUsd) > 0 ? Number(rec.paidUsd) : (Number(rec.planPrice) || 0))
  const claim = await plans.updateOne({ _id: rec._id, lateFailure: { $exists: false } }, { $set: {
    status: 'DELETED', provisionState: 'failed', deletedReason: 'build_failed_refunded',
    lateFailure: { at: now, reason: reason || null, reason_code: reasonCode || 'provision_failed', refund_usd: amount, refunded: false },
  } })
  if (!claim.modifiedCount) return { action: 'already' }
  if (amount > 0) {
    await credit(String(rec.chatId), amount)
    await plans.updateOne({ _id: rec._id }, { $set: { 'lateFailure.refunded': true, 'lateFailure.refundedAt': new Date() } })
  }
  if (cancel) { try { await cancel(instanceId) } catch (e) { if (notifyAdmin) notifyAdmin(`⚠️ Could not destroy failed RDP ${instanceId}: ${e.message}`) } }
  try { if (notifyCustomer) await notifyCustomer(rec, { amount, reason, reasonCode }) } catch (_) { /* refund already done */ }
  if (notifyAdmin) notifyAdmin(`💸 <b>RDP build failed after purchase — auto-refunded</b>\nUser: ${rec.chatId}\nServer: ${instanceId}\nRefund: $${amount.toFixed(2)} → wallet\nReason: ${reason || reasonCode || 'provision_failed'}`)
  return { action: amount > 0 ? 'refunded' : 'no_price', amount, chatId: String(rec.chatId) }
}

module.exports = { handle, FOREGROUND_MS }
