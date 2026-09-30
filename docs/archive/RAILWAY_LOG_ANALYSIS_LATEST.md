# Railway Production Anomaly Report
**Generated:** 2026-06-08 07:04 UTC
**Project:** New Hosting (`c23ac3d9-51c5-4242-8776-eed4e3801abe`)
**Environment:** production (`889fd56a-720a-4020-884c-034784992666`)
**Source:** Railway GraphQL `deploymentLogs` (5,000-line cap per query)
**Auth:** Project Access Token (`8a6f6eb8-…820ae`) — used `Project-Access-Token` header

> ⚠️ **Key-handling note:** The token provided was rejected as a standard `Bearer` key, but works as a **Project Access Token** (header: `Project-Access-Token`). It scopes to the project above only — it cannot query `me`/`projects`/`teams`, but can query `deployments` & `deploymentLogs` for any service in this project. The handoff's `dee2dbf2-…` project ID was stale; the real prod project is `c23ac3d9-…` and was discovered via `{ projectToken { projectId environmentId } }`.

---

## Services & Deployments Audited

| Service              | Latest deployment      | Status  | Logs pulled | Window                          | severity:error |
|----------------------|------------------------|---------|------------:|---------------------------------|---------------:|
| HostingBotNew        | `8eda72b0…`            | SUCCESS |         112 | 2026-05-10 → 2026-06-07 (28 d)  |   5 (mis-tag)  |
| LockbayNewFIX        | `4717b500…`            | SUCCESS |       5 001 | 2026-06-08 03:30 → 07:03 (3.5h) |   0 (msg-only) |
| Nomadly-EMAIL-IVR    | `54ae8489…`            | SUCCESS |       5 001 | 2026-06-07 20:01 → 06-08 07:03  |  **308**       |

The Lockbay & Nomadly buffers are saturated at Railway's 5,000-line ceiling — older log lines have already been evicted. **Recommendation:** if you want >5k retention, push logs to Datadog/Logtail or a sink with the Railway log-drain integration.

---

## 🔴 P0 — Critical anomalies (must fix this week)

### 1. VPS-cancel retry storm against deleted Contabo instance — 911 log lines / 132 admin alerts in 11h
**Service:** `Nomadly-EMAIL-IVR` | **Source:** `js/_index.js` L30097-30120 + `js/vm-instance-setup.js` L1016-1068

**What's happening (every ~5 min, since 20:05 UTC yesterday):**
```
[Contabo] Cancelling instance 203283942
[Contabo] API POST /compute/instances/203283942/cancel failed (404):
   {"statusCode":404,"message":"Entry Instances not found by instanceId = 203283942"}
Error deleting VPS instance: Entry Instances not found by instanceId = 203283942
[VPS Scheduler] ERROR: Failed to delete nomadly-8625434794-1778118670648 on Contabo
reply: 🚨 <b>VPS DELETE FAILED</b>   ← admin DM
```
The MongoDB record `vpsPlansOf({ vpsId: '203283942' })` is still in `status: PENDING_CANCELLATION` with `end_time <= now`, so the scheduler loop in **Phase 2** (`_index.js` 30092) selects it on every cycle. `cancelInstance` throws 404 → the catch block at `vm-instance-setup.js:1064-1068` returns `{ error: ... }`. Status is never updated → infinite loop.

A second instance `203250431` is also generating 22 × `GET /compute/instances/<id>` 404 (drift check) every 30 min — same root cause.

**Recommended fix (auto-proposed — review before pushing):**

`js/vm-instance-setup.js`, in `deleteVPSinstance`:
```js
} catch (err) {
  // Contabo 404 means the instance is already gone — treat as success
  if (err?.status === 404 || /Entry Instances not found/i.test(err?.message || '')) {
    console.log(`[VPS] Contabo says instance ${contaboId} already gone — marking DELETED locally`)
    if (_vpsPlansOf) {
      await _vpsPlansOf.updateOne(
        { vpsId: String(vpsId) },
        { $set: { status: 'DELETED', deletedAt: new Date(), cancelReason: 'contabo_404_already_gone' } }
      )
    }
    return { success: true, alreadyGone: true, contaboId }
  }
  const errorMessage = `Error deleting VPS instance: ${err.message || JSON.stringify(err)}`
  console.error(errorMessage)
  return { error: errorMessage }
}
```
The same 404-as-success treatment is needed in the `getInstance` verification loop (L1041-1045) so that `verify after cancel → 404 → success`.

**Immediate one-shot cleanup (run once, no deploy):**
```js
// from a Node shell with mongo client connected
db.vpsPlansOf.updateMany(
  { vpsId: { $in: ['203283942', '203250431'] } },
  { $set: { status: 'DELETED', deletedAt: new Date(), cancelReason: 'manual_contabo_404_cleanup' } }
)
```

**Impact of fix:** stops 132 admin DMs/day, ~530 Contabo API hits/day, and removes 911 noise lines from logs.

---

### 2. Contabo OAuth `invalid_grant` (5 intermittent token failures in 11h)
**Service:** `Nomadly-EMAIL-IVR` | **Source:** `js/contabo-service.js` L43-74

**What's happening (00:30, 04:00, …):**
```
[Contabo] Token fetch failed: { error: 'invalid_grant', error_description: 'Invalid user credentials' }
Error deleting VPS instance: VPS provider authentication failed
…then…  [Contabo] Token acquired, expires in 300s   ← next attempt succeeds
```
Each failure is a single attempt with no retry; the very next call (sometimes seconds later) succeeds. Two probable causes:
1. **Race condition on token cache:** when the cached token is *exactly* at the 60s pre-expiry boundary, two concurrent callers both miss the cache and one of them gets a token that's already invalidated by the second call.
2. **Contabo's keycloak occasionally 401s for ~1s under load** — needs a single retry to absorb.

**Recommended fix (auto-proposed):**

`js/contabo-service.js`, wrap `getAccessToken` with single retry + in-flight de-dup:
```js
let _tokenInflight = null
async function getAccessToken() {
  const now = Date.now()
  if (_tokenCache.token && now < _tokenCache.expiresAt - 60000) return _tokenCache.token
  if (_tokenInflight) return _tokenInflight                 // de-dup concurrent refreshes
  _tokenInflight = (async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const params = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          username: API_USER, password: API_PASSWORD, grant_type: 'password' })
        const res = await axios.post(AUTH_URL, params.toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 })
        _tokenCache = { token: res.data.access_token, expiresAt: Date.now() + res.data.expires_in*1000 }
        console.log(`[Contabo] Token acquired (attempt ${attempt}), expires in ${res.data.expires_in}s`)
        return _tokenCache.token
      } catch (err) {
        const grantErr = err?.response?.data?.error === 'invalid_grant'
        console.error(`[Contabo] Token fetch failed (attempt ${attempt}):`, err?.response?.data || err.message)
        if (attempt === 2 || !grantErr) throw new Error('VPS provider authentication failed')
        await new Promise(r => setTimeout(r, 1500))
      }
    }
  })().finally(() => { _tokenInflight = null })
  return _tokenInflight
}
```
**Impact:** eliminates the 5 spurious `VPS DELETE FAILED` admin alerts that were caused purely by transient auth errors.

---

### 3. 🔐 Telegram bot token leaked into logs
**Service:** `HostingBotNew` | **Source:** Python httpx logger

The 5 "errors" on HostingBotNew are actually HTTP-200 OKs from `python-telegram-bot` being tagged as `severity=error` by Railway because they were written to stderr. **The problem is not the misclassification — it's the content:**
```
2026-05-12 22:22:54,970 [REDIRECT] HTTP Request:
  POST https://api.telegram.org/bot<REDACTED_BOT_TOKEN>/sendMessage
  "HTTP/1.1 200 OK"
```
The bot token `<REDACTED>` is in plain text in the deployment log buffer. Anyone with Railway-team read access (or any future log-drain export) can hijack the bot.

**Recommended fix (P0 — do this immediately):**
1. **Rotate the token** via @BotFather → `/revoke` → `/token` (or `/myget` if PTB CLI), update `TELEGRAM_BOT_TOKEN` in Railway env, redeploy.
2. **Silence httpx INFO logs:** at the bot's entry point, add
   ```python
   import logging
   logging.getLogger("httpx").setLevel(logging.WARNING)
   logging.getLogger("telegram.request").setLevel(logging.WARNING)
   ```
3. **(Defense-in-depth)** wrap the sendMessage URL through a redactor — most stdlib logging configs ship with no scrubbing.

---

## 🟠 P1 — Operational alerts that need attention now

### 4. Connect Reseller IP whitelist still broken — retry #36/#80
**Service:** `Nomadly-EMAIL-IVR` | **Source:** `js/cr-auto-whitelist.js`, `js/_index.js` L36917-36938
```
[CR-Whitelist] Outbound IP: 162.220.232.99
[CR-Whitelist] Retry #36 scheduled in 21600s            ← 6-hour retries
[CR-Whitelist] API test failed (attempt #80): Request failed with status code 401
```
Auto-whitelist via Playwright has been failing for ≥ 36 cycles (≥ 9 days). All Connect Reseller domain operations are blocked behind this IP gate. Required actions, in order of preference:

1. **Manual whitelist (fastest)** — Log into https://global.connectreseller.com/tools/profile and add `162.220.232.99` to the IP allowlist for the API key. Verify with:
   ```bash
   curl "https://api.connectreseller.com/ConnectReseller/ESHOP/SearchDomainList?APIKey=$API_KEY_CONNECT_RESELLER&page=1&maxIndex=1"
   ```
2. **Check `CR_PANEL_EMAIL` / `CR_PANEL_PASSWORD` env vars** are present in Railway (`cr-auto-whitelist.js:77-81` returns early if missing). Their absence is currently swallowed silently by the catch on L88-89.
3. **Surface this in admin DMs.** Currently the only signal is the per-6h Telegram nag at `_index.js:36936-36938`. Add a daily aggregated summary so it doesn't get buried.

---

### 5. Telnyx wallet low — $9.69 USD (alerting)
**Service:** `Nomadly-EMAIL-IVR` | **Source:** `js/balance-monitor.js`

`BalanceMonitor Telnyx: $9.69 USD [warning]` is logged every 2h and an admin alert is sent (`L147`). At current call/SMS rates this exhausts in ≤ 24h. **Action: top-up via the Telnyx Portal → Billing.** Twilio is at $13.30 (also low, but `[ok]` per current thresholds — consider raising the Twilio warning threshold from $10 to $25).

---

### 6. Fincra balance fetch repeatedly failing (LockbayNewFIX)
**Service:** `LockbayNewFIX` | **Source:** `services.fincra_service` (Python)
```
services.fincra_service - ERROR -
   ❌ BALANCE_FETCH_FAILED: No cached Fincra data available and fresh fetch failed
```
68× in the last 3.5h (every 3 min). The function has no warm-cache path; every miss is a full upstream call to Fincra. Likely causes:
- Fincra API key invalid / suspended
- Fincra rate-limiting our IP
- The cache-write side-effect was removed during a refactor

**Recommended fix (auto-proposed):**
- Verify `FINCRA_SECRET_KEY` / `FINCRA_API_KEY` is still active by hitting `https://api.fincra.com/profile/business/me` manually with the key.
- Add a stale-cache fallback: if fresh fetch fails, return the last successful value with a `stale=true` flag (acceptable for balance display).
- Reduce poll frequency from 3min → 15min until the issue is fixed; right now we're rate-limiting *ourselves* into the failure.

---

## 🟡 P2 — Log hygiene & noise

### 7. `unified_retry_service` emits 5 INFO lines/min for empty batches
**Service:** `LockbayNewFIX`
```
services.unified_retry_service - INFO -
   ✅ UNIFIED_RETRY_BATCH_COMPLETE: {'processed': 0, 'succeeded': 0, ...}
```
~85 lines / hour with `processed:0`. This is the single biggest reason the 5,000-line Railway buffer only covers 3.5h.

**Fix:** in `unified_retry_service.py`, gate the success log on `processed > 0`:
```python
if result["processed"] > 0:
    logger.info(f"✅ UNIFIED_RETRY_BATCH_COMPLETE: {result}")
else:
    logger.debug(f"empty batch (no work)")
```
Expected outcome: log window grows from ~3.5h to ~10–12h at no information loss.

### 8. FastForex/Tatum INFO every 5 min
```
services.fastforex_service - INFO - Fresh USD-NGN (Tatum): 1,360.40 (cached for 3600s)
```
Also high-frequency. Move to DEBUG once you confirm Tatum is reliable.

### 9. Railway severity mis-tagging (Python/PTB on stderr)
`HostingBotNew` shows 5 `severity=error` but they're 200-OK HTTP logs. Root cause: Python's `logging` defaults to stderr, and Railway maps anything on stderr to `error`. Either:
- Configure the root logger with a `StreamHandler(sys.stdout)` instead, **or**
- Run with `PYTHONUNBUFFERED=1 LOG_TO_STDOUT=1` and set httpx logger ≥ WARNING.

---

## 🟢 P3 — Observations (no fix needed)

- **No container restarts / crashes detected.** All three services are stable since their latest deploy.
- **`LockbayNewFIX` is running hot at 23 logs/min average** with 9 spike-minutes (>80/min) in the last 3.5h. Likely just busy traffic, not an anomaly — but bears watching for the next scaling decision.
- **`Nomadly-EMAIL-IVR` rate of 7.6/min average is healthy** once the VPS-delete storm is silenced; current "spikes" are caused by the 132 admin DMs.

---

## Priority-ordered fix queue

| # | Priority | Item                                                         | Effort | Files                                |
|--:|:--------:|--------------------------------------------------------------|--------|--------------------------------------|
| 1 | 🔴 P0    | Treat Contabo 404 as already-deleted (stops 132 alerts/day)  | 15 min | `js/vm-instance-setup.js`            |
| 2 | 🔴 P0    | One-shot DB cleanup for `203283942` & `203250431`            | 2 min  | direct Mongo update                  |
| 3 | 🔴 P0    | **Rotate Telegram bot token + silence httpx INFO logs**      | 10 min | BotFather + Python logging cfg       |
| 4 | 🔴 P0    | Add retry + in-flight de-dup to Contabo `getAccessToken`     | 15 min | `js/contabo-service.js`              |
| 5 | 🟠 P1    | Manually whitelist `162.220.232.99` in Connect Reseller      | 5 min  | (vendor panel)                       |
| 6 | 🟠 P1    | Top-up Telnyx wallet (currently $9.69)                       | 5 min  | (vendor panel)                       |
| 7 | 🟠 P1    | Stale-cache fallback + 15-min poll for Fincra balance        | 30 min | `services/fincra_service.py`         |
| 8 | 🟡 P2    | Skip empty `UNIFIED_RETRY_BATCH_COMPLETE` info logs          | 5 min  | `services/unified_retry_service.py`  |
| 9 | 🟡 P2    | Demote FastForex/Tatum to DEBUG                              | 5 min  | `services/fastforex_service.py`      |
|10 | 🟡 P2    | Fix Python logger → stdout to drop false `severity=error`    | 5 min  | bot entrypoint                       |

**Total cleanup time:** ~95 min of code + 4 vendor-panel tasks (~15 min).
**Expected log reduction:** ~70% noise reduction in `Nomadly-EMAIL-IVR`, ~50% in `LockbayNewFIX`.

---

## Raw data

- `/app/logs_prod/HostingBotNew.json`        — 112 entries
- `/app/logs_prod/LockbayNewFIX.json`        — 5,001 entries
- `/app/logs_prod/Nomadly-EMAIL-IVR.json`    — 5,001 entries
- `/app/logs_prod/_summary.json`             — per-service metadata
- `/app/logs_prod/_analysis.json`            — grouped patterns & counts

Fetcher: `/app/scripts/fetch_prod_anomalies.py`
Analyzer: `/app/scripts/analyze_prod_anomalies.py`
