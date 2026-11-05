import json, os, re
os.chdir('/app')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a); s = s.replace(a, b)
    open(p, 'w').write(s)

# ---------- backend ----------
p = 'js/hosted-sms.js'; s = open(p).read()
pairs = [
 ("""// Texting plan: standalone, for a business number the customer already has. Receiving-first (US sending needs 10DLC).
const TEXTING = { setup: 150, monthly: 100, inbound: 50, extra: 150 }
const monthlyOf = (d) => (d.planNumber ? 0 : d.plan === 'texting' ? TEXTING.monthly : MONTHLY)""",
  """// Texting plan: standalone, one business number per plan, incoming texts only and free.
// $200 once (covers the first month), then $50/month.
const TEXTING = { setup: 200, monthly: 50 }
const monthlyOf = (d) => (d.planNumber ? 0 : d.plan === 'texting' ? TEXTING.monthly : MONTHLY)"""),
 ("""  monthly: monthlyOf(d), inboundIncluded: d.plan === 'texting' && !d.planNumber ? TEXTING.inbound : null, inboundUsed: d.plan === 'texting' && !d.planNumber ? d.inboundUsed || 0 : null,
""", """  monthly: monthlyOf(d),
"""),
 ("""  const fresh = planNumber === 'new'
  const parent = fresh ? { phoneNumber: null, plan: 'texting', status: 'active', limit: null, used: 0, price: TEXTING.setup } : plans.find(p => p.phoneNumber === planNumber)
""", """  // Standalone only: every number is its own Texting plan.
  const parent = { phoneNumber: null, plan: 'texting', status: 'active', limit: null, used: 0, price: TEXTING.setup }
"""),
 ("""`✅ ${d.phoneNumber} is on for texting. Incoming texts land in your Inbox. ${d.planNumber ? `No monthly fee: it renews with your plan on ${d.planNumber}.` : `$${monthlyOf(d)}/month from your wallet${d.plan === 'texting' ? ` with ${TEXTING.inbound} incoming texts included` : ''}, next on ${new Date(Date.now() + MONTH_MS).toISOString().slice(0, 10)}.`}`""",
  """`✅ ${d.phoneNumber} is on. Texts your customers send it now land here and in your Inbox, free. ${d.planNumber ? `No monthly fee: it renews with your plan on ${d.planNumber}.` : `Your first month is included; then $${monthlyOf(d)}/month from your wallet, next on ${new Date(Date.now() + MONTH_MS).toISOString().slice(0, 10)}.`}`"""),
 ("""  // Texting plan: first TEXTING.inbound incoming texts each month are included (shared by the plan's numbers).
  const anchor = d.plan === 'texting' ? (d.planNumber ? d.planNumber : d.phoneNumber) : null
  const free = anchor && (await S.col.updateOne({ chatId: d.chatId, phoneNumber: anchor, live: true, planNumber: null, $or: [{ inboundUsed: { $exists: false } }, { inboundUsed: { $lt: TEXTING.inbound } }] }, { $inc: { inboundUsed: 1 } })).modifiedCount > 0
  const charge = free ? 0 : TEXT_PRICE""", """  // Incoming texts are free on the Texting plan (older add-on numbers still pay per text).
  const free = d.plan === 'texting'
  const charge = free ? 0 : TEXT_PRICE"""),
 ("""  if (d.status !== 'active') return { error: d.status === 'paused'""", """  if (d.plan === 'texting') return { error: 'This number receives texts only. Your customers text it and you read them here.', code: 'receive_only' }
  if (d.status !== 'active') return { error: d.status === 'paused'"""),
]
for a, b in pairs:
    assert a in s, a; s = s.replace(a, b)
open(p, 'w').write(s)

edit('js/cloudivr-web/numbers.js', [("    texting: (({ TEXTING, PLAN_PRICE, PLAN_LIMIT, TEXT_PRICE }) => ({ ...TEXTING, textPrice: TEXT_PRICE, addOn: PLAN_PRICE, addOnLimits: PLAN_LIMIT }))(require('../hosted-sms.js')),", "    texting: require('../hosted-sms.js').TEXTING,")])
edit('js/sms-rules.js', [("why: isHosted ? 'Texting US mobiles from this number needs business texting registration (10DLC) first. Receiving works now.'", "why: isHosted ? 'This number receives texts only.'")])
# Inbox: no reply on Texting-plan texts
edit('js/cloudivr-web/notify.js', [("canReply: n.kind === 'sms' && !!n.meta?.from && !!n.meta?.to }", "canReply: n.kind === 'sms' && !!n.meta?.from && !!n.meta?.to && !n.meta?.receiveOnly }")])
print(open('js/hosted-sms.js').read().count("hosted: true"))
