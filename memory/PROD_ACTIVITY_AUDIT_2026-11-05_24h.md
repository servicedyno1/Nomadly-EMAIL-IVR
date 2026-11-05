# Production activity audit: last 24 h (2026-11-04 21:27 → 2026-11-05 21:27 UTC)

Read-only. Sources: Mongo for all 4 bots (main=test, smadav, voodoo, proshop) and PM2 logs. Nothing was changed. Temporary scripts were removed from the droplet.

## The two paying users
### johnwill202 (8613373426, Nomadly bot): bought Pro
- 11-03 23:25 joined, got the $5 welcome bonus, deposited $74.91 (+$5 first-deposit bonus) → wallet $84.91.
- 11-05 17:51 the "Complete my order" link had expired, so he started again. Path: Cloud IVR → Choose a Plan → Pro → USA → Toll-Free → picked +1 877-397-2240 → paid $75 from wallet at 17:54. Purchase took ~2.5 min; SIP login created; he opened SIP credentials and revealed the password.
- 17:59–18:19 about 14 test calls in to his new number (from +1 202-892-6760 and +1 202-288-5873); most rang his SIP device and connected for a few seconds.
- **Problem: each answered inbound SIP call was billed twice.** It used 1 plan minute and was also billed as a `Bridge_Transfer` leg to his own SIP device: 10 legs, about $5 from his wallet. Wallet went $9.91 → $4.91 and a low-balance warning was sent at 18:19. Receiving calls on your own softphone shouldn't cost wallet money. Code: `voice-service.js` (~line 2015) bills any bridged leg, including inbound → own SIP URI.
- Plan: Pro, active until 12-05, auto-renew on. Wallet now $4.91. Can't auto-renew without a top-up.

### "Bob": web account 5000000000000048 (CloudIVR web, real customer)
- Deposits: $180.64 BTC (01:49) and $80 BTC (15:30) through DynoPay, both credited.
- Purchases: Business +1 866-498-0785 for $96 (01:51, web, coupon price); USA eSIM $75 (07:24, active, +1 808-493-9799, IMEI set).
- Heaviest user of the day:
  - 18 campaigns, including 7 AI-agent campaigns.
  - 148 AI-agent calls: 103 answered, 122 billed minutes, $37.00 (7 transferred, 2 interested, 7 callbacks).
  - 10 web Quick IVR / Call me first calls, 49 lead checks.
  - About 16 audio files uploaded.
  - First custom caller ID uses (3 SIP calls showing his eSIM number).
- Wallet now $51.27. No support tickets; nothing failed for him.

## Other money in (24 h)
| User | What |
|---|---|
| 2XqZO (9013312785) | $103.89 BTC deposit; 2 Business "report only" bulk runs (150 + 120 leads, 34 answered) |
| fulyrich (6635602837) | $65.09 BTC deposit → domain bannerbankus.com $36 + Anti-Red hosting 1 week $27 |
| MANOPAGANI (Smadav bot) | Anti-Red HostPanel 1 month: DynoPay $75 attempt **failed**, then paid $67.50 from wallet ✅ |
| pitufo2 | IONOS SMTP digital order $150 (wallet) still **pending**; open escalation "what is going on with my smtp?" (19:00, not acknowledged) |

## CloudIVR web (main only; the brands have no web activity)
- **41 new sign-ups** in 24 h (nearly all Gmail), 42 active accounts.
- **15 deposit requests** (mostly the $75 / $67.50 Pro price) but only **2 paid** (both Bob). 13 were abandoned.
- 5 web number orders: 0 paid. 2 cancelled; 3 still "awaiting payment" (chelsealoving, Jame, Victory Anthony).
- Free trial Quick IVR: 7 calls. chelsealoving failed 3× with "D50 — number has no valid LRN" (bad target number).
- 2 landing-page "Call me" tests, both answered.
- Web support chats: Jame (4 msgs), Sulaiman (4), David Hallyday (6). No escalations.

## Bots
| Bot | Messages in | Users | New users | Notes |
|---|---|---|---|---|
| Nomadly | 930 | 98 | 50 | 8 escalations (below) |
| Smadav | 77 | 9 | 1 | 1 hosting sale |
| Voodoo | 240 | 17 | 2 | soulless73 ran 4 IVR calls + 2 transfers |
| ProShop | 16 | 4 | 1 | quiet |

Escalations (Nomadly):
- **IloveMusic_100**: 6 refund requests ($100 / "gold membership") between 13:07 and 16:25, then rated support **bad**. All marked resolved, but he kept asking again.
- pitufo2: wallet withdrawal request (acknowledged), then the open SMTP question (above).

## SIP (last 24 h)
- **lamanifestor** (Pro +1 888-826-1904): ~300 outbound SIP calls, 97.8 min, $54.45; also 58 inbound calls forwarded (forward always). Most legs ended `originator_cancel`, so he's hanging up before an answer. No caps, no queueing, no rejections.
- **LBHAND23** (Business +1 844-583-1558): 42 SIP + 9 IVR calls, 25.6 min, $7.40.
- **2XqZO**: 1 SIP call. **Bob**: 3 SIP calls with a custom caller ID.
- **johnwill202**: inbound to his SIP device (double billing above); 26 "SIP no answer → missed" events across users.
- No SIP errors, queue hits or caller-ID rejections in the logs.

## Other things seen
- Hosting auto-renew **failed 71×** (Nomadly) and 30× (Smadav), probably wallets too low. 1 suspend and 2 deletes.
- ConnectReseller 401: 980 errors (domain price check still falling back). Contabo invalid_client: 25. PhoneMonitor 429: 280.
- 3 Bridge_Transfer bills marked `needs_review`.

## Suggested actions
1. **Stop charging wallet for inbound calls answered on the user's own SIP device** (johnwill202 lost ~$5), and refund him.
2. Answer pitufo2's SMTP order ($150 pending) and IloveMusic_100's refund dispute.
3. Nudge the 13 abandoned web deposits / 3 awaiting number orders (they all picked Pro).
4. johnwill202 has $4.91 and a $75 renewal on 12-05: send a top-up reminder before renewal.
