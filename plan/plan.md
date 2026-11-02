# CloudIVR Landing Page Refresh: eSIM and Real US Mobile Number First

A rewritten cloudivr.net landing page that leads with two products: the CloudIVR eSIM and a virtual US mobile number on a real carrier (not VoIP). Both can be ordered directly from the page, without an account.
The page also gets an honest review of copy against what the product really does, light-mode screenshots of the current app, and a mobile-first pass over the landing page and the related app screens.

## Who it's for
- **Travellers and remote workers** who want a US eSIM with data, calls and texts on their own phone.
- **People who need a real US mobile number** to receive bank codes, app sign-ups and two-factor texts, where VoIP numbers are often refused. They read and send these texts in CloudIVR on the web, with nothing to install.
- **Small businesses** that already use, or will use, CloudIVR calling numbers, keypad menus (IVR), campaigns and Messages.
- **Mostly visitors on phones**, often arriving from ads or links.

## Core features and experience

### 1. Top of the page (hero): two products, side by side
- **Headline** covering both products. Example: "A real US number on a real carrier. On your phone, or right in your browser."
- **Two product cards** with price, 3–4 short benefit lines and an order button on each:
  - **CloudIVR eSIM ($75/month).** Install it on your phone with a QR code. US data, calls and texts. The QR code is shown in the app and emailed to you.
  - **US mobile number ($75/month).** A real carrier mobile number, not VoIP, accepted by most banks and apps. Send and receive texts in CloudIVR Messages, with no phone or SIM needed. You pick a ZIP code, and the exact number is shown after payment. Texts only for now; calls coming later.
- **"Which one do I need?" line** under the cards. "Want the line on your phone? eSIM. Want the number in your browser? US mobile number."

### 2. Ordering from the landing page (no account needed)
- The **eSIM** keeps its current landing checkout. It asks for the phone's ID (IMEI) and the email for the QR code, then creates the account and takes payment by card-free crypto or wallet, as today.
- The **US mobile number** gets the same style of checkout:
  - ZIP code, email, then account creation at checkout, then payment.
  - Clear wording: "You can't pick the exact number. The carrier assigns it after your payment is confirmed. ZIP code is a preference."
- **After payment, both lead into the app:**
  - The eSIM goes to its page with the QR code.
  - The mobile number goes to My numbers ("Number coming"), then to Messages once it's assigned.
  - The mobile number is also added as a verified caller ID automatically, for free.

### 3. Copy review against the real product
Every claim on the page gets checked and corrected to match what works today:
- **US mobile number:** texts in and out in Messages, and an automatic free caller ID.
- **Not promised:** calls on the mobile number, or a guaranteed area code.
- **eSIM:** texts and calls stay on the customer's phone; the eSIM does not text from CloudIVR.
- **Bank wording:** "Real carrier number, accepted by most banks and apps." Never "works with every bank."
- **No VoIP mention for the eSIM**, beyond saying it's a real carrier line.
- **"Ring in CloudIVR" for eSIM calls** is not advertised until Spenza turns on call routing.
- **Calling numbers, keypad menus (IVR), campaigns, AI voice agents, Landline to Texting and the browser phone** stay on the page, below the two new products, with their prices and limits checked against the app.
- **Small print and help** answer the obvious questions:
  - Is it VoIP?
  - Can I choose the number?
  - When do I get it?
  - Does it work with my bank?
  - What happens if I don't renew?
  - Can I replace the number? ($25)

### 4. Real app screenshots in light mode
- Replace today's dark in-app pictures with **current screenshots of the app in light mode**, taken from the latest version.
  - Messages with a bank-code style text
  - My numbers showing a mobile number
  - The eSIM page with the QR card
  - A keypad menu
  - The Overview page
- Each screenshot comes in a **desktop version and a phone-sized version**. On phones the page shows the phone-sized one.
- Screenshots use made-up sample data (sample numbers and names), never real customer details.

### 5. UI/UX and navigation review (landing page and related app screens)
- **Landing page:**
  - Shorter sections, one clear action per section.
  - A sticky "Order" button on phones.
  - Menu links that jump to eSIM, US mobile number, Business calling, Pricing and Help.
- **Related app screens**, checked for clarity and quick navigation:
  - CloudIVR eSIM page
  - My numbers → Mobile numbers for texting
  - Buy a number (US mobile offer)
  - Messages (new message, sender choice)
  - IVR "Send the caller a text"
  - Overview
- Fixes are limited to **wording, layout, spacing, empty states and links between these screens**. One example: from the eSIM page, point people who want web texting to the US mobile number. No new features beyond what's listed here.

### 6. Mobile optimisation
- The landing page and the related app screens work cleanly **from 320px wide and up**:
  - no sideways scrolling
  - buttons large enough to tap
  - forms that bring up the right keyboard (numbers for ZIP and IMEI, email for email)
  - checkout steps that fit one screen each
- Images are sized for phones so the page loads quickly on mobile data.

## User flow
1. A visitor lands on cloudivr.net and sees the eSIM and US mobile number cards at the top.
2. They tap **Order** on one card. The checkout asks only what that product needs, plus an email and password.
3. They pay (wallet top-up by crypto, as today) and land in the app:
   - **eSIM:** QR code shown and emailed. Install it on the phone.
   - **US mobile number:** "Number coming", then the number appears. Texts arrive in Messages, and it's a caller ID automatically.
4. Business visitors scroll past the two cards to calling numbers, keypad menus, campaigns and pricing. They sign up as today.

## UI/UX feel
- **Light, clean and trustworthy:** white and soft-grey backgrounds, one strong accent colour, generous spacing, and clear prices.
- **Telecom-credible, not "app-y":** short, concrete copy ("Real carrier number", "Number shown after payment"), with small trust notes near the order buttons.
- **Phone-first layout,** with the two product cards stacked on phones and side by side on larger screens.
- **Subtle motion only:** cards and screenshots fade in as you scroll.
- The visual direction is set by a dedicated design pass that matches the latest light-mode app.

## Implementation phases

**Phase 1: built now (MVP)**
- New hero with the eSIM and US mobile number cards, plus the "which one do I need" helper.
- US mobile number landing checkout (ZIP, email, account, pay), next to the existing eSIM checkout.
- Full copy review and rewrite across the landing page, including the help questions above.
- Light-mode real app screenshots, desktop and phone versions.
- Mobile optimisation of the landing page and both checkouts.
- UI/UX clean-up of the related app screens listed in section 5 (wording, layout, links, empty states).
- All of this goes to preview only, and goes live only when the owner says "push live".

**Phase 2**
- Calls on the US mobile number, once they're built and tested.
- "Ring in CloudIVR" for eSIMs on the page, once Spenza enables call routing.
- Card payments at checkout, if a card provider is added.
- Spanish and French versions of the new copy.

**Phase 3**
- Separate landing pages per use case (travel eSIM; US number for bank and app codes) for ads.
- Customer reviews and trust badges.
- A/B tests on headlines and prices.

## Assumptions
- **Prices** stay as agreed: eSIM $75/month, US mobile number $75/month, number replacement $25, texts $0.05 each.
- **Mobile-number ordering on the live site:** the order button shows only when the provider setup it needs is in place (the phone ID, `SPENZA_TEXT_LINE_IMEI`). Until then the live page shows the card with "Coming soon / Join the waitlist" instead of a broken checkout. Preview shows the working checkout.
- **Payment** at the landing checkout works as today: wallet top-up by crypto, then the order is placed. No new payment provider is added.
- **Customer-facing names** stay "CloudIVR eSIM" and "US mobile number". Spenza is never named.
- **"Not VoIP" wording** applies to the US mobile number and the eSIM only. Calling numbers keep their current descriptions.
- **Business features** (calling, IVR, campaigns, AI agents, Landline to Texting) move below the two products but are not removed.
- **Light mode** becomes the default for the landing page. The app's own dark/light setting is not changed.
- **Screenshots** use sample data on a test account and are retaken whenever those app screens change.
- **The UI/UX review** produces fixes inside this phase only for the screens listed. Larger redesign ideas are noted for later, not built now.
- **New copy is English first.** Existing Spanish/French landing text is kept where it still matches and updated in Phase 2.
- **Scope stays in preview** until "push live". Saving to GitHub deploys to the live site automatically, so saves are held until approval.
