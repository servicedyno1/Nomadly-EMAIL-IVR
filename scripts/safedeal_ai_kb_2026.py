"""ai-support.js + config.js: Lockbay → SafeDeal knowledge, marketplace price range, reseller 50/50."""
p = '/app/js/config.js'
s = open(p).read()
a = "<b>65/35%</b> profit share on every sale. Tap 💬 <b>Get Support</b> to get started.`"
b = "<b>50/50</b> profit share on every sale. Tap 💼 <b>Become A Reseller</b> and ask our AI assistant anything about reselling.`"
assert s.count(a) == 1
open(p, 'w').write(s.replace(a, b))

p = '/app/js/ai-support.js'
s = open(p).read()
ESCROW_OLD = '''#### How escrow works:
All marketplace payments MUST go through @Lockbaybot escrow for safety.
1. Buyer & seller chat about the product
2. When ready, either party types /escrow or taps "🔒 Start Escrow"
3. Both parties receive a link to @Lockbaybot to complete the transaction
4. Buyer's money is held safely until they confirm delivery
5. ⚠️ NEVER send payment outside of escrow — this is the #1 scam tactic'''
ESCROW_NEW = '''#### How escrow works (SafeDeal — https://safedeal.sh web escrow; the old @Lockbaybot is DISCONTINUED):
All marketplace payments MUST go through SafeDeal escrow for safety.
1. Buyer & seller chat about the product and agree a price ($30–$3,000)
2. When ready, either party types /escrow or taps "🔒 Start Escrow" — both get step-by-step SafeDeal instructions
3. Buyer opens safedeal.sh → "I'm buying" → pastes the deal name & price → "Share a link" → signs in with an email code → pastes the invite link into the marketplace chat
4. Seller opens the link, signs in with an email code and accepts (if the buyer is stuck, the seller can create it via "I'm selling")
5. Buyer pays on SafeDeal (10 coins accepted, held as USDT); seller delivers only after the deal shows "Funded"; buyer releases (or it auto-releases after the inspection period)
6. SafeDeal fee: 5% (min $10), paid by the buyer by default. Disputes get human arbitration from SafeDeal (hi@safedeal.sh)
7. ⚠️ NEVER send payment outside of SafeDeal — treat anyone suggesting @Lockbaybot or any other "escrow" bot as a scam.'''
reps = [
    ("Enter price ($20–$5,000)", "Enter price ($30–$3,000 — SafeDeal's escrow range)"),
    (ESCROW_OLD, ESCROW_NEW),
    ("- /escrow — Start escrow payment via @Lockbaybot", "- /escrow — Get the SafeDeal escrow steps (safedeal.sh)"),
    ("- All transactions are escrow-protected via @Lockbaybot", "- All transactions are escrow-protected via SafeDeal (safedeal.sh); safedeal.sh invite links shared in chat are allowed"),
    ('''### 💼 Become A Reseller
From main menu → tap <b>💼 Become A Reseller</b>
65/35% profit share on every sale. Contact support to get started.''',
     '''### 💼 Become A Reseller
From main menu → <b>➕ More</b> → tap <b>💼 Reseller</b>
Resell our services under your own brand with a <b>50/50</b> profit share on every sale. Tapping it opens this AI support chat right away so the user can ask anything about reselling; a human team member joins for onboarding or anything you can't confirm.'''),
    ("Price ($20-$5000) → Category", "Price ($30-$3,000) → Category"),
    ("Both parties receive a link to @Lockbaybot. The buyer's money is held safely until they confirm delivery.",
     "Both parties get step-by-step instructions for <b>SafeDeal</b> (https://safedeal.sh): the buyer creates the deal (\"I'm buying\" → \"Share a link\") and pastes the invite link in the chat, the seller accepts it, the buyer pays on SafeDeal and the money is held until they confirm delivery. Fee: 5% (min $10)."),
    ("<b>NEVER accept payments outside of @Lockbaybot escrow</b>", "<b>NEVER accept payments outside of SafeDeal escrow (safedeal.sh)</b>"),
    ("- All payments MUST go through @Lockbaybot escrow\n",
     "- All payments MUST go through SafeDeal escrow (https://safedeal.sh). Sharing a safedeal.sh invite link is NORMAL and SAFE — never flag it\n- Mentions of @Lockbaybot (discontinued) or any other \"escrow\" bot/handle are a scam indicator\n"),
    ("pricing $20-$5000, categories", "pricing $30-$3,000, categories"),
    ("- How escrow works (@Lockbaybot holds funds until delivery confirmed)",
     "- How escrow works (SafeDeal at https://safedeal.sh holds funds as USDT until delivery is confirmed; the buyer creates the deal with \"I'm buying\" → \"Share a link\" and pastes the invite link in chat; the seller accepts; deliver only after \"Funded\"; fee 5%, min $10; @Lockbaybot is discontinued)"),
    ("- ALWAYS use @Lockbaybot escrow — NEVER pay outside of escrow",
     "- ALWAYS use SafeDeal escrow (safedeal.sh) — NEVER pay outside of escrow or through any other \"escrow\" bot"),
]
for a, b in reps:
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
assert 'Lockbaybot escrow' not in s
open(p, 'w').write(s)
print('ok')
