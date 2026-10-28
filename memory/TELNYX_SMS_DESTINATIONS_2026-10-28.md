# Telnyx SMS destinations — investigation (2026-10-28, read-only, prod Telnyx account)

## How Telnyx decides where a number may text
- Each number belongs to one Messaging Profile. The profile's `whitelisted_destinations` (ISO countries, or `*`) is the hard
  allow-list for outbound SMS. Texts to other countries are refused.
- Number `features.sms` = {domestic_two_way, international_inbound, international_outbound}. All 45 messaging numbers show
  `international_outbound:false`. But account detail records show recent outbound deliveries to NG, ET, LA, BD, TZ, IR from
  profiles with wide lists. So the profile list is what really gates sending; the flag alone is not reliable.
- Other limits: sending to US mobiles needs 10DLC (long code) or toll-free verification (already mapped in sms-reply.js REASONS);
  non-US sending needs an alpha sender ID on the profile (Mar 2024 rule) where the country supports it; some countries block
  long codes (e.g. IN); the cost per text varies a lot by destination.

## What the account has now
| Profile | Numbers | Allowed destinations | Inbound webhook |
|---|---|---|---|
| Nomadly Cloud Phone SMS 40019c71-59a6 (= TELNYX_MESSAGING_PROFILE_ID) | 17 | AU BR CA DE FR GB GH IN KE MX NG PH PT US ZA | 2.speechcue.com |
| Voodoo Land Cloud Phone SMS 4001a13a | 2 | same 15 | voodooivr.xyz |
| "ryan counts" 40019f3d | 24 (the older successful hosted orders) | CA MX PM US | hook.us2.make.com (NOT our app) |
| none | 2 toll-free | none (can't text) | — |
- 73 of 76 profiles have no numbers (65 of them allow only AU CA DE FR GB US). Leftovers, safe to clean up later.
- Last 100 outbound records: 40008 (carrier didn't deliver) x14, mostly IR/CU/GG; 40012 (invalid destination) x2.

## Gaps in our app
- No destination check before sending (hosted thread, missed-call text back, inbox reply). A blocked country fails after
  Send with a generic message.
- deliver() passes messaging_profile_id from env, but a long-code sender uses its own number's profile, so the env value
  doesn't decide the allowed countries.
- The UI never shows which countries a number can text. The flat $0.05 per text ignores destination cost.
- Landline to Texting orders all go to the env profile, so every hosted number gets the same 15 countries.

## Proposed (not built)
1. Backend: read each number's profile allow-list (cached), plus GET /numbers/:phone/sms-reach → {countries, all}.
2. Before sending: check the country of the "to" number; if not allowed, show "Texts from +1… can reach: US, CA, … — not <country>".
3. UI: a "Can text: US, Canada + 13 more" chip on each number, on the Texting page and in the composer, plus a country list
   in a popover; a matching row in the Landline to Texting setup.
4. Optional: a price per destination country (US/CA $0.05, others from a table) and showing it before sending.
5. Optional: an owner setting to widen or narrow the allow-list per brand (PATCH profile whitelisted_destinations).
