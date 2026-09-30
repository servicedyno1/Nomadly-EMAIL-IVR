# Nomadly Telegram Bot — End-to-End User Journey Audit & Conversion Recommendations
**Date:** 2026-09-14 · **Scope:** whole bot, Cloud IVR deepest · **Mode:** analysis only (no bot changes)
**Data:** exact screens/copy in `js/_index.js`, `js/lang/*.js`, `js/phone-config.js`, lifecycle modules + a fresh **read-only 7-day Railway log sample (2026-09-07 → 09-14)** pulled via `ops/railway_journey_pull.js` into `/app/investigations/journey7d/` (2,884 user taps, 3,721 bot replies, 96 users). Analysis script: `ops/journey_funnel_analysis.py`.
Earlier reports cross-checked so fixed items are excluded: `UX_ANALYSIS_REPORT.md`, `UX_ANALYSIS_REPORT_APRIL_16.md`, `/app/UX_ANOMALY_REPORT.md` (June), `NOMADLY_48H_SCAN_2026-08-07.md`.

---

## 0. Executive summary (one page)

**The week in numbers (7 days):** 96 active users · **36 new users** onboarded · ~10,100 promo messages delivered · **1 new user deposited** (Lalapmo, $100) · **0 new users completed a product purchase** · 12 existing users made 29 wallet purchases · 1 Cloud IVR activation · **8 of 8 VPS checkouts failed** (100 %) · 0 welcome-offer coupons redeemed out of ~30 sent · 363 Back/Cancel taps (13 % of all taps) · 189 `/start` taps from 72 users (2.6 per user).

**What is actually blocking first purchases, in order of damage:**

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| 1 | **VPS/RDP checkout is broken** — every attempt fails at provisioning and refunds. One ready-to-pay user (@theshakeback, $53 in wallet) tried **9 times across 9 regions/2 days**, was told "try again" by support, failed again. Meanwhile the VPS hub tells him "62 VPS servers deployed this week" and AutoPromo advertises VPS twice a week. | **Blocker** | `vps.jsonl`: 8 `Creating instance` → 8 `Provisioning failed`; Contabo `invalid_client` ×35; known since Jul-26 scan, still deferred |
| 2 | **Social proof is fabricated** (seeded random: "150–250 domains registered this week" while real count was ~18; "62 VPS deployed" while 0 succeeded). Shown on every hub. | **Blocker (trust)** | `new-user-conversion.js:694-700` |
| 3 | **Insufficient-balance "Yes" marks the user as purchased** → cart cleared, welcome offer & browse follow-ups cancelled — exactly for the users who most need a nudge. | **Blocker (silent)** | `_index.js:23573-23577` runs `recordPaymentCompleted`+`markPurchased` *before* the balance check; user 1823540405 confirmed in logs |
| 4 | **No resume after top-up.** Every balance wall / underpayment dead-ends: "Add Funds" → wallet menu → deposit → …user must rebuild the whole order by hand. `session-recovery.js` exists but `saveResumableSession` is never called. | **Major** | 21 balance-wall screens / 14 users this week; `sentLessMoney`: "Amount credited to wallet. Service not delivered." with no CTA |
| 5 | **Price inconsistencies across surfaces** (overage $0.15 vs $0.04/min; VPS price changes region-to-region by $8 with no explanation — "top up $0.84 more" then "$1.74 more" 11 s later; "Plans from $50/day" for URL shortener; hosting shows plan price but never plan+domain total). | **Major (trust)** | `monetization-engine.js:112,120,128` vs `phone-config.js:126`; log 7333384436 09-13 07:16 |
| 6 | **Main menu = 17 buttons / 9 rows, no hierarchy.** 25 % of new users never tap anything after onboarding; median new user makes 6 taps then leaves; 13 % of all taps are Back/Cancel. | **Major** | funnel script: 9/36 new users 0 hubs, 9/36 exactly one |
| 7 | **Free hooks don't lead anywhere.** `/testsip` is the #2 first action of new users (16/36 tried SIP) but the code screen ends with "Like it? Tap Cloud IVR + SIP" — no plan pre-selected, no credit, no follow-up; Quick IVR trial call ends similarly. | **Major** | 27 SIP codes issued → 1 Cloud IVR activation |
| 8 | **Lifecycle messaging is volume without lift.** 42 blasts / 10,081 deliveries / 945 blocked in 7 days; `/start` within 45 min of a blast = 11 vs 12 expected by chance (zero measurable lift). 30 welcome-offer coupons sent, 0 redeemed. Cart nudge says "type /menu → 🎟️ Daily Coupon" — `/menu` is not a command and there is no Daily Coupon button. | **Major** | `autopromo.jsonl` Done stats; `cart-abandonment.js:189+` |
| 9 | Cloud IVR path is 10 taps to payment; plan picker still repeats "Starter does NOT include IVR" 3× (hub, plan picker, order summary); Bulk IVR $50 floor and forwarding $25 floor surface only at the end. | Major | `phone-config.js:665-691`; PRD P2 still open |
| 10 | Typed text that isn't a button (e.g. "English", a question) gets the main menu or "That option isn't available" instead of help; language switch needed 4 attempts for the Chinese user who then deposited $100. | Minor–Major | log 1615382593 02:59–03:11 |
| 11 | 33 translation keys missing in FR/ZH/HI (fall back to English mid-flow); non-EN hub copy shorter. | Minor | `scripts/check_lang_parity.js` |

**Do first (this week):** fix VPS provisioning or hide VPS everywhere until fixed → remove fabricated social proof → move `markPurchased`/cart-clear after a successful charge → add "Resume order" after any top-up. These four alone touch every buyer who hit a wall this week.

---

## 1. Journey map (as the code sends it today)

| Stage | Screens / taps | Where value, price, payment first appear |
|-------|----------------|------------------------------------------|
| **Discovery → /start** | Promo (2/day), channel, referral `/start ref_X`, web redirect fallback | Promo shows a coupon header + theme; landing is always the same language picker |
| **First run** | `/start` → language menu (4 buttons) → [🎉 $5 welcome gift] → 2 s later main menu greeting (name, tier badge, balance, "free trial Quick IVR" line, "Send /testsip" hint) → optional one-time trial banner | **3 messages stacked** before the menu; guided intro/Terms are disabled (good). Value prop is a list of 17 buttons; no price anywhere yet |
| **Main menu** | 17 buttons / 9 rows: Cloud IVR · Refer & Earn / Marketplace · Digital Products / Domains · Anti-Red Hosting / VPS · BulkSMS / Email Validation · Virtual Card / Wallet · SMS Leads / URL Shortener · Upgrade Plan / Join Channel / Reseller · Settings · Support | No prices, no "start here", equal weight for Refer & Earn and the headline product |
| **Free value** | `/testsip` (typed) or hub button → OTP code + link (5-min expiry, 3 calls) · Quick IVR "1 Free" call (hub) · 5 free short links · BulkSMS 100 free SMS · email-validation trial | Discoverable only inside hubs; each ends with a generic "tap Cloud IVR + SIP" line, no pre-selected plan, no credit toward purchase |
| **Cloud IVR hub** | Hub copy ("Plans from $50/mo …") + fake proof + 9 buttons → **Choose a Plan** (try-before-buy interstitial if untested) → plan picker → country grid → Local/Toll-free → US area grid → 5 numbers (+Show More) → Order Summary → [Coupon] → Payment method → coin → QR + "Send exactly X" | Price visible at hub (tap 1) ✅ · plan picker (tap 3) · order summary (tap 8) · payment (tap 9–10) · activation after webhook |
| **Anti-Red Hosting** | Hub (3 plans, no prices on buttons) → plan detail ($30/$75/$100) → Buy → domain choice → type domain → "available — $65" → email → nameservers → coupon → payment | **Plan + domain total is never shown**; Lalapmo deposited $100, saw "$65" for the domain on top of $100 hosting and left |
| **Domains** | Hub (no price) → Buy → "Pricing from $30/year" + type domain → **shortener Yes/No question** → price → payment | Shortener question sits between search and price |
| **VPS/RDP** | Hub → Linux/Windows → region (8) → NVMe/SSD → plan list with wallet affordability line → coupon → confirm → pay | Price appears at tap 5 and **changes by region/disk** ($46–$55 for the same plan); provisioning currently fails 100 % |
| **Digital Products / Virtual Card / Leads / Marketplace / Bundles** | DP: prices on buttons ($60–$450) ✅ → pay. VC: amount → address → fee summary → pay. Leads: target → city → confirm ($120 min wall). Marketplace: browse/paywall. Bundles: removed from menu (upsell only) | DP is the only hub with prices on the buttons |
| **Wallet** | Balance + tier line + tip (<$10) + tier nudge · Deposit → presets $20/$50/$100/$200 (min $10) → coin (TRC20 ≥ $20 interstitial) → exact-amount QR | 4 taps to an address (method step already skipped when bank hidden ✅) |
| **Post-purchase** | Activation message with SIP creds + quick setup; PostPurchase cross-sell card; `[PostPurchase]` fired 0 times this week (only 1 phone activation) | — |
| **Lifecycle** | Welcome offer 25 % @2 h (24 h expiry) · browse follow-up @2 h · cart nudge @45 min · AutoPromo 10:00 & 19:00 local ×4 langs · LowBalanceNudge · Day12Nudge · AbandonedCart (DP) · PaymentTimeout 6 h · daily coupon in promo header | A new non-buyer can receive 5–6 unsolicited messages in the first 24 h |
| **Support** | 💬 Support → AI (escalates to human) → `/done` → rating · "Ask Question" only in DP/VPS payment screens | Typed questions outside support mode are not routed to AI |

---

## 2. Pain-point register

### Trust & correctness
| ID | Pain point | Sev | Stage | Why it costs conversions |
|----|-----------|-----|-------|--------------------------|
| T1 | **VPS provisioning fails 100 %** (Contabo auth), still sold & promoted | Blocker | Purchase | Direct lost sales; 9 attempts from one funded user; erodes trust in every other checkout |
| T2 | **Fabricated social proof** on every hub (seeded random 50–250) | Blocker | Browse | Anyone who buys and sees a broken VPS or empty marketplace knows the numbers are fake → all other claims discounted |
| T3 | `markPurchased` + cart-clear fire **before** balance check | Blocker | Purchase→Wallet | Users who *tried to pay and couldn't* are removed from every recovery sequence (welcome offer, browse follow-up, cart nudge) |
| T4 | Overage quoted **$0.15/min** (phone-config) vs **$0.04/min** (monetization upsell); forwarding $0.50/min appears only at forwarding setup | Major | Post-purchase | Bill shock → disputes → churn; already a source of support tickets |
| T5 | VPS price for the same plan changes with region/disk ($46.35 → $54.90) with no "regional price" note; affordability line flips from "you can afford ✅" to "top up $1.74" between two taps | Major | Browse/Purchase | Feels like a moving target; user backs out repeatedly (logged 09-13) |
| T6 | Hosting never shows **plan + domain total**; domain price appears alone after hosting price | Major | Purchase | Lalapmo: $100 deposit → abandoned at "$65" |
| T7 | URL-shortener plans "from **$50/day**" (Daily $50 / Weekly $100 / Monthly $200) beside "5 free links" | Major | Browse | Perceived as absurd pricing for link shortening; kills Upgrade Plan CTA |
| T8 | Cart nudge instructs "type **/menu** → 🎟️ Daily Coupon" — neither exists | Major | Lifecycle | Nudge produces a dead end / "option not available" |
| T9 | Underpayment: "Amount credited to wallet. Service not delivered." — no "Pay remaining $X" button | Major | Payments | User must rediscover the product and re-checkout; most don't |

### Onboarding & navigation
| ID | Pain point | Sev | Stage | Evidence |
|----|-----------|-----|-------|----------|
| O1 | 17-button menu, no hierarchy; Refer & Earn shares row 1 with Cloud IVR | Major | Menu | 9/36 new users took 0 actions, 9 exactly 1; 13 % Back/Cancel |
| O2 | 3 stacked messages at first run (gift, greeting, trial banner) + `/start` re-renders whole menu (2.6 `/start` per user) | Minor | First run | 189 `/start` in 7 d |
| O3 | Best hook `/testsip` is a typed command in a hint line; button exists only inside hub | Major | Free value | 16/36 new users still found it → it works when found |
| O4 | Trial endings have no next step (no "Get this number — Pro $75, first month −25 %" button; no credit) | Major | Free value → Purchase | 27 codes → 1 activation |
| O5 | Typed text (e.g. "English", "how much…") returns menu or "That option isn't available"; language change loop took 4 tries | Minor–Major | Navigation | Lalapmo 02:59–03:11 |
| O6 | Starter-has-no-IVR disclaimer repeated on 3 screens; product named *Cloud IVR* sells an entry plan without IVR | Major | Cloud IVR | `phone-config.js:668,676,683` |
| O7 | Bulk IVR $50 wallet floor & forwarding $25 floor appear after multi-step forms (PRD P2, still open) | Major | Cloud IVR | — |
| O8 | Domain flow asks shortener Yes/No before showing price | Minor | Domains | log 1823540405 |
| O9 | Country/area/number selection = 4 screens before order summary; "Show More" returns 3+3 mixed providers with ☎️ Bulk IVR tags a newcomer can't interpret | Minor | Cloud IVR | — |

### Wallet & payments
| ID | Pain point | Sev | Stage | Evidence |
|----|-----------|-----|-------|----------|
| W1 | **No order resume after top-up**; `session-recovery.js` never populated | Major | Wallet | 21 wall screens/14 users; 0 resumes possible |
| W2 | Wall keyboards differ per product (💰 Add Funds / ➕💵 Deposit / "Tap Deposit ⬇️" / VPS affordability line) and all land on the wallet *menu*, not the amount screen with the shortfall pre-filled | Major | Wallet | improved-messages.js, walletOk handlers |
| W3 | Deposit presets ($20/50/100/200) don't reflect what the user was buying; min $10 but TRC20 needs $20 and most products need $30–$120 | Minor | Wallet | 14 amount screens this week |
| W4 | Exact-amount crypto invoice; fee-shave already handled as goodwill ✅ but the invoice text doesn't say "send a little extra for network fees" | Minor | Payments | 20 invoices; 6 minor-underpayments this week |
| W5 | 18 deploys in 7 days; scheduled events/timers recovered but in-flight flows reset (`Welcome offer scheduled` without `sent` for 3 users) | Minor | All | `Initialized` ×18 |

### Lifecycle & support
| ID | Pain point | Sev | Evidence |
|----|-----------|-----|----------|
| L1 | 10,081 promo deliveries / week, 945 blocked, **no lift in `/start`** (11 vs 12 expected) | Major | autopromo Done stats |
| L2 | Welcome offer: ~30 sent, **0 redeemed**; copy says "Tap /start and browse" — no deep link to a product, coupon must be typed | Major | message.jsonl: 0 `WELCOME25` |
| L3 | Daily coupon used only by 2 repeat buyers (discounting people who were buying anyway) | Minor | `NMD10*` taps |
| L4 | New non-buyer receives gift + greeting + trial banner (0 h), browse follow-up (2 h), welcome offer (2 h), cart nudge (45 min if a price screen was seen), promo (10:00), promo (19:00) — 5–7 messages in 24 h; opt-out only via `/stop_promos` text | Major | module configs |
| S1 | "Ask Question" only on DP/VPS payment screens; questions typed elsewhere aren't routed to AI | Minor | `isColdSupportQuestion` gate |
| S2 | Support AI suggests menu buttons that pause the session (works ✅) but VPS failure message says "contact support if the issue persists" instead of auto-opening a ticket with the error | Minor | 7333384436 |

---

## 3. Recommendations (ranked impact ÷ effort; P0 = trust, regardless of effort)

### P0 — trust (do before anything else)
1. **Fix or hide VPS.** Until Contabo credentials are valid (`invalid_client` ×35/wk), hide 🖥️ VPS / RDP from the menu, promos and bundles, and turn the failure into an auto-ticket + "we'll message you when it's back" (1 config change + 1 guard). Owner: infra. *Impact: only checkout with a funded user waiting.*
2. **Replace seeded social proof with real counts** (or remove). Real 7-day numbers exist in `payments`/`cartRecovery`; if too small, show lifetime totals or none. ~30 lines.
3. **Move `recordPaymentCompleted`/`markPurchased` after a successful charge** (inside each `walletOk[*]` after `atomicIncrement` succeeds). 2-line move + test.
4. **One price table, one source.** Delete the `$0.04/min` copy in `monetization-engine.js`; read `OVERAGE_RATE_MIN`/`CALL_FORWARDING_RATE_MIN` from phone-config everywhere; audit promos/AI KB for "$3 domains", "500 min Pro", etc. (`grep` sweep, hours).
5. **Cart nudge copy:** replace "/menu → 🎟️ Daily Coupon" with the actual coupon code and a `/start` deep link to the abandoned product.

### Quick wins (copy, order, defaults — hours)
6. **Menu hierarchy:** row 1 = 📞 Cloud IVR + SIP (with "from $50/mo") · 🆓 Try Free; row 2 = Hosting · Domains; row 3 = Digital Products · VPS(if live); push Refer & Earn, Reseller, Join Channel, Upgrade Plan into ⚙️ More. Add price hints to hub buttons ("🛡️ Anti-Red Hosting · from $30").
7. **Trial endings sell:** after `/testsip` code and after the Quick IVR trial, send one button: "Get your own number — ⭐ Pro $75/mo (25 % off first month with WELCOME25)" that pre-selects the plan (`cpPlanKey=pro`) and jumps to country. Also auto-attach the user's live welcome coupon so it's applied without typing.
8. **Collapse the Starter disclaimer to one line on the plan picker** and rename the ladder so the product name matches the entry plan (e.g. "📞 Number Only $50 · ⭐ Cloud IVR Pro $75 · 👑 Business $120"), or make Pro the default highlighted button.
9. **Show hosting total:** on the domain-found screen print "Golden HostPanel $100 + exbytes.com.au $65 = **$165 today**" and offer "Use a .com instead (from $30)".
10. **Domains:** show price first; ask the shortener question after payment (or default No with a post-purchase toggle — it already exists in Manage Domains).
11. **URL Shortener plan copy:** stop saying "from $50/day" beside free links; present as "Pro toolkit: unlimited links + 5,000 validations — $50" or move plan to the validation hub.
12. **Balance wall → amount pre-filled:** one shared wall component: "You need **$34 more**. [💵 Deposit $34] [💵 Deposit $50 (+$5 bonus)] [Cancel]"; skip the wallet menu.
13. **Underpayment/overpayment message:** add "[✅ Pay remaining $X from wallet]" that re-runs the stored `walletOk[lastStep]`.
14. **Typed text fallback:** if a message isn't a button and isn't a command, route to AI support with the current context instead of `t.what`.
15. **Welcome offer message:** include a deep link that lands on the hub the user browsed most and auto-applies the code; change "Tap /start and browse" accordingly.

### Structural (days–weeks)
16. **Order resume:** call `saveResumableSession` at every `*-pay` action; on deposit credit, if a resumable order exists and balance now covers it, send "✅ $100 credited — [Complete my Pro plan order $75] [Not now]".
17. **First-session funnel by intent:** after language, ask one question ("What do you need today? 📞 Numbers/IVR · 🛡️ Hosting · 🌐 Domains · 🛒 Accounts · 👀 Just looking") and open that hub with its free hook; keep the full menu one tap away. Replaces the 17-button dump for first-timers only.
18. **Lifecycle diet:** cap unsolicited messages at 1 per 24 h per user; suppress AutoPromo for users < 72 h old (they're already in the welcome sequence); pause promos for anyone who has seen a balance wall until they deposit (send the shortfall reminder instead); add a one-tap "🔕 Mute promos" button to every promo. Measure lift per blast (`/start` and hub taps within 45 min) in `promoStats` and stop themes with zero lift.
19. **Packaging for first purchase:** a "Starter Bundle" that fits the $20/$50 presets — e.g. Pro Cloud IVR first month $50 with WELCOME25 (= one deposit preset), or hosting-week + domain at a flat price — so first deposit equals first purchase with no leftover.
20. **Regional VPS pricing transparency:** show "prices vary by region" and keep the affordability line stable (compute against the cheapest region) or pick region after plan.
21. **Localization parity:** close the 33 missing keys (`scripts/check_lang_parity.js`), and make language switching work from any state (Lalapmo needed 4 attempts).
22. **Resolve floors early:** show Bulk IVR "$50 wallet minimum" on the hub button/first screen and block at Caller-ID with a pre-filled deposit; same for forwarding $25.

---

## 4. Suggested 30-day sequence

**Week 1 — stop the bleeding (P0):** hide/fix VPS + auto-ticket on provisioning failure · remove fake social proof · fix markPurchased ordering · single price source + copy sweep · fix cart-nudge copy. Re-pull logs after 7 days: expect balance-wall users to start receiving welcome offers again, VPS refunds → 0.

**Week 2 — shorten the path (quick wins 6–15):** menu hierarchy + price hints · trial-ending CTA with pre-selected Pro · hosting total line · domain price-first · shared balance wall with pre-filled shortfall · pay-remaining button · typed-text → AI · welcome-offer deep link. KPI: new-user taps-to-price ≤ 2, deposit-amount screens per wall ≥ 50 %, `/testsip` → plan picker ≥ 20 %.

**Week 3 — resume & bundle (16, 19, 22):** resumable orders on deposit credit · first-purchase bundle matching presets · early floors. KPI: deposit → purchase within 24 h ≥ 60 % (this week: 1 of 1 new depositor did **not** purchase).

**Week 4 — messaging diet & measurement (17, 18, 20, 21):** intent question for first-timers · promo frequency cap + mute button + per-blast lift metric · regional pricing note · localization gaps. KPI: blocked-per-blast < 3 %, ≥ 1 welcome coupon redeemed per 10 sent, promo `/start` lift measurable.

---

## 5. Method notes & limitations
- Logs are read-only Railway `environmentLogs` (project token), service `b9c4ad64`, 2026-09-07 19:55 → 09-14 20:00 UTC. Multi-line bot replies are split by Railway, so outgoing screens were counted with targeted filters (`ops/railway_journey_pull.js <filters…>`); counts are lower bounds.
- Real user accounts/live bot were not driven; findings rest on the exact copy users receive (`js/lang/en.js`, `phone-config.js`) plus these logs.
- Sandbox stays on isolated local Mongo; nothing was written or sent.
- Already fixed since earlier reports and **excluded** here: shortlink dedup bug, `/start` debounce, wasted deposit-method tap (bank hidden), TRC20 floor interstitial, over/under-payment crediting, guided-intro/Skip-Intro screen (disabled), Bulk IVR NANP, VPS delete spam.
