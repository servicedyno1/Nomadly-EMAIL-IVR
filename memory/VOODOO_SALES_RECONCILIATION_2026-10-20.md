# Voodoo Sales & Profit dashboard — reconciliation (2026-10-20)

Everything here was read-only. The live dashboard figures come from `GET https://voodooivr.xyz/api/admin/sales/overview` (password from the Voodoo env, not written here).
The raw-DB recomputation comes from `transactions`, `hostingTransactions`, `payments` and `walletLedger` in Voodoo's Mongo (`DB_NAME=voodoo`).
The "after fix" figures come from the fixed `js/routes/sales.js` (branch `wl-sales-fix-2026-10-20`, worktree `/root/wl`), run locally on :5902 against the same DB through a read-only proxy that blocks every write.
Scripts: `/root/wl-audit/{scan_types,recon,run_sales_local}.js`.

## Profit model in force
- `SALES_FLAT_MARGIN_PCT` is `30` in the Voodoo `backend.env`, so the effective margin is 30% (Smadav 30, ProShop 30).
- Profit = revenue × 30%. Cost is 70% of the list price, so discounts come out of profit.
- Bonuses are shown separately and are never subtracted from profit.
- The margin % is not exposed: `marginPct` is absent from the API before and after the fix.

## Root cause
| Gap | Evidence in Voodoo DB | Effect on dashboard |
|---|---|---|
| **Hosting sales logged with amount 0** | Both `transactions` type `hosting` rows are `amount: 0` (wallet-paid, existing domain). The real charge is `hostingTransactions.priceUsd` = $75 each. On Smadav the `transactions` hosting amount is only a partial (often $30, sometimes two rows per order) while `hostingTransactions` holds the charged total, including loyalty discounts. | Hosting showed $0 instead of $150 |
| **Cloud Phone plan bought from the wallet has no `transactions` row** | Only a legacy `payments` row exists: `Wallet,CloudPhone,$120,<chatId>,…` (2026-10-15) | Cloud Phone $120 missing |
| `phone-sub-number` (Add Number to Plan) is not in `SALE_TYPES` | The bot writes this type (`_index.js` ~13668); there are none in Voodoo yet | Would be dropped in future |
| Call ledger types `sip_per_minute`, `sip_ring`, `overage_charge`, `ivr_inbound` are not in `CALL_USAGE_TYPES` | `voice-service.js` writes them; Voodoo has only `outbound_call` today (529 rows / $137.37: BulkIVR 503 / $131.10, IVR_Transfer 20 / $5.27, IVR_Outbound_Twilio 6 / $1.00) | All current Voodoo calls already show; these types would be dropped in future |

**Calls:** all 529 billed call charges ($137.37) were already counted. Calls that look missing are unbilled ones: 13 bulk-call legs on 2026-10-18 22:00 failed billing for insufficient funds, so they have no revenue. The legacy `payments` "Outbound,…" rows duplicate the ledger and are not added.

**Wallet cross-check:** the total of all `walletOf.usdOut` is $446.40. The raw-DB revenue recomputation is $446.37 (calls $137.37 + hosting $150 + domain $39 + Cloud Phone $120), plus a $1 lead validation logged only in `payments`. The two agree within rounding.

## Uncounted types (before fix)
| Source / type | Count | USD |
|---|---|---|
| `transactions.hosting` with amount 0 → `hostingTransactions` success | 2 | 150.00 |
| `payments` `Wallet,CloudPhone` with no transaction | 1 | 120.00 |
| `payments` `Wallet,Validate Leads` | 1 | 1.00 (not added; legacy log only, below materiality) |

## Reconciliation — Voodoo (identical for 7d / 30d / all-time, because all activity is after 2026-10-14)
| KPI | Live dashboard (before) | Raw-DB recomputation | Fixed route (after) |
|---|---|---|---|
| Gross revenue | 176.37 | **446.37** | 446.37 ✅ |
| Profit (30%) | 52.91 | **133.91** | 133.91 ✅ |
| Orders | 3 | 4 | 4 ✅ |
| AOV | 58.79 | 111.59 | 111.59 ✅ |
| Hosting | 0.00 | 150.00 | 150.00 ✅ |
| Cloud Phone | 0.00 | 120.00 | 120.00 ✅ |
| Domains | 39.00 | 39.00 | 39.00 ✅ |
| Calls (529 charges) | 137.37 | 137.37 | 137.37 ✅ |
| SMS | 0 | 0 | 0 ✅ |
| Deposits (top-ups + admin-credit) | 428.41 | 428.41 | 428.41 ✅ |
| Bonuses (welcome; not in profit) | 790.00 | 790.00 | 790.00 ✅ |
| Refunds | 0 | 0 | 0 ✅ |
| This-week profit (week of Mon 10-19) | 0.00 | 22.50 | 22.50 ✅ |
| Eligible payout (all-time profit) | 52.91 | 133.91 | 133.91 ✅ |
| Margin % shown | no | — | no ✅ |

## Same fix on Smadav and ProShop (same WhiteLabel code; envs untouched)
| Brand, all-time | Gross revenue before → after (recomputed) | Profit before → after | Hosting before → after |
|---|---|---|---|
| Smadav | 1021.00 → **2144.00** (2144.00) | 295.28 → 643.20 | 931 → 2054 (29 `hostingTransactions` rows, 19 success) |
| ProShop | 0 → 0 (no sales yet; 26 welcome bonuses $130) | 0 → 0 | 0 → 0 |

Smadav 7d: 168 → 618. Smadav 30d: 751 → 1829. All match the recomputation within $0.01.
### Smadav hosting check (settled from the database, read-only; `/root/wl-audit/smadav_wallet_check.js`) — verdict: **after-fix $2144 / profit $643.20 is CORRECT (not overstated)**
- **Wallet cross-check:** the total of all `walletOf.usdOut` is $1834.40. Recomputed wallet spend is $1775.50 (wallet hosting $1639 + one hosting row with no `hostingTransactions` match $75 + domain $30 + calls ~$1.5). The $58.90 gap is fully explained:
  - a $75 admin `wallet_deduction` on …7911 (not a sale);
  - +$10 unlogged spend on …0699;
  - +$4.80 unlogged spend on …0586;
  - −$30 because a crypto-paid domain (…7992) was wrongly treated as wallet spend;
  - −$0.90 from duplicate wallet IDs for two call users.
- **Per customer:** for every one of the 10 wallet hosting customers, `usdOut` equals the after-fix recomputation exactly. Example: …3020 has `usdOut` $693 = 7 orders $663 + domain $30. Before the fix the dashboard credited them with only $210.
- **Crypto orders:** the 4 Dynopay hosting successes ($340) each have a `transactions` row with `psp=dynopay` at the same amount. The extra $30/$0 row next to each is a provisioning row and is collapsed.
- **Sample orders:** `walletLedger` has no rows for these; the wallet debit is the `payments` "Wallet,Hosting" row written with the `usdOut` increment.

  | Order | `transactions.amount` | `hostingTransactions.priceUsd` | `payments` wallet debit | Customer `usdOut` | Verdict |
  |---|---|---|---|---|---|
  | …9935 2026-09-27 spe….com | 39 | 114 | $114 | $114.00 (only order) | paid $114 |
  | …2212 2026-10-01 rec….org | 30 | 130 | $130 | $130.00 (only order) | paid $130 |
  | …3020 2026-09-22 par….org (silver loyalty) | 30 | 99.75 | $99.75 | $693 = all 7 orders + domain | paid $99.75 |
  | …6118 2026-09-01 joi….org (two rows) | 30 + 105 | 105 | LTC via Dynopay $105 | — | paid $105; the $30 row is a duplicate |

- **Rows counted:** only `outcome: success` (19). The 9 `failed` rows are excluded. The 1 `domain_only` row (…0699: crypto paid $130, $100 refunded to the wallet) counts only the $30 kept, as a domain sale.
- **Renewals:** none exist in Smadav (no renewal type in `transactions`, `payments` or `walletLedger`).
- **Matching:** each hosting row matches only same chat + same domain within ±10 min, so no order is double counted.
- **Extra domain fixes in this round:**
  - …7992's ETH domain was logged twice (a no-psp row plus the psp row, 9 seconds apart), overstating revenue by $30. Now collapsed.
  - …0699's $30 kept from the `domain_only` order was missing, understating revenue by $30. Now added.
  - Net change to Smadav totals: $0. Domains all-time stays $90, now made up of the correct orders.

## Code change (WhiteLabel only, local branch `wl-sales-fix-2026-10-20`, NOT pushed)
- `js/routes/sales.js`:
  - New `loadSalesTxns(db, filter)`, used by overview, transactions, export.csv, users and user detail. It merges `hostingTransactions` (authoritative hosting price; matched `transactions` rows are replaced or de-duplicated) and wallet Cloud Phone `payments` rows that have no transaction, de-duplicated by chatId within ±10 min.
  - `phone-sub-number` added to `SALE_TYPES` and to the Cloud Phone category.
  - `sip_per_minute`, `sip_ring`, `overage_charge` and `ivr_inbound` added to `CALL_USAGE_TYPES`.
- No UI change needed (`SalesDashboard.js` renders categories from the API).
- Root fix in the bot (not done, follow-up): wallet hosting purchases should write the charged amount to `transactions`, and wallet Cloud Phone purchases should write a `phone-number` transaction.
