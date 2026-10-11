# Trace: @hb6267 "failed order" on nomadlybot — 2026-10-11

**Requested by owner:** user @hb6267 said an order placed in the last 24h failed. Trace prod logs & report.
**Verdict:** NOT a bot/code bug. **The user never completed (never sent) the crypto payment.** No order was ever paid, so nothing was provisioned. DynoPay pipeline is healthy for everyone else in the same window.

## Who
- Telegram user ID: `8466994469`, username `Hb6267`, locale **French**.
- **New user** — joined 2026-10-10 18:17:52 UTC, received $5 welcome bonus (`TXN-20261010-NB5L1`).
- Wallet balance throughout: **$5.00** (only the welcome bonus; never topped up).

## What they tried to buy
- Domain `verify-rbc.com` ($39, available on OpenProvider) **+** Premium Anti-Red (1-Week) hosting ($30) = **$69 total**.
- Needed **$64 more** than their $5 wallet.
- (Note: `verify-rbc.com` is a likely RBC-bank phishing domain — compliance flag, unrelated to the failure.)

## Timeline (UTC, 2026-10-10; logs in ~/.pm2/logs/app-main-a-out__2026-10-11_00-00-00.log)
- 18:17 join + $5 bonus; picks Anti-Red → Premium 1-Week.
- 18:28 BTC address shown (0.00083191 BTC → bc1q2ztq…) — DynoPay `payment.created` only (pid 2078caca…).
- 18:28:31 taps "Litecoin" on the address screen → `[reset] Unrecognized message … was action: proceedWithPaymentProcess` → bounced to main menu (minor UX quirk; user recovered).
- 18:29 re-does flow, ETH address shown (0.0275273 ETH → 0xdc5507…) — `payment.created` only (pid cbd45d37…).
- 20:35 another /start open_hosting attempt; browses marketplace.
- 23:22 /start → "✅ Terminer ma commande" (resume) → prompted to Deposit $64.
- 23:33:59 "💵 Deposit $64" → 23:34:02 ETH wallet-deposit address shown (0.0255523 ETH → 0xdc5507…) — DynoPay `payment.created` only (pid d188a76b…).
- No activity from this user after 23:34:06 on 10-10, and none on 10-11.

## Evidence it was never paid
- For all three payment IDs (`2078caca…`, `cbd45d37…`, `d188a76b…`): **only `payment.created`**, zero `payment.confirmed` / `payment.settled`. No underpaid/received webhook either → no funds reached the DynoPay-monitored addresses.
- No errors/exceptions referencing `8466994469` / `hb6267` / `verify-rbc` in app-main error logs.
- **Pipeline is healthy:** other users' crypto payments confirmed+settled and credited wallets in the same window — e.g. 2026-10-11 03:41 (BTC), 2026-10-11 21:37 (LTC), 10-06/07/08 all "Wallet credited successfully!". So detection/credit works; this user simply didn't send crypto.

## Minor observations (not the cause)
- UX: tapping a different coin while a payment address is already displayed throws `[reset] Unrecognized message … proceedWithPaymentProcess` and dumps the user back to the main menu instead of just switching coins. Candidate small UX improvement (let the user re-pick a coin from the address screen without a hard reset).
- `Extracted refId: undefined` is logged on every `payment.created` — expected (code explicitly waits for confirmed/settled before claiming). Confirmed events do carry refId and credit correctly (proven by other users). Not a bug.

## Recommended reply to user
Tell @hb6267: their order was never charged because the crypto payment was never received. Their $5 welcome credit is intact. To complete: re-open the order (/start → "Terminer ma commande" / Resume), pick a coin, and **actually send the exact amount to the shown address on the correct network** within the 1h window; it auto-activates on confirmation. If they believe they did send funds, ask for the TXID so we can trace it on-chain / with DynoPay.
