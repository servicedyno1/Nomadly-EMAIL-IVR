# @user_uu0 (chatId 6277663071) — VPS "no connection" resolution + A/B/C ship (2026-08-29)

## Investigation (Railway prod logs deploy 65824e83 + live read-only DO/TCP probes)
- Complaint: "VPS has no connection, and when i reset password to see new [pwd] nothing shows".
- Old VPS: DO droplet do-591819943 (204.48.23.185, nyc1, Ubuntu 22.04). DO status=active,
  port 80 OPEN (nginx), ports 22/3389 CLOSED, NO DO cloud firewall attached.
- ROOT CAUSE: the customer's own on-box **ufw blocked port 22** (allowed 80 only). Not a bot bug —
  every SSH Show/Reset timed out and DO reset degraded to the useless email fallback.

## Code changes shipped (A+B+C) — verified by testing agent 100% (13/13 + 23/23 + 43/43, /api/health OK)
- A: js/vm-instance-setup.js `ensureManagedSSHKey()` — every DO Linux create now ALWAYS attaches a
  bot-managed SSH key so the bot can SSH in and set+show+verify a password without emailing.
- B: create-time Linux cloud-init runs `ufw allow OpenSSH` so port 22 can't be firewalled shut.
- C: js/vps-ssh-password.js `probeTcpPort`/`diagnoseSshReachability`; digitalocean-service.resetPassword
  returns fallback:'ssh-blocked' when box is up but 22 closed; vps-password-reveal sets out.sshBlocked;
  _index.js reset+reveal render new en.js `vp.vpsSshBlockedHelp` (recovery-console + `ufw allow OpenSSH`).
- Dev endpoint: GET /api/dev/vps-full-control-check?key=<SESSION_SECRET[0..15]>.

## Goodwill replacement executed (LIVE production — ops/provision_uu0_replacement.js)
- Provisioned via real purchase path (createVPSInstance) so it inherits A+B and shows in his account.
- NEW VPS: do-596118090 @ 134.122.25.36 (nyc1, s-1vcpu-1gb, Ubuntu 22.04, root). SSH login VERIFIED,
  port 22 confirmed OPEN. Subscription start 2026-08-29 → 2026-09-29, autoRenew off, planPrice $18, FREE.
  rootPasswordSecretId set (Show Password durable), managed key sshKeySecretId=58898320.
- OLD do-591819943 DELETED on DO + its vpsPlansOf record removed (deletedCount 1).
- Credentials sent to chatId 6277663071 on the PRODUCTION bot (token 6292288341), message_id 3264299.
- Idempotency: new record marked _goodwillReplacement:true (script refuses to double-provision).

## A+B backfill onto EXISTING DO Linux VPS (2026-08-29, ops/backfill_abc_run.js)
- DO has no API to add a key/change firewall post-create -> backfill SSHes into each reachable box
  (stored key or recoverable password) and idempotently appends the bot's managed key to
  authorized_keys + runs `ufw allow OpenSSH` (additive only), then verifies the managed key logs in.
- Code: js/vps-ssh-password.js buildBackfillScript()+applyBackfillOverSSH(); dev endpoint
  /api/dev/vps-backfill-check (testing agent: 10/10 + 131 regression + health = 146 assertions 100%).
- Executed (RUN=1): BACKFILLED 3 — do-593457561 (7706898844 @157.230.110.191),
  do-593967362 (8186560549 @157.230.117.197), do-596118090 (6277663071 @134.122.25.36).
  All verifiedManagedKey=true; port 22 confirmed OPEN after. Skipped 2 (do-580192787 cancelled,
  do-581455672 DELETED). Re-run is idempotent (skip:already-done via _abcBackfilledAt marker).
- IMPORTANT: the A+B CREATE-time fix lives in THIS dev sandbox only, NOT deployed to production
  Railway. New boxes created by the LIVE prod bot won't get A+B automatically until the code is
  deployed (Save to GitHub -> Railway). Backfill covers existing boxes; re-run for any new ones, or
  deploy the create fix. Locked-out boxes (port 22 unreachable) need the recovery console (none in scope now).
