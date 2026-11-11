# CloudIVR Web App — Simpler Navigation and Modern Redesign

A reorganized, modern CloudIVR web app where customers find each feature quickly, grouped by the job they want to do rather than by technical category.
It keeps every current feature and adds a guided home screen, a clearer menu, and a consistent new look in both light and dark mode.

## Who it's for
- CloudIVR business customers, mostly non-technical small-business owners and teams, who buy numbers, answer calls, run outbound calling (IVR, campaigns, AI agents) and send texts.
- New customers who need a clear first step, and existing customers who already know the features but get lost moving between them.

## Core features and experience

### 1. Menu grouped by what customers want to do
The current menu has 4 groups, several items with up to 6 hidden tabs each, and job names that use internal terms. For example, "AI voice agents" sits under "Outbound" even though agents also answer incoming calls, and Contacts and Audio library sit under "Calling". The new menu is organized around jobs:

| Group | What's in it |
|---|---|
| **Home** | Guided home, Messages, Live activity |
| **Phone numbers** | My numbers, Get a number, eSIM and mobile, Add texting to a landline, Fax |
| **Answer calls** | Keypad menus (IVR), Call forwarding and voicemail, AI receptionist (agents answering numbers) |
| **Make calls** | Quick call, Text-to-voice call, Bulk campaigns, AI calling agents, Do-not-call list |
| **Contacts and media** | Contacts, Audio library |
| **Connect devices** | SIP and softphone logins, Browser phone |
| **Account** | Wallet and billing, Settings, Help center |

- Labels are plain and action-led ("Get a number", not "Buy a number"; "AI receptionist", not just "AI voice agents"). Technical terms (IVR, SIP) stay in short subtitles so experienced users still recognize them.
- Every feature stays visible in the menu and on its page. Nothing moves behind an "Advanced" reveal. Long settings pages get clear section headings and an in-page jump list.
- All existing web addresses and bookmarks still work and redirect to the new location.

### 2. Guided, task-based home
- The home screen leads with "What do you want to do?" and offers large task cards: Get a business number, Answer my calls (menu, forwarding or AI receptionist), Call a list of leads, Send texts, Set up an AI agent, Connect my phone or softphone.
- Each card opens a short step-by-step setup, such as "Answer my calls: 1) pick a number, 2) choose how calls are answered, 3) test it". Each step links to the real settings.
- A "Your setup" checklist tracks progress (number bought, calls handled, first campaign, wallet funded) and stays until it's complete or dismissed.
- Below the tasks, a compact overview shows balance, active numbers, live calls, unread messages and recent activity. The existing stats and banners move into it.
- The home adapts to the customer. Someone without a number sees "Get a number" first. Someone with numbers and no call handling sees "Answer my calls" first.

### 3. Consistent page layouts
- Every page uses the same layout: a header with title, one-line description and a main action button on the right; sub-sections as tabs under the header; then the content.
- Sub-pages show a breadcrumb trail, such as Phone numbers › +1 334… › Billing.
- Each number's settings page gets a clear tab order: Overview · Answering · Texting · Recordings · Billing. Its quick actions (assign AI agent, add extra number, renew) stay on the Overview tab.
- Empty pages show a short explanation and one clear next-step button.

### 4. Modern visual refresh in light and dark
- A new design system covers typography, spacing, colors, buttons, inputs, cards, tables, tabs, dialogs and toasts, and every page uses it.
- Light and dark mode both get full support and have equal quality. A "Match my device" option stays. The setting is in the account menu and in Settings.
- Hover, focus and transition states stay subtle. Loading placeholders replace bare spinners where content takes time to load.
- Accessible contrast in both themes, visible keyboard focus, touch targets of at least 44 px on phones.

### 5. Quicker ways to get around
- Search and command palette (⌘K / Ctrl K, already in the app) finds every page, number, agent, campaign and contact. It also runs actions like "Get a number", "Start a campaign" and "Add funds".
- Contextual help: the "?" button opens help for the current page. Short inline hints appear next to confusing fields.
- Phone layout: the bottom navigation bar uses the same new groups, and the "More" sheet lists everything else.

## User flow
1. A customer signs in and lands on the guided home, which highlights the next most useful task based on their account.
2. They choose a task card, for example "Answer my calls", and follow 2–4 short steps that take them through the real settings.
3. To find something specific, they open the matching menu group or use search (⌘K).
4. On any page the layout is the same, so the main action is always in the same place, top right.
5. The setup checklist on home marks progress until the account is fully set up.

## UI/UX feel
- Calm, clean and professional, in the style of current business tools such as Stripe, Linear and Intercom.
- Readable type, generous spacing, fewer competing colors, one accent color for main actions.
- Dark mode is fully finished, not an afterthought. Light mode is bright and crisp.
- Clear, friendly wording that names the outcome ("Answer my calls"), with technical terms secondary.

## Implementation phases

### Phase 1 — MVP (built now)
- New job-based menu (desktop sidebar and phone navigation), plain labels, redirects for all old addresses.
- Guided task-based home with task cards, short step-by-step setups, an adaptive "next task" and the setup checklist, plus the compact overview.
- New design system applied across every page in both light and dark mode.
- Consistent page header, tabs, breadcrumbs and empty states on all pages. Clearer tab order on each number's settings page.
- Search and command palette extended to cover the new groups and quick actions.
- Every existing feature keeps working the same way. This release changes only placement, wording and appearance.

### Phase 2 — Later
- First-visit guided tour of the new menu for existing customers, plus a "What's new" summary of where things moved.
- Inline contextual hints and short how-to videos on the most complex pages (campaigns, keypad menus, AI agents).
- Saved favorites and shortcuts in the menu.

### Phase 3 — Later
- Measure where customers get stuck (page visits, abandoned setups) and simplify those screens further.
- Customizable home (reorder or hide cards) and per-team role views.
- Usability check with real customers, then polish based on the feedback.

## Assumptions
- **Navigation and visuals ship together in the first release**, since all three focus options were selected.
- **No feature is removed or hidden.** Everything stays visible and is regrouped and relabeled, as requested.
- **Light and dark mode** both get full support, with "Match my device" as the default. The app already has this switch, so it is being upgraded, not built from scratch.
- **Group names and labels** in the table above are the proposed wording, and some feature names change ("Buy a number" → "Get a number"). Technical terms stay as subtitles.
- **AI agents appear in two places:** "AI receptionist" under Answer calls and "AI calling agents" under Make calls. Both open the same agents, filtered by use.
- **Existing bookmarks and links** (including links in emails and Telegram) keep working through redirects.
- **The public CloudIVR website** (landing, pricing, legal pages) is not part of this redesign. Only the signed-in web app changes.
- **The Telegram bots are not affected.**
- **No changes** to pricing, plans, billing, call handling, campaigns, AI agent behavior or any backend logic.
- **Existing translations** (English, French, Spanish and others) cover all new and changed wording.
- **Changes reach customers** after the account owner's usual Save to GitHub / deploy step.
