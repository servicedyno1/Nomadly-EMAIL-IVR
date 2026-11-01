# Business Texting: clear plans and a cleaner setup flow (UX review + fixes)

Makes the Texting plan a 4th plan that stands apart from Starter, Pro and Business, everywhere a customer sees plans. Texting setup moves out of "Buy a number", and new visitors can sign up straight onto the Texting plan from the landing page.

## Who it's for
- Businesses that want texts on the office, landline or toll-free number they already have, without moving their calls.
- Existing CloudIVR customers who want to add texting to a number on their current plan.
- The owner/admin, who handles bill-help requests and approvals.

## Core features and experience
1. **UX review first (programmatic, phone + desktop, English + Spanish)**
   - A walk-through of every texting touchpoint: landing pricing, sign-up, Buy a number, Texting page, setup steps after payment, number panel, admin queue.
   - Checked for confusing or mixed plan wording, duplicate headings, dead ends, prices that don't match, untranslated text, layout breaks and tap-target problems.
   - Findings are written up as a short list, and each one is fixed in this phase or noted as a later item.
2. **Four distinct plans**
   - Starter, Pro and Business stay the calling plans.
   - **Texting plan** is the 4th plan: $150 once, then $100/month, 50 incoming texts a month included, then $0.05 per text. Extra numbers are $150 each and share the plan's renewal.
   - Adding texting to an existing calling plan is shown separately as an **add-on**, never called a "plan": Starter $150 (up to 5 numbers), Pro $120 (up to 10), Business $100 (unlimited), no monthly fee, renews with that plan.
   - The same names and prices appear on the landing page, in the app, on wallet lines and in admin.
3. **Setup flow (Texting page only)**
   - Remove the "Use my existing business number" option from Buy a number.
   - Buy a number keeps one short line linking to the Texting page.
   - The setup on the Texting page opens with a clear first choice:
     - **Start a Texting plan** (for anyone, including people with no CloudIVR number).
     - **Add texting to one of my plans** (only shown when they have one).
   - After that choice it asks for the number, checks it and takes payment.
   - The texting setup's duplicate heading is removed.
4. **Landing page**
   - The pricing section gets a 4th card, "Texting plan": price, "50 incoming texts/month", "keep your number and calls", and a "Start texting" button.
   - Other "Landline to Texting" copy points to that card.
5. **Sign up straight onto the Texting plan**
   - "Start texting" on the landing card goes to sign-up, then lands on the Texting page with "Start a Texting plan" already picked.
   - Google sign-in keeps the same intent.
6. **Rules kept from the last round**
   - Nothing about the code, letter or bill shows before payment. The code comes by phone call only.
   - A verified code means no letter or bill is needed.
   - No-bill help is free and goes to the admin queue.
   - Replying to US mobiles needs 10DLC, with "Ask us to register it".

## User flow
- **New visitor:** Landing → Pricing → Texting plan "Start texting" → Sign up → Texting page (Texting plan picked) → enter number → Check → Pay $150 → code call (or skip → sign letter → bill / contact support) → review → active.
- **Existing customer with a plan:** Texting page → "Add a number" → "Add texting to one of my plans" or "Start a Texting plan" → number → Pay → same steps after payment.
- **Buy a number:** new numbers only, plus a one-line link: "Already have a business number? Add texting to it."

## UI/UX feel
- Same CloudIVR look as today. The Texting plan card matches the other plan cards but has its own icon and label so it reads as a separate product.
- Plain wording: "plan" only for the four plans, "add-on" for texting on a calling plan.
- Phone-first layouts with large tap targets. English, Spanish and French all have full sentences, with no half-translated lines.

## Implementation phases
1. **Phase 1 (MVP, built now)**
   - The UX review and its fixes.
   - The Texting plan as a 4th plan with consistent naming.
   - The landing pricing card.
   - Texting setup removed from Buy a number (link kept) and the first-choice step on the Texting page.
   - Sign-up straight onto the Texting plan.
   - Updated translations.
   - Preview only until you say "push live".
2. **Phase 2:** self-serve 10DLC registration from the number panel, and a usage meter for the 50 included texts with a low-allowance notice.
3. **Phase 3:** upgrade between the Texting plan and calling plans (e.g. Texting plan → Pro keeps the number and its texting), plus a texting-only dashboard view for Texting-plan-only customers.

## Assumptions
- The UX review is automated (screen checks on phone and desktop), not a test with real users. It runs in preview with demo accounts.
- The Texting plan card on the landing page shows "$150 to start, then $100/month". It doesn't show it as "$100/month" alone.
- Customers with only a Texting plan still see the normal app menu, with texting near the top. A texting-only view is phase 3.
- "Add a number" on the Texting page stays the main button. It is the only way into setup inside the app.
- Prices are fixed in the app, not editable from admin.
- The real (855) 757-4001 order and its preview record are left as they are.
- Nothing goes live on cloudivr.net until you approve deployment.
