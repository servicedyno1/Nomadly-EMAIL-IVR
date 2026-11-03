# Production bot activity audit — 7 days (2026-10-27 22:24 → 2026-11-03 22:24 UTC)

Read-only. Sources: PM2 out/error logs for all 4 bots (both blue/green slots), Mongo collections (last 7 d), DigitalOcean and Telnyx account APIs (GET only). Nothing in production was changed. Temporary audit scripts were removed from the droplet.

## Critical (act now)
1. **DigitalOcean team LOCKED.** Status: `locked — lack of payment`. Balance due $198.59 (October invoice $203.59, issued 1 Nov). This account also holds the **production droplet nomadly-prod-ams3** (all 4 bots and the panels) plus 5 customer VPSes. All VPS orders fail with 403 "outstanding balance": 10 failed orders (Palenow ×9, Login4six8 ×1), all refunded automatically. If DO powers off locked droplets, every brand goes down.
2. **Telnyx balance $5.12** (no credit line). It was $14.58 on 27 Oct and fell $3.6 in 2 h on 3 Nov. Calls, SMS and SIP on all 4 brands stop at $0.

## High
3. **Linkly key rejected (401).** Paid shortener subscribers get "Link shortening failed" (flmzv2, user 5111375913). The usage check also failed 149×.
4. **AI language detection model retired** (`gpt-…-nano deprecated`). 66 errors on Nomadly plus a few on the other bots. Auto-translation of non-English messages falls back silently.
5. **ConnectReseller 401** still happening: 4 893 on Nomadly, 74 on Smadav, 26 on ProShop. Prices fall back to OpenProvider. The auto-whitelist login fails every boot.
6. **SIP users silently cut off.** 105 outbound SIP calls were hung up by the 10-calls-per-5-min cap with no message to the user: iamthebestbusiness 58, lamanifestor 32, Chemist454 15.

## Medium
7. com_Emriz112: an $80 deposit took ~4.5 h to credit. They picked TRX but paid USDT-TRC20, and DynoPay only sent `settled` at 15:55. They opened 3 support sessions and admin asked twice for proof. It was credited and they bought hosting afterwards.
8. maddogg55: 12 failed nameserver changes on .de domains. DENIC said "Nameservers must … return an authoritative answer", and 4 inputs were rejected because they were labelled "NS2: …". The bot shows the raw registry text and no guidance.
9. 10 Telnyx bridge-transfer calls (iamthebestbusiness, 3 Nov) are marked `needs_review` by CallRecon (no charge recorded, ~$0).
10. Unanswered escalations (no admin reply in logs): Gbentex (642900715), flmzv2 (Linkly), serialjuicer (port 25 blocked on new DO VPS), paropare2 (FR questions). zerolifeleft: custom AWS order ($800, paid directly to admin) has been waiting since 28 Oct. Admin said "sending today" on 2 Nov.
11. Contabo `invalid_client` every hour; VPS self-heal is skipped.
12. Twilio main account inactive (status 4). 49 sub-accounts are skipped and 5 numbers are held for migration.

## Low
- Telegram send retries come in bursts during broadcasts (671 per attempt level, with none failing all 3).
- 156/100/18/22 users blocked the bots (AutoPromo).
- Empty Fincra webhooks hit Voodoo and ProShop (4 each, 3 Nov).
- 2 Spenza webhooks were rejected on 1 Nov 21:01 before the signing secret was saved.
- Fargo024 (Voodoo) saw a raw cPanel "suspended account" error.
- Social-proof counters are fictional by design (e.g. "65 VPS servers deployed this week" while VPS ordering is broken).
- ~75 deploys in 7 days. There were no crashes and no Mongo outages.

## Usage per bot
| Bot | Lines | Active users | Messages | /start users | New users | Deposits credited | Sales seen |
|---|---|---|---|---|---|---|---|
| Nomadly | 214 894 | 142 | 2 875 | 111 | 42 | 26 | 10 hosting ($604.75), 11 domains, 4 phone ($250), 1 VPS ($18) |
| Smadav | 26 926 | 16 | 229 | 13 | 3 | 0 (1 direct crypto) | 1 hosting ($75 LTC), 1 domain |
| Voodoo | 33 552 | 34 | 979 | 23 | 5 | 3 | 1 phone plan ($120), 1 leads job ($23.75) |
| ProShop | 23 345 | 10 | 116 | 8 | 6 | 0 (1 direct crypto) | 1 hosting ($30 USDT) |

## Funnel notes
- New USA T-Mobile eSIM ($75) since 2 Nov: 6 viewers and 2 "Buy" taps. Both cancelled at the IMEI step. 0 orders.
- Before the switch, 3 users tapped the old "eSIM T-Mobile — $60" (28 Oct and 2 Nov 03:38).
- Insufficient-balance walls: Voodoo 13× on custom leads ($25 vs $5 welcome bonus), Nomadly 6×.
- Abandoned: Nomadly 10 carts (2× phone-pay $75/$120, 3 domain, 2 digital, 3 deposits). ProShop: Kamzy333 VPS pay. Voodoo: phone-pay $75.
- Support rating: 1 bad (earncod, asked about spoofing) and 1 good (DeterminediQ).
