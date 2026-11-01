# CloudIVR Messages — unified inbox + $25 number replacement

One inbox where each conversation is a person, not a feature: their texts, pictures, voicemails and calls in one timeline, like iPhone Messages and Phone combined.
Plus a self-serve "Replace this number" for $25, for CloudIVR calling numbers and eSIM lines.

## Who it's for
- CloudIVR customers with one or more numbers (calling plans, CloudIVR eSIM, Landline to Texting) who today jump between Inbox, number logs, Texting and eSIM pages to follow one customer.
- Owners and staff answering customers from a phone or laptop.

## Core features and experience
**Unified Messages**
- Conversation list (left) and thread (right); on phones the thread opens full screen. Sorted by latest activity, with unread dots, search by name, number or message text, and filters: All, Unread, Texts, Voicemail, Missed calls.
- One thread per contact per business number. If the same person contacts two of your numbers, they are two threads, each labelled with the number.
- The timeline mixes:
  - text bubbles (sent on the right, received on the left)
  - picture messages, with a full-screen viewer
  - voicemail cards with a play button, the length and the transcript
  - call rows ("Missed call 2:14 PM", "Answered · 3 min", "Outgoing · 1 min")
- Delivery status under sent texts: Sending, Sent, Delivered, Failed (with the reason). Day separators and grouped bubbles, like iMessage.
- **Smart number capabilities:** for each business number the app knows whether it can send, receive, send pictures and make calls, and shows only what works:
  - **Calling numbers bought in CloudIVR:** texts and pictures in and out where the number supports them, plus calls.
  - **CloudIVR eSIM:** texts in and out. Pictures can't be sent, because the eSIM provider's texting system has no picture support. Calls appear in the thread once calls are connected to CloudIVR.
  - **Landline to Texting:** receive-only. The reply box is replaced by "This number receives texts only".
  - If the person texted a different number than the one you would reply from, the thread shows which number your reply will come from.
- **Composer:**
  - text box, a cost hint (for example "$0.05 from your wallet") and a character or segment count
  - photo attach (camera or gallery) only on numbers that can send pictures; up to 5 images and about 600 KB total, shrunk automatically
  - quick replies, already in the app
  - "Call" and "Call back" buttons in the thread header open the browser phone
- Contact header with name (from Contacts if saved), number, "Save contact", "Block / do not contact", and the business number in use.
- Notifications, the unread count in the menu, and the existing Inbox bell all feed from the same conversations.
- The current Inbox stays as the activity and alerts feed (wallet, campaigns, system notices). Texts, voicemail and calls move to Messages.
- Old history is pulled in: past texts, voicemails and calls for each number show up in their conversations from day one.

**Replace a number ($25)**
- Button "Replace number" on a CloudIVR calling number's page and on each eSIM line.
- **Calling numbers:**
  - the customer picks the new number the same way as when buying (same country, type and area search)
  - $25 is paid from the wallet or with crypto
  - the plan, renewal date, IVR menu, forwarding, voicemail, caller ID settings and SIP access move to the new number
  - the old number keeps receiving calls and texts for 7 days (tagged "Old number" in Messages), then is released
- **eSIM lines (provider behaviour):**
  - the provider's "new number" request has no way to choose the number or area, and doesn't return the new number right away; it is "assigned soon"
  - the SIM switches to the new number, so the old number cannot stay active 7 days on an eSIM
  - the provider says replacements are limited by a monthly quota and lists no price
  - in CloudIVR: confirm → pay $25 → status "New number coming". The app checks until the new number appears, then updates the line, Messages and call routing, and notifies the customer
  - if the provider refuses (not allowed right now, or quota reached), the $25 is refunded automatically
- Landline to Texting numbers can't be replaced; they belong to the customer.
- Every replacement appears in wallet history and sends an Inbox notice with old and new numbers.

## User flow
1. A customer texts the business number → a new conversation appears at the top with an unread dot and a notification.
2. The owner opens it, sees the earlier missed call and voicemail in the same thread, plays the voicemail, attaches a photo and replies (or sees "receives texts only").
3. The owner taps Call to call back from the browser phone; the call shows up in the thread afterwards.
4. Replace number: Numbers → number → Replace number.
   - **Calling number:** pick a new number → see the $25 summary and what moves over → pay from the wallet or with crypto → the new number is live, and the old one shows "keeps working until <date>".
   - **eSIM:** confirm → pay $25 → "New number coming" → notified when it's assigned.

## UI/UX feel
- Calm and familiar like iMessage: rounded bubbles, sent bubbles in the app's accent colour, received in neutral grey, soft timestamps, smooth slide-in for threads on mobile.
- Voicemail cards and call rows sit quietly between bubbles and never look like errors; missed calls use a gentle red icon.
- Capability chips under the business number (Texts · Pictures · Calls · Receive-only) so nobody guesses.
- Fast: the list loads first, then threads stream in; new messages appear live.
- Fully usable at 320px, keyboard-friendly, with screen-reader labels. English, Spanish and French.

## Implementation phases
**Phase 1 — MVP (built now)**
- Messages page with the conversation list and threads mixing texts, pictures, voicemails and calls for all number types.
- Smart capabilities (send, receive, pictures, calls) per number.
- Sending and receiving pictures on calling numbers that support it; received pictures saved so they don't expire.
- Composer with costs and status, history pulled in, live updates and unread counts.
- Replace number for $25 on calling numbers (7-day overlap) and eSIM lines (provider-assigned number, auto refund on refusal), paid from the wallet or with crypto.

**Phase 2**
- Contact cards with notes and tags.
- Pin and archive threads.
- Saved replies per team member.
- Scheduled texts.
- Choosing the default reply number per contact.

**Phase 3**
- Group texts.
- AI thread summary and suggested replies.
- Assigning conversations to staff.
- Search across attachments.
- Picture messages on eSIM if the provider adds support.

## Assumptions
- One thread per contact per business number; threads are not merged across numbers.
- The current Inbox remains for non-conversation alerts; texts, voicemails and calls live in Messages.
- Picture limits follow the carriers: about 600 KB total per message, up to 5 images. Received pictures are stored by CloudIVR (cloud file storage) because the provider's links expire after 30 days.
- Sending a picture costs the same as sending a text for now ($0.05 from the wallet); it can be changed later.
- Replacement price is a flat $25 for both number types; the next renewal date and plan stay the same.
- Calling-number replacements are limited to the same country and number type as the old number.
- eSIM replacement cannot keep the old number for 7 days and cannot choose the area. This is how the provider works, and the screen explains it before payment.
- If an eSIM replacement isn't assigned within 24 hours, the customer is refunded and support is alerted.
- Unfinished items from the last step are completed and re-checked before this work starts:
  - crypto payments for eSIM, Texting and renewals
  - the eSIM auto-renew switch
  - the $75 price
- This work stays in preview until the owner says "push live".
