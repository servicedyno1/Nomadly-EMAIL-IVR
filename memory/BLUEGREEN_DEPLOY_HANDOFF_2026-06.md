# Blue/Green Deploy — Handoff & Completion Runbook (2026-06 fork)

> **Read this first, then `memory/DEPLOYMENT_STATE.md`.** This is the single execution-ready
> document to finish the user's last request. Everything the previous session did is below;
> follow the checklist top to bottom.

---

## 1. The user's request (verbatim intent)

> *"ensure that new deployment push newly image. meaning deployment always push the new image
> and if failed, previous deployment should be active and working."*

Translation: move the droplet auto-deploy from an **in-place `git reset --hard`** strategy to a
**blue/green immutable-release** strategy. Every push builds a fresh, isolated release ("image"),
starts it alongside the running one, health-checks it, and only then switches traffic. If the new
release fails to build / start / pass health / switch nginx, **the currently-running release keeps
serving and nothing is touched** (a red run + Telegram ❌ alert).

---

## 2. What was DONE this session (code only — NOT live-tested, NOT committed)

Uncommitted working-tree changes (verify with `git status --short`):

| File | Change | Status |
|---|---|---|
| `scripts/droplet_deploy.sh` | Full rewrite → blue/green immutable releases (196 ins / 130 del) | `bash -n` ✅, untested on droplet |
| `js/droplet-domain-server.js` | 2 lines — customer-domain nginx blocks `proxy_pass` to the upstream **name** `nomadly_<app>` instead of a hardcoded `127.0.0.1:$DROPLET_APP_PORT`, so the port flip is picked up | `node -c` ✅, untested |

**Nothing on the droplet changed yet.** The installed `/opt/nomadly/deploy.sh` is still the OLD
hardened in-place script, so the existing GitHub Actions → SSH pipeline keeps working exactly as it
did. The new script only takes over after (a) the repo push lands `main`, and (b) the droplet
release layout below exists.

---

## 3. How the new `scripts/droplet_deploy.sh` works (so you can verify it)

**Commands**
- `deploy.sh <app>` — build newest commit of the branch → start on the idle slot → `/health` OK → switch nginx → stop the old slot.
- `deploy.sh <app> rollback [release-dir]` — re-activate the previous (or given) release the same way.
- `deploy.sh <app> status` — show active release / port / PM2 slots / releases on disk.

**On-droplet layout (all under `/opt/nomadly`)**
```
repo/<app>.git                         bare mirror of the GitHub repo (git archive source)
shared/<app>/backend.env               the app's .env, symlinked into every release as backend/.env
shared/<app>/branch                    branch to deploy (default: main)
releases/<app>/<ts>-<sha>/             immutable release trees; newest KEEP_RELEASES (3) kept
current/<app>                          symlink → the release currently serving
/etc/nginx/conf.d/nomadly-upstreams.conf   "upstream <app_underscored> { server 127.0.0.1:<port>; }"
logs/deploy-<app>.log                  per-app deploy log
```

**Two PM2 slots per app:** `<app>-a` on `PORT` (from backend.env), `<app>-b` on `PORT+100`.
A deploy starts the new release on whichever slot is **idle**, health-checks it, then rewrites the
one `upstream` line + `nginx -t` + graceful reload. All nginx blocks proxy to the upstream **name**,
so the switch = one line + reload (no dropped requests). Old slot drains ~3s then is deleted.

**Safety (the whole point):** build failure, `/health` timeout (`HEALTH_TIMEOUT` 120s), PM2 crash
loop, or a failed `nginx -t` → the new slot is deleted, the active release is left running, the run
`exit 1`s (red), and a Telegram ❌ goes to `TELEGRAM_ADMIN_CHAT_ID` from that app's `backend.env`.
`set_upstream` also backs up + restores `nomadly-upstreams.conf` if `nginx -t` fails.

**Speed:** unchanged root `node_modules` / frontend `node_modules` / frontend `build` are hardlinked
or copied from the previous release (sha-compared via `package.json` / `fe_tree`), so a code-only
deploy skips `npm install` and the CRA build.

Key env knobs read from `shared/<app>/backend.env`: `PORT` (base), `DEPLOY_ENTRY`
(default `js/start-bot.js`), `TELEGRAM_BOT_TOKEN_PROD`/`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`.
Overridable: `HEALTH_TIMEOUT`, `KEEP_RELEASES`.

`self_update()` copies `scripts/droplet_deploy.sh` from the app-main release over `/opt/nomadly/deploy.sh`
after each app-main deploy (takes effect next run) — same self-update behaviour as the old script.

---

## 4. REQUIRED one-time droplet bootstrap (do this before the first blue/green deploy)

Droplet: `root@146.190.238.190` (`ssh -i /root/.ssh/nomadly_droplet root@146.190.238.190`).
Do this **for app-main only** first. Keep the live PM2 `app-main` (port 5000) running the whole time —
the first blue/green deploy will bring up `app-main-a`/`app-main-b` on a fresh port and flip to it;
only after that switch succeeds do you retire the old process.

```bash
# 0. Confirm current prod entrypoint + port (adjust DEPLOY_ENTRY in backend.env if it's not js/start-bot.js)
pm2 describe app-main   # note script path & PORT

mkdir -p /opt/nomadly/{repo,shared/app-main,releases/app-main,current,logs}

# 1. Bare mirror (fetch source for git archive)
git clone --mirror https://<PAT>@github.com/servicedyno1/Nomadly-EMAIL-IVR.git \
  /opt/nomadly/repo/app-main.git

# 2. Move the live .env into shared (the release symlinks to it)
cp -a /opt/nomadly/app-main/backend/.env /opt/nomadly/shared/app-main/backend.env
echo main > /opt/nomadly/shared/app-main/branch

# 3. nginx upstream file (start it pointing at the CURRENTLY live port, e.g. 5000)
cat > /etc/nginx/conf.d/nomadly-upstreams.conf <<'EOF'
upstream nomadly_app_main { server 127.0.0.1:5000; }
EOF

# 4. Point every app-main server block at the upstream NAME instead of 127.0.0.1:5000.
#    Files to edit: /etc/nginx/sites-available/2-speechcue (or wherever 2.speechcue.com lives),
#    the panel-2-hostbay block, and the customer-domain block TEMPLATE the app writes
#    (js/droplet-domain-server.js already emits proxy_pass http://nomadly_app_main; for NEW blocks
#     once this code is deployed — existing /etc/nginx/nomadly-domains/*.conf must be rewritten once).
#    Replace:   proxy_pass http://127.0.0.1:5000;
#    With:      proxy_pass http://nomadly_app_main;
nginx -t && systemctl reload nginx
```

> ⚠️ The `js/droplet-domain-server.js` change only affects **newly written** customer-domain blocks.
> The ~7 already-live blocks in `/etc/nginx/nomadly-domains/*.conf` still hardcode `:5000` — either
> bulk `sed` them to `proxy_pass http://nomadly_app_main;` during bootstrap, or run the shortener
> reconciler / re-attach after deploy. Do the sed; it's one pass.

---

## 5. NEXT AGENT — completion checklist (priority order)

**P0 — app-main blue/green (finish the user's request)**
1. Do §4 bootstrap on the droplet (app-main only). Live PM2 `app-main` stays up.
2. Push the repo (`Save to GitHub`) so the new `scripts/droplet_deploy.sh` + `droplet-domain-server.js` land on `main`. The old installed `/opt/nomadly/deploy.sh` runs this push (harmless no-op reset), then self-updates to the new script on the following run — OR manually `cp` the new script to `/opt/nomadly/deploy.sh` for the first run.
3. `bash /opt/nomadly/deploy.sh app-main status` → sanity.
4. `bash /opt/nomadly/deploy.sh app-main` → confirm: new slot starts on the idle port, `/health` healthy, nginx upstream flips, `2.speechcue.com` + `panel.2.hostbay.io` + a customer domain still serve, Telegram webhook still delivers, ✅ Telegram notice arrives.
5. Test **rollback**: `bash /opt/nomadly/deploy.sh app-main rollback` → previous release serves again.
6. Test **failure safety**: temporarily point `shared/app-main/branch` at a deliberately-broken commit (or set `HEALTH_TIMEOUT=20` against a bad build) → confirm the deploy exits red and the **old release keeps serving**. Revert branch.
7. Once proven, delete/retire the legacy in-place `/opt/nomadly/app-main` PM2 process if it's still separate.

**P1 — WhiteLabel (app-wl, brand #2 / SMADAV)**
8. Repeat §4 layout for `app-wl` (`repo/app-wl.git` mirror of branch `WhiteLabel`, `shared/app-wl/backend.env` from the exact Railway SAMDAV vars + droplet overrides, `shared/app-wl/branch=WhiteLabel`, `upstream nomadly_app_wl { server 127.0.0.1:5001; }`, nginx blocks + SSL for its subdomains). npm install + frontend build happen inside the release automatically.
9. Add `WhiteLabel` to `on.push.branches` and a `deploy-wl` job calling `bash /opt/nomadly/deploy.sh app-wl` in `.github/workflows/deploy.yml`.

**P1 — 3rd instance**
10. Clone/deploy the 3rd Node app (user: repo `Nomadly-EMAIL-IVR` branch `Whitelabel` — confirm whether this is the SAME as SMADAV or a distinct brand/DB) as `app-3` on port 5002, same layout, add to the workflow.

**P2**
11. certbot auto-renew hooks or wildcard Origin certs for custom domains.

---

## 6. Guardrails / gotchas

- **Do NOT** `git reset` or revert to "go back" — tell the user to use the **rollback** feature.
- Node on the droplet has **no hot reload**; the deploy uses `pm2 reload`/`pm2 start` — that's expected.
- The repo is **PUBLIC** and includes `memory/**`; `/root/.git-credentials` on the droplet holds an
  over-scoped classic PAT (a public repo needs none for `git fetch`). Owner decision, not a blocker.
- Production data lives on the external Railway Mongo (`DB_NAME=test`) via `MONGO_URL` in each
  `backend.env` — **never** point a brand at the wrong DB. Each extra brand should get its own `DB_NAME`.
- Telegram caches the webhook IP: keep `TELEGRAM_WEBHOOK_IP=146.190.238.190` in every brand's `backend.env`.
- Deploy scripts under `scripts/` must never hardcode `/app` (CI/droplet run elsewhere) — this one doesn't.

## 7. Test evidence to produce before declaring done
- `deploy-app-main.log` showing: new release built → new slot online → `/health healthy` → `nginx →` flip → old slot stopped → ✅ notice.
- A rollback log and a forced-failure log where the **active release is explicitly reported untouched**.
- `deploy.sh app-main status` after each, plus a `curl https://2.speechcue.com/health` = healthy from off-droplet.

## 8. Credentials
- Vault passphrase & all creds: `memory/test_credentials.md` (and vault `memory/nomadly.vault.enc`).
- Droplet SSH: `/root/.ssh/nomadly_droplet` (base64 backup in `backend/.env` as `DROPLET_SSH_KEY_B64`).
- Full droplet/repo/plan facts: `memory/DEPLOYMENT_STATE.md`.
