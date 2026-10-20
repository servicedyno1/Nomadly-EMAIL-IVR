# Production log audit — 48 h (2026-10-18 08:03 → 2026-10-20 08:03 UTC)

Read-only: `pm2 jlist`, the rotated PM2 logs (out + error, copied via `tar` over SSH), the nginx error log and the upstream map.
Nothing was restarted, edited or deployed. The analysis ran on the preview pod.
Masking: phone numbers, chat IDs and emails are partly masked; usernames are shown only where needed.

## Droplet state (nomadly-prod-ams3)
| PM2 app | Status | Restarts | Uptime | Live upstream |
|---|---|---|---|---|
| app-main-b (Nomadly) | online | 2 | 82.4 h | :5100 ✅ |
| app-wl-a (Smadav) | online | 2 | 82.4 h | :5001 ✅ |
| app-voodoo-a (Voodoo) | online | 2 | 82.4 h | :5003 ✅ |
| app-proshop-b (ProShop) | online | 2 | 82.4 h | :5104 ✅ |
| bozzmail-api (not a bot) | **errored** | **1412** | — | nginx: 79× `connect() failed (111)` for bozzmail.com |
| hosta-api | online | 40 | 120 h | — |

- None of the 4 bots crash-looped. There were 0 boots in the window; the last restart was the 2026-10-16 18:3x deploy.
- Host: load 0.05, disk 26 %, RAM 2.3 GB available.
- Lines in the window: Nomadly 65 170 · Smadav 17 695 · Voodoo 25 734 · ProShop 16 805. All 4 bots are fully covered (48/48 h).

## Cross-bot anomalies (ranked)
| # | Sev | Anomaly | Count / window | Example (masked) | Likely cause | Suggested fix |
|---|---|---|---|---|---|---|
| 1 | **HIGH** | **Mongo outage on all 4 Railway DBs at once** | ~8 000–8 700 heartbeat failures per bot, 2026-10-18 20:08 → 21:21–21:23 (~75 min) | `❌ MongoDB heartbeat failed (3x): connection <monitor> to 66.33.22.x:5xxxx closed` | Railway proxy/regional incident: four separate DBs dropped at the same second | Check the Railway status history for 18 Oct. Check user operations in that window: 1 `processingPayment` state write failed on Nomadly/Smadav (chatId 5590…15). Consider an admin alert when the heartbeat stays down for more than 5 min. |
| 2 | **HIGH** | **Shared Telnyx balance low** | 19 checks per bot, warning alerts sent, $7.02–$7.03 | `[BalanceMonitor] Telnyx: $7.03 USD [warning]` | Prepaid Telnyx account almost empty | **Top up Telnyx now.** At $0, calls, SMS and SIP stop on all 4 brands. |
| 3 | **HIGH** | **ConnectReseller API 401** | Nomadly 557× `checkDomainPriceOnline 401` + `CR-Whitelist attempt #80`; Voodoo 14×; ProShop 14×; Smadav CR test 401 | `checkDomainPriceOnline error: Request failed with status code 401 … Unauthenticated` | CR key revoked or droplet IP not whitelisted; the browser auto-whitelist keeps failing | Re-whitelist the droplet IP / renew `API_KEY_CONNECT_RESELLER` in the CR panel. Domain prices fall back to OpenProvider meanwhile. |
| 4 | MED | Reseller DB rejects `distinct` | 561× site-health + 105× webhook owner lookup, on every bot | `Provided apiStrict:true, but the command distinct is not in API Version 1` | Code bug: the Reseller DB client uses the Stable API (`apiStrict:true`) and `distinct` is not allowed there | Replace `distinct` with an aggregate `$group`, or drop `apiStrict` on that client. Reseller site-health alerts and broadcast-owner lookups are silently broken. |
| 5 | MED | Contabo auth failing | 48× circuit open (Nomadly), daily `[Orphan Recon] VPS provider authentication failed` on all bots | `invalid_client` | Contabo client credentials invalid/rotated | Fix or blank the `CONTABO_*` vars (VPS defaults to DigitalOcean). |
| 6 | LOW | Telegram 403 blocked/deactivated | Nomadly 76 users marked dead, Smadav 26; 1 unhandled rejection `403 user is deactivated` | `ETELEGRAM: 403 Forbidden: bot was blocked by the user` | Normal churn; one send path has no `.catch` | Add a `.catch` to the sender that produced the unhandled rejection (04:11:52). |

## Nomadly (app-main-b)
| # | Sev | Anomaly | Count | First → last | Example | Cause / fix |
|---|---|---|---|---|---|---|
| N1 | **HIGH** | **OpenProvider balance insufficient → paid domain order failed** | 2 tries, 1 domain | 10-20 02:15 → 02:17 | `[OP] registerDomain … OP code: 920 … Your account balance is insufficient` → `❌ Domain purchase failed: supportcex.io` | OpenProvider prepaid account is empty. **Top up OP**, then confirm the user (chatId in log) was refunded or retry the order. Every new registration on every brand fails until then. |
| N2 | MED | Twilio sub-account suspended (ACda10…) | 24 auth self-heal tries + 20 `sub-account is suspended` bulk-call failures + releaseNumber fails | 10-19 → 10-20 06:11 | `Authenticate — sub-account is suspended` | One customer's Twilio sub-account is suspended by Twilio. Their bulk campaign keeps dialing and failing; pause the campaign, contact the user / Twilio. |
| N3 | MED | `Outbound charge error: Cannot read properties of undefined (reading 'catch')` | 2 | 10-19 17:53, 18:55 | appears right after `FORCE-SETTLED as debt $9.26` | Bug at `js/voice-service.js` ~1577: `_notifyAdmin(...).catch` but `notifyAdmin` returns undefined. The debt **is** recorded; only the admin alert is lost. Fix: wrap it in `Promise.resolve(...)`. |
| N4 | LOW | Twilio geo/invalid-number errors in bulk IVR | 8 + 8 + 1 | 10-19 → 10-20 | `Account not authorized to call +250…` | User-supplied lead lists; expected. |
| N5 | LOW | PhoneMonitor flagged 1 number suspended | 1 | 10-20 00:09 | `[PhoneMonitor] SUSPENDED: +1…` | Ties in with Task B (customer support for suspended numbers). |
| N6 | LOW | `Attempt N failed for <chatId>, retrying in 2s` | 408 | 10-18 09:20 → 10-19 12:55 | — | Telegram send retries during promo/broadcast bursts; no data loss seen. |
| N7 | LOW | CF Origin CA rejected for a new zone; OP false-negative 500 on duplicate | 1 + 1 | 10-19 20:06/20:41 | `zone not part of your account` | Known self-healing behaviour (runbook §12). |
| N8 | LOW | Payment states cleared after 6 h | 3 | — | `[PaymentTimeout] Cleared digital-product-pay …` | Abandoned checkouts. |

## Smadav (app-wl-a)
| # | Sev | Anomaly | Count | Window | Example | Cause / fix |
|---|---|---|---|---|---|---|
| S1 | MED | **Orphaned number receiving calls** | 18 inbound calls rejected | 10-18 19:34 → 10-19 23:58 | `[Voice] ⚠️ ORPHANED NUMBER: No owner found for +187****05` | That number is still on Smadav's Telnyx connection with no owner in Smadav's DB (it is used by a Nomadly SIP user). Move or release it in Telnyx. |
| S2 | LOW | Telnyx `CALL_REJECTED` | 6 | 10-18/10-19 | — | Same orphan number. |
| S3 | LOW | AntiRed CF IP-fix deploy timeout | 1 | 10-18 16:25 | `timeout of 30000ms exceeded` | Transient Cloudflare. |
| + | | Cross-bot items 1–6 | | | | |

## Voodoo (app-voodoo-a, blue/green — slot a live)
| # | Sev | Anomaly | Count | Window | Example | Cause / fix |
|---|---|---|---|---|---|---|
| V1 | MED | `MAIL_RELAY_HOST` unset → no MX for hosting customers | 1 per hosting order | 10-19 16:03 | `MAIL_RELAY_HOST is UNSET — mail (MX) DNS is NOT being provisioned` | Set `MAIL_RELAY_HOST` in Voodoo `backend.env` (owner decision). |
| V2 | LOW | Bulk-call billing failed (insufficient funds) | 13 | 10-18 22:00 → 22:04 | `[BulkCall] Billing failed (insufficient funds)` | User ran out of wallet mid-campaign; the guard works. |
| V3 | LOW | SIP credential with no owner blocked | 2 | 10-19 15:35 | `No owner found for SIP user gencred… credential BLOCKED for 10min` | Leftover credential; the leak guard works. Clean it up in Telnyx. |
| V4 | LOW | CF listDNSRecords 500 / Origin CA rejected | 1 + 1 | 10-18/10-19 | — | Transient Cloudflare; self-heals. |
| + | | Cross-bot items 1–6 (Voodoo had 110 Mongo stack traces) | | | | |

## ProShop (app-proshop-b)
| # | Sev | Anomaly | Count | Window | Example | Cause / fix |
|---|---|---|---|---|---|---|
| P1 | LOW | 17 low-balance DMs sent out of 28 wallets | 8 scans | daily | `[UserWalletMonitor] … 17 low-balance warnings sent` | High ratio for a new brand; check the threshold isn't spamming new users. |
| P2 | LOW | Hosting payment cleared after 6 h | 1 | 10-19 22:39 | `Cleared hosting-pay …` | Abandoned checkout. |
| + | | Cross-bot items 1–6 | | | | |

## Other droplet items
- **bozzmail-api errored, 1412 restarts.** nginx returns `connect() refused` for bozzmail.com (79×). This is not one of the 4 bots. Check its error log; it is crash-looping on startup.
- `alt-customer-support.com` (a Voodoo hosting domain): 15× nginx `upstream timed out`.
- No AI-support errors, no Dynopay/crypto failures (1 `payment.created` event, ignored correctly), and no Telegram 429s in the window.
