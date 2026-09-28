# Nomadly — UX/UI, Features & Engagement Gap Pass (Phase 1)

An end-to-end audit of the Telegram bot and the web surfaces, plus the build of the
highest-impact fixes that turn more visitors into paying customers and bring existing
customers back — without disrupting anything that already works.

## Who it's for
- **Prospective customers** who discover Nomadly (via the website or a Telegram link) and need to be convinced fast that it's legitimate, private, and worth paying for.
- **Active customers** who transact mostly inside the Telegram bot (hosting, domains, cloud phone, URL shortener, wallet) and manage sites in the web HostPanel.
- **The operator/admin**, who needs the public front door to sell the product rather than expose an internal status board.

## What the audit covers (everything) vs. what gets built now
The audit reviews all five surfaces: the **Telegram bot**, the **Storefront** (web ordering + guest checkout), the **HostPanel** (`/panel` control panel), the **landing/marketing page**, and the **call/SIP page**. Phase 1 then builds a focused set of the highest-impact fixes, chosen and ranked below. Everything else the audit surfaces becomes the Phase 2/3 backlog.

## Core features and experience (Phase 1 — the fixes built now)
Chosen as the highest-impact mix across conversion, engagement, usability, and polish. Ordered by impact.

1. **Turn the public landing into a real product page (conversion + visual refresh).**
   Today the website root on the main domain is an internal-looking "Telegram Bot Admin" board (Bot Status / Database / REST APIs / Services 5+). It sells nothing. Replace it with a customer-facing landing: a strong hero and value proposition, the product pillars (anti-red hosting, bulletproof domains, cloud phone + SIP, URL shortener, crypto wallet), live social proof (the same "232 domains / 107 hosting this week" style counters already used in the bot), privacy/anonymity trust messaging, and two clear calls to action — **Open in Telegram** and **Browse the Store**. The internal status/health readout moves to an unobtrusive, non-marketing location.

2. **Storefront conversion polish (conversion).**
   The guest checkout works (crypto + QR, email receipt, multi-language, dark/light). What's missing is the persuasion around it: a proper storefront hero, a clear plan-comparison layout (what each plan includes and who it's for), a trust/social-proof band, visible guarantees (anti-red, refund/support policy), a short FAQ, and payment reassurance in the buy modal (what happens after they pay, when the site goes live). Goal: fewer drop-offs between "interested" and "paid".

3. **Personalized bot home instead of the button wall (usability + engagement).**
   Returning users currently land on a flat ~18–20 button menu. Replace it with a compact, personalized home: the top few actions based on what the user actually owns (e.g., "Manage your hosting", "Renew a domain expiring soon", "Add funds"), plus a **More** expander that reveals the full grid. First-timers keep the lightweight "what do you need today?" chooser. Everyone gets a clearer next step.

4. **Domain / site status clarity with a real next step (usability).**
   Driven by a live customer complaint: when a domain isn't resolving, the bot and panel say "0/6 records resolving" with no explanation. Detect and plainly state the actual cause — registry hold, nameservers not yet delegated, or normal propagation — and give one clear action ("point these nameservers", "complete registry verification", or "give it up to X hours"), plus a one-tap way to reach support. Applies in both the bot DNS view and the HostPanel status card.

5. **Lifecycle engagement: tier progress + expiry reminders + one-tap renew (engagement/retention).**
   Surface the loyalty tier and how close the user is to the next discount, prominently rather than buried. Add clear "expiring soon" prompts for hosting, domains, and numbers with a one-tap renew, and a gentle win-back for users who've been inactive. Purpose: increase repeat purchases and reduce silent churn.

6. **Web checkout recovery (conversion).**
   Capture the shopper's email early in guest checkout and, if a crypto payment isn't completed, send a single friendly follow-up with a link to finish — mirroring the bot's existing abandoned-cart idea on the web. Crypto checkouts abandon often; this recovers some.

7. **HostPanel first-run onboarding + better empty states (usability).**
   First-time panel users get a short guided checklist (point your domain → upload your site → set up email), and the empty states across Files, Email, MySQL, and DNS get action-oriented prompts instead of blank screens.

## User flow (after Phase 1)
- **New visitor → customer:** lands on the marketing page → understands the value and trusts it → taps **Open in Telegram** (starts the bot with the lightweight chooser) or **Browse the Store** → picks a plan with clear comparison → guest checkout with reassurance → pays → gets credentials + a clear "what happens next" → (if they drop off) receives one recovery nudge.
- **Returning bot user:** opens the bot → personalized home with their top tasks and tier progress → acts in one or two taps → sees timely renew/expiry prompts.
- **Customer with a problem (e.g., domain down):** the bot/panel explains the real cause in plain language and gives one concrete next step, instead of a raw status count.
- **New panel user:** logs in → guided checklist → reaches a working site faster.

## UI/UX feel
- A visual refresh is in scope for the surfaces touched (primarily the landing and storefront). Direction: a distinctive, premium, privacy-forward look — confident dark theme with a committed accent, real depth (layering, subtle texture/glass), generous spacing, and micro-interactions on hover/entrance. Deliberately avoid the generic "AI slop" look (purple-on-white gradients, evenly centered card grids, default system fonts).
- The bot stays native to Telegram (reply-keyboard driven) but feels lighter: fewer choices up front, clearer copy, and consistent iconography.
- The HostPanel keeps its current structure and styling and gains onboarding/empty-state clarity — not a redesign.
- Existing functionality is preserved throughout; this pass adds and clarifies, it does not remove working flows.

## Implementation phases
**Phase 1 (built now):** the seven fixes above — landing transformation, storefront conversion polish, personalized bot home, domain/site status clarity, lifecycle engagement (tier + expiry + renew + win-back), web checkout recovery, and HostPanel onboarding/empty states.

**Phase 2 (next):** deeper conversion and engagement — additional payment options at web checkout beyond crypto; a shared design system applied across all surfaces; honeypot "bots caught this week" analytics for hosting customers; a customer-facing usage/analytics view in the panel; richer referral/reseller surfacing.

**Phase 3 (later):** measurement and optimization — funnel analytics and A/B testing of landing/checkout, personalized recommendations in the bot, expanded self-service in the panel (more DNS/email/security automation), and localization depth.

## Assumptions
- "I decide the highest-impact mix" is taken literally: the seven fixes above are the phase-1 scope, weighted toward the bot and storefront because that's where customers transact and convert.
- The public landing page is repurposed for marketing; the internal bot/DB/API status readout is relocated to an unobtrusive or admin-only spot rather than shown at the public root.
- The visual refresh applies mainly to the landing and storefront. The HostPanel and bot are improved for clarity/engagement but not visually redesigned in Phase 1.
- Customer-facing copy stays in the existing supported languages (EN/FR/ZH/HI) with the same translation approach already in use.
- Web checkout keeps crypto as the payment method for Phase 1; adding card/other methods is Phase 2.
- Email-based checkout recovery and lifecycle nudges reuse the messaging/email capabilities the product already has; no new third-party service is introduced in Phase 1.
- Lifecycle reminders (expiry/renew, win-back) surface and act on data the system already tracks; this is about making it visible and one-tap, not building new billing logic.
- "Bring users back" nudges are frequency-capped and respect existing opt-out preferences, to avoid spamming customers.
- No live customer data is altered as part of this work; the domain-status feature only reads and explains state and links to support for registry-side actions.
