# CloudIVR: Old Home Back with Plan Details, and Travel eSIM Install on Every Phone

The CloudIVR web app goes back to the Home page customers had before this session. Each number in its list now shows clearly which plan it is on and what that plan includes.
Travel eSIMs get working one-tap install buttons for both iPhone and Android, and the phone's own button comes first on a phone.

## Who it's for
- CloudIVR web customers who own one or more numbers and want to see their plan, what it gives them and when it renews.
- Travellers who bought a Travel eSIM (for example the Netherlands eSIM on onarrival21@gmail.com) and need to install it on the phone they travel with.

## Core features and experience

**1. Undo this session's new work (except the eSIM fix)**
- Home goes back exactly as it was: stats row, guided tasks, "Your numbers" list with the Calling / Mobile / Texting tabs, products grid. "Recent activity" stays removed, as asked earlier.
- Removed: the new Home sections (plan hero, platform grid, standalone services strip), the AI receptionist page and its menu entry, the receptionist settings (office hours, "answer only outside hours"), the receptionist inbox, and the monthly calls-and-texts usage invoices.
- Menu and links for the AI receptionist go back to the old shared AI agents page.
- Stays: the Bird Travel eSIM is linked to onarrival21@gmail.com. This was a fix to production data and is already live.

**2. Plan details inside the old number list**
- On Home, every calling number in "Your numbers" shows:
  - a plan badge (Basic, Starter, Pro, Business) and the monthly price;
  - whether it is the main number or an extra number on the plan;
  - minutes used out of the plan's minutes this month (shared with its extra numbers);
  - renewal date and whether auto-renew is on;
  - a short "Includes" line, for example "Forwarding · Voicemail · Keypad menu · Bulk IVR · AI agent · Fax", plus "Upgrade to Pro" when a higher plan exists.
- Opening a number goes to its page, as it does today. "Upgrade" goes to that number's Billing tab.
- Texting Numbers and Landline texting keep their own tabs, labelled as separate services rather than plans.
- Before the build, a design expert reviews this list against how telecom and SaaS dashboards present plans, so the layout follows proven patterns and is not new invention.

**3. Travel eSIM install on iPhone and Android**
- Every travel eSIM shows "Install on iPhone" and "Install on Android". The Android button is missing today because Bird only sends an iPhone link.
- Both buttons use the official one-tap install links from Apple and Google, built from the eSIM's activation code.
- On an iPhone, "Install on iPhone" is the large first button. On an Android phone, "Install on Android" is. The other button, the QR code and the manual code (with copy) stay below.
- On a computer, the QR code comes first, with a note to scan it with the phone you travel with.
- Buttons open the phone's own eSIM installer, not a page inside the app.
- A short help line explains: iPhone needs iOS 17.4 or later; Android needs Android 10 or later with Google services up to date (most Pixel and Samsung phones). Otherwise use the QR code or the manual code.
- Each eSIM card stays readable on a 390px-wide phone screen: no sideways scrolling, and the long manual code wraps or truncates with copy.

## User flow
1. Customer opens Home → sees the old layout → each number row shows its plan, minutes, renewal and what is included → taps Upgrade or opens the number.
2. Traveller opens Travel eSIM on their phone → sees their eSIM with the phone's install button on top → taps it → the phone's eSIM setup opens → confirms → done.
3. If one-tap install doesn't work on their phone → scans the QR code from another screen, or copies the manual code into the phone's eSIM settings.

## UI/UX feel
- Same look as the old Home and the current app theme, light and dark.
- Plan details fit inside each number row and stay compact: one badge, a thin minutes bar, one line of included features. No new large blocks.
- Status colours meet readability contrast in light mode.
- Install buttons are large and easy to tap on phones (at least 44px high).

## Implementation phases
**Phase 1 (MVP, built now)**
- Undo this session's Home, AI receptionist and usage-invoice changes. The eSIM data fix stays.
- Expert design review, then plan details in the old "Your numbers" list.
- iPhone + Android install buttons, the phone's button first, mobile layout check on iPhone-size and Android-size screens.
- Publish together to all brands (main and WhiteLabel) at the end, as agreed earlier, after testing passes.

**Phase 2**
- Same plan details on the "My numbers" page and on each number's Overview tab.
- An email that sends travel eSIM install links to the customer's phone.

**Phase 3**
- Revisit, as separate requests: a dedicated AI receptionist page, and invoices for per-call and per-text usage.

## Assumptions
- "Undo everything from this session" means: keep the onarrival21@gmail.com eSIM link, and remove all other code changes made in this session.
- Three items from earlier in the session are **not** being built now, because of the undo. They stay open:
  - an invoice for every call and text charge (only orders, renewals, top-ups and refunds have invoices today);
  - a separate AI receptionist;
  - copying the guard that stops USA Texting Numbers being added as Bird caller IDs to the three WhiteLabel brands. The main brand already has it, and no brand currently has a texting number set as a caller ID.
- The previous number list is restored as it was, and plan details are added to it. Its order and tabs do not change.
- The Android link is built from the activation code Bird already provides. Bird's own install links are used when Bird sends them.
- The phone type is detected from the browser. If detection is unsure, both buttons show with equal weight.
- Install buttons are tested on phone-size screens in the preview. A real install on a physical iPhone and Android phone needs the user's devices. This plan doesn't claim that test as done.
- Nothing billable is bought, and no new eSIM is ordered.
