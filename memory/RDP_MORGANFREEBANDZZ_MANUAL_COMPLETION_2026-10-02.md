# @morganfreebandzz (chatId 7706803914) — failed RDP order, manually completed on PROD (2026-10-02)

## What happened
- 18:54Z user paid $156 from wallet for Azure "RDP 20" (`Standard_D4s_v6`, 4 vCPU/16 GB/128 GB, EU-West). Azure ARM returned
  `404 subscription could not be found` → bot auto-refunded $156 and said "Something went wrong … **VPS** Plan" (mislabel).
- Root causes fixed earlier in the session: `VPS_RDP_PROVIDER=azure` → `digitalocean-rdp` (both bots + vault), RDP-aware
  `vp.errorPurchasingVPS`. This doc covers the manual order completion.

## Execution (ops/complete_rdp_order_7706803914.js, run on droplet with app-main env)
1. `charge`: `walletOf.usdOut += 156` (bal 156.49 → 0.49), `payments` ledger line `Wallet,VPSPlan,Monthly,$156,…` tagged
   `manual-rdp-completion-2026-10-02`, Telegram "✅ Payment successful! Your RDP is being set up…" sent via Bot API.
2. `provision` #1 → `POST /admin/comp-vps` (vpsDetails override: DO-RDP `power-1m`, EU→fra1, ws2022, priced $156).
   **FAILED**: DO `403 outstanding balance on your account` (Sept invoice $85.94 PAST_DUE). The bot flow kept polling for an IP
   (25-min loop that would have ended by DMing bogus credentials) → aborted by blue/green `deploy.sh app-main`
   (zero downtime; app-main-a → app-main-b :5100). Orphan `vpsPlansOf` (rdp-8be6d0c8…) deleted; `doRdpServers` doc kept, tagged `_abortedByOps`.
3. User paid the DO balance → `provision` #2 (APP_URL=:5100) → success in 56 s:
   droplet **605654801** `nomadly-twsagc`, fra1, `s-8vcpu-16gb-intel`, IP **164.90.171.80**, ws2022, server_id `60811b81-70e9-47d8-807c-c5dc8616423c`.
   Bot sent vpsBoughtSuccess (IP/Administrator/password) + `.rdp` file + admin-group notice; `transactions` **TXN-20261002-8EE96** $156 `vps`.
   Email skipped by design (`isRegisteredTelegramForVps:true`, no `userEmail`).
4. `finalize`: comp flags removed → normal paid order; `_manualOrderCompletion` audit set; abandoned cart closed.
   Record: status RUNNING, planPrice 156, autoRenewable false, end_time 2026-11-02. DO-RDP status `active` 20:59:45Z, agent heartbeat OK, 3389 open.

## Lessons
- `/admin/comp-vps` + separate wallet debit is the reproducible way to "replay" a wallet RDP/VPS order (script phases are idempotent & guarded).
- DO billing (`GET /v2/customers/my/balance`, `/invoices`) must be checked before any provisioning op; a PAST_DUE invoice blocks every create with 403.
- `buyVPSPlanFullProcess` does not notice a DO-RDP `status:'failed'` doc — it polls 25 min then sends credentials anyway. Follow-up: short-circuit the poll when the DO-RDP server doc is `failed` (P1).
- Active app-main port flips between :5000/:5100 on each blue/green deploy — read the nginx `upstream app_main` block.
