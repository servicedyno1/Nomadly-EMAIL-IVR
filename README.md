# Nomadly — Telegram Bot + Cloud Phone Platform

Multi-service application: Telegram bot, Telnyx/Twilio voice/SIP, FastAPI backend, React frontend.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Kubernetes Ingress                     │
│  /api/*  →  FastAPI (8001)  →  Node.js Express (5000)    │
│  /*      →  React Frontend (3000)                        │
└──────────────────────────────────────────────────────────┘
```

| Service           | Port  | Role                                               |
|-------------------|-------|----------------------------------------------------|
| React Frontend    | 3000  | UI — SIP test page, admin panel                    |
| FastAPI Backend   | 8001  | Reverse proxy to Node.js + CORS                   |
| Node.js Express   | 5000  | Core business logic: Telegram bot, webhooks, APIs  |
| MongoDB           | 27017 | Local instance (also connects to external Railway) |

### Request Flow
1. All requests hit the Kubernetes ingress
2. Paths starting with `/api/` → FastAPI on port 8001
3. FastAPI strips `/api/` prefix and proxies to Node.js Express on port 5000
4. All other paths → React frontend on port 3000

---

## ⚡ Quick Setup (Emergent Agent)

**Run this ONE command after any fresh deployment:**

```bash
bash /app/scripts/setup-nodejs.sh
```

This script handles everything:
- Detects current pod URL from `frontend/.env`
- Updates `SELF_URL` / `SELF_URL_DEV` to `<pod_url>/api`
- Creates `.env` symlink so Node.js reads `backend/.env`
- Installs Node.js dependencies (`yarn install`)
- Creates supervisor config for Node.js
- Starts the Node.js process

---

## Development vs Production Environment

### Critical Safety Rules

| Setting | Development | Production (Railway) |
|---------|-------------|---------------------|
| `BOT_ENVIRONMENT` | `development` | `production` |
| Bot Token Used | `TELEGRAM_BOT_TOKEN_DEV` | `TELEGRAM_BOT_TOKEN_PROD` |
| Webhook URL | `SELF_URL` / `SELF_URL_DEV` (pod URL) | `SELF_URL_PROD` (Railway URL) |
| `SKIP_WEBHOOK_SYNC` | `true` | not set / `false` |
| `MONGO_URL` | Railway remote DB (shared) | Railway remote DB |

### How Token Selection Works (`js/config-setup.js`)

1. `BOT_ENVIRONMENT` determines which bot token is active:
   - `development` → uses `TELEGRAM_BOT_TOKEN_DEV`
   - `production` → uses `TELEGRAM_BOT_TOKEN_PROD`
2. **NEVER set `BOT_ENVIRONMENT=production` in development** — this would activate the production Telegram bot from the dev pod, causing duplicate message handling and webhook conflicts.

### How Webhook URL Selection Works

1. In `development` mode: uses `SELF_URL_DEV` → `SELF_URL` (fallback)
2. In `production` mode: uses `SELF_URL_PROD` → `SELF_URL` (fallback)
3. The `setup-nodejs.sh` script auto-detects the current pod URL and sets `SELF_URL` + `SELF_URL_DEV`.
4. `SELF_URL_PROD` is stored in the .env for reference but is **NOT used** when `BOT_ENVIRONMENT=development`.

### SKIP_WEBHOOK_SYNC=true (Development Safety Guard)

This flag prevents the development instance from:
- Overwriting production Telnyx/Twilio webhook URLs
- Migrating phone numbers to a different Call Control App
- Updating SIP connection ANI overrides

**Always keep `SKIP_WEBHOOK_SYNC=true` in development.**

### Production Telegram Bot — DO NOT USE in Development

The production bot token (`TELEGRAM_BOT_TOKEN_PROD`) is stored in the .env for reference only. To use a Telegram bot in development:
1. Set `BOT_ENVIRONMENT=development` (already configured)
2. Provide a **separate development bot token** in `TELEGRAM_BOT_TOKEN_DEV`
3. The current dev token is pre-configured; replace it if you need a different dev bot

---

## Environment Variables

### Protected (NEVER modify)
- `frontend/.env` → `REACT_APP_BACKEND_URL` (set by platform)

### Webhook Configuration
- `SELF_URL` and `SELF_URL_DEV` in `backend/.env` **MUST** use the current pod URL with `/api` suffix
- The setup script auto-detects this from `REACT_APP_BACKEND_URL`
- Example: `https://api-aggregator-5.preview.emergentagent.com/api`
- `SELF_URL_PROD` points to the Railway production URL and is **NOT used in development**

### Key API Credentials (in backend/.env)
| Variable | Service |
|----------|--------|
| `TELNYX_API_KEY` | Telnyx voice/SIP/SMS |
| `TELNYX_SIP_CONNECTION_ID` | SIP connection |
| `TELNYX_MESSAGING_PROFILE_ID` | SMS messaging |
| `TELNYX_CALL_CONTROL_APP_ID` | Call control |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio backup |
| `TELEGRAM_BOT_TOKEN_PROD` | Telegram bot |
| `API_KEY_RAILWAY` | Railway deployment |
| `CLOUDFLARE_API_KEY` | DNS management |
| `FINCRA_*` | Payment processing |
| `BREVO_API_KEY` | Email service |

---

## File Structure

```
/app/
├── backend/
│   ├── .env              ← All environment variables (single source of truth)
│   └── server.py         ← FastAPI reverse proxy to Node.js
├── frontend/
│   ├── .env              ← REACT_APP_BACKEND_URL (platform-managed)
│   └── src/
│       └── pages/
│           └── PhoneTestPage.js  ← SIP test page
├── js/                   ← Node.js Express application
│   ├── _index.js         ← Main entry: Express routes + Telegram bot
│   ├── start-bot.js      ← Startup with config-setup
│   ├── config-setup.js   ← Environment detection + defaults
│   ├── config.js         ← App configuration
│   ├── db.js             ← MongoDB connection
│   ├── voice-service.js  ← Telnyx voice/SIP/IVR handling
│   ├── sms-service.js    ← SMS service with limits + overage
│   ├── telnyx-service.js ← Telnyx API wrapper
│   ├── twilio-service.js ← Twilio API wrapper
│   ├── cnam-service.js   ← CNAM lookup (Telnyx→Multitel→SignalWire)
│   ├── phone-test-routes.js ← SIP test OTP + credentials
│   ├── lead-job-persistence.js ← Lead job crash recovery
│   └── ...               ← Domain, hosting, payment services
├── scripts/
│   └── setup-nodejs.sh   ← Automated deployment setup
├── .env                  ← Symlink → backend/.env (for Node.js dotenv)
├── package.json          ← Node.js dependencies
└── memory/
    └── PRD.md            ← Product requirements + deployment docs
```

---

## Supervisor Services

| Program   | Config File | Command |
|-----------|-------------|---------|
| backend   | `supervisord.conf` (readonly) | `uvicorn server:app --port 8001` |
| frontend  | `supervisord.conf` (readonly) | `yarn start` (port 3000) |
| mongodb   | `supervisord.conf` (readonly) | `mongod --bind_ip_all` |
| **nodejs** | `supervisord_nodejs.conf` | `node js/start-bot.js` |

```bash
# Check all services
sudo supervisorctl status

# Restart individual service
sudo supervisorctl restart nodejs
sudo supervisorctl restart backend

# View Node.js logs
tail -f /var/log/supervisor/nodejs.out.log
tail -f /var/log/supervisor/nodejs.err.log
```

---

## MongoDB Collections

| Collection | Purpose |
|------------|--------|
| `testOtps` | SIP test OTPs (TTL 5 min) |
| `testCredentials` | SIP test creds per chatId |
| `testReferrals` | Referral codes + bonus tracking |
| `leadJobs` | Lead generation job persistence |
| `phoneNumbersOf` | User phone number assignments |
| `phoneLogs` | Call/SMS usage logs |

---

## Troubleshooting

### Node.js not running
```bash
bash /app/scripts/setup-nodejs.sh
```

### Webhooks not working
1. Check SELF_URL matches current pod: `grep SELF_URL /app/backend/.env`
2. Must end with `/api` — e.g., `https://api-aggregator-5.preview.emergentagent.com/api`
3. Re-run setup script to auto-fix: `bash /app/scripts/setup-nodejs.sh`

### 502 errors on /api/* routes
- Node.js Express (port 5000) is down
- Fix: `sudo supervisorctl restart nodejs`
- Check logs: `tail -n 50 /var/log/supervisor/nodejs.out.log`

### Environment variables not loading
- Verify symlink: `ls -la /app/.env` should point to `backend/.env`
- If missing: `ln -sf /app/backend/.env /app/.env`

---

## 📱 SMS App — Android APK Build Guide

The Nomadly SMS app is a **Capacitor hybrid app** — a web app (HTML/JS/CSS in `sms-app/www/`) wrapped in an Android native shell with native SMS sending plugins.

### Prerequisites (one-time setup)

The build environment is ARM64 (aarch64) but Android's AAPT2 tool is x86-only.
We use **qemu-user-static** to emulate x86 binaries on ARM64.

```bash
# 1. Install Java JDK 17 + qemu for x86 emulation
apt-get update -qq
apt-get install -y -qq openjdk-17-jdk-headless wget unzip qemu-user-static binfmt-support

# 2. Install x86-64 libraries (needed by qemu to run x86 Android tools)
dpkg --add-architecture amd64
apt-get update -qq
apt-get install -y -qq libc6:amd64 libstdc++6:amd64 zlib1g:amd64

# 3. Install Android SDK
export ANDROID_HOME=/opt/android-sdk
mkdir -p $ANDROID_HOME
wget -q "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -O /tmp/cmdtools.zip
mkdir -p $ANDROID_HOME/cmdline-tools
unzip -q -o /tmp/cmdtools.zip -d $ANDROID_HOME/cmdline-tools
mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest 2>/dev/null || true
rm /tmp/cmdtools.zip

# 4. Accept licenses and install required SDK components
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64
export PATH=$PATH:$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin
yes | sdkmanager --licenses 2>/dev/null
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"

# 5. Create AAPT2 qemu wrapper (critical for ARM64 builds)
# First, run a quick Gradle build to download the Gradle-managed aapt2 binary:
cd /app/sms-app/android && ./gradlew tasks --no-daemon 2>&1 | tail -1
# Find the downloaded aapt2 binary:
AAPT2_REAL=$(find /root/.gradle -name "aapt2" -path "*/aapt2-*-linux/aapt2" -type f | head -1)
echo "AAPT2 path: $AAPT2_REAL"
# Create the wrapper script:
mkdir -p /opt/aapt2-dir
cat > /opt/aapt2-dir/aapt2 << EOF
#!/bin/bash
exec qemu-x86_64-static "$AAPT2_REAL" "\$@"
EOF
chmod +x /opt/aapt2-dir/aapt2
# Verify it works:
/opt/aapt2-dir/aapt2 version
```

### Building the APK

```bash
# Set environment
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME

# 1. Sync Capacitor web assets → Android project
cd /app/sms-app
yarn install
npx cap sync android

# 2. Build the debug APK
cd /app/sms-app/android
./gradlew assembleDebug --no-daemon

# 3. Copy APK to distribution locations
cp app/build/outputs/apk/debug/app-debug.apk /app/static/nomadly-sms.apk
cp app/build/outputs/apk/debug/app-debug.apk /app/backend/static/nomadly-sms.apk

# 4. Verify
ls -lh /app/static/nomadly-sms.apk
```

### Key Paths

| Path | Purpose |
|------|---------|
| `sms-app/www/` | Web assets (HTML, JS, CSS) — the actual app UI |
| `sms-app/www/js/app.js` | Main app logic (campaigns, SMS sending, sync) |
| `sms-app/www/js/api.js` | Server API client |
| `sms-app/android/app/src/main/java/com/nomadly/sms/plugins/DirectSmsPlugin.java` | Native SMS sending (foreground) |
| `sms-app/android/app/src/main/java/com/nomadly/sms/services/SmsBackgroundService.java` | Native SMS sending (background) |
| `sms-app/android/app/build.gradle` | Version code/name (`versionCode`, `versionName`) |
| `sms-app/android/gradle.properties` | AAPT2 override path |
| `js/sms-app-service.js` | Server-side SMS app endpoints |
| `static/nomadly-sms.apk` | Distribution APK (served at `/sms-app/download`) |

### Version Bumping

Before building, update version in `sms-app/android/app/build.gradle`:
```groovy
versionCode 11    // Increment by 1
versionName "2.3.2"  // Semantic version
```
Also update `latestVersion` in `js/sms-app-service.js` and version in the `/sms-app/download/info` endpoint in `js/_index.js`.

### Diagnostics

```bash
# Check SMS app diagnostics for a specific user
curl http://localhost:5000/sms-app/diagnostics/<chatId>
```


---

## Railway Production Access (GraphQL API)

Production runs on **Railway** (Project: `New Hosting`). You can read env vars / logs / trigger deploys via Railway's GraphQL API without using the dashboard.

### Endpoint

```
POST https://backboard.railway.app/graphql/v2
Content-Type: application/json
```

### Credentials (stored in `backend/.env`)

| Env Var | What it is | Header to use |
|---------|------------|---------------|
| `API_KEY_RAILWAY` | Account-level API token (email: `service@dyno.pt`) | `Authorization: Bearer <key>` |
| `RAILWAY_PROJECT_TOKEN` | Project-scoped access token (read/write this project only) | `Project-Access-Token: <token>` |
| `RAILWAY_PROJECT_ID` | `c23ac3d9-51c5-4242-8776-eed4e3801abe` (New Hosting) | body variable |
| `RAILWAY_ENVIRONMENT_ID` | `889fd56a-720a-4020-884c-034784992666` (production) | body variable |
| `RAILWAY_SERVICE_ID` | `b9c4ad64-7667-4dd3-8b9a-3867ede47885` (Nomadly-EMAIL-IVR — the main Node.js service with `MONGO_URL`, `TELEGRAM_BOT_TOKEN_PROD`) | body variable |

> 💡 **Use `Project-Access-Token` for most operations** — scoped to this project, safer than the account-level key.

### 1. List services

```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Project-Access-Token: $RAILWAY_PROJECT_TOKEN" \
  -d '{"query":"query { project(id: \"'"$RAILWAY_PROJECT_ID"'\") { name services { edges { node { id name } } } } }"}'
```

Known services in `New Hosting`:
- `HostingBotNew` — `0a453645-4180-441b-8988-020807f4479a` (Postgres/hostbay)
- `LockbayNewFIX` — `96ee768e-3f4d-49c8-be75-dea30777e890`
- **`Nomadly-EMAIL-IVR`** — `b9c4ad64-7667-4dd3-8b9a-3867ede47885` ← **main Nomadly bot backend**

### 2. Read env variables (e.g. get production `MONGO_URL`, `TELEGRAM_BOT_TOKEN_PROD`)

```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Project-Access-Token: $RAILWAY_PROJECT_TOKEN" \
  -d '{"query":"query { variables(projectId: \"'"$RAILWAY_PROJECT_ID"'\", environmentId: \"'"$RAILWAY_ENVIRONMENT_ID"'\", serviceId: \"'"$RAILWAY_SERVICE_ID"'\") }"}' \
  | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); v=d['data']['variables']; print('MONGO_URL:', v.get('MONGO_URL')); print('DB_NAME:', v.get('DB_NAME'))"
```

### 3. Update a variable (triggers automatic redeploy)

```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Project-Access-Token: $RAILWAY_PROJECT_TOKEN" \
  -d '{
    "query": "mutation ($input: VariableUpsertInput!) { variableUpsert(input: $input) }",
    "variables": {
      "input": {
        "projectId":     "'"$RAILWAY_PROJECT_ID"'",
        "environmentId": "'"$RAILWAY_ENVIRONMENT_ID"'",
        "serviceId":     "'"$RAILWAY_SERVICE_ID"'",
        "name":  "SOME_KEY",
        "value": "some-value"
      }
    }
  }'
```

### 4. Fetch the latest deployment & its logs

```bash
# Get latest deployment ID
DEPLOY_ID=$(curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Project-Access-Token: $RAILWAY_PROJECT_TOKEN" \
  -d '{"query":"query { deployments(input: {projectId: \"'"$RAILWAY_PROJECT_ID"'\", environmentId: \"'"$RAILWAY_ENVIRONMENT_ID"'\", serviceId: \"'"$RAILWAY_SERVICE_ID"'\"}, first: 1) { edges { node { id status createdAt } } } }"}' \
  | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['data']['deployments']['edges'][0]['node']['id'])")

# Pull filtered logs (e.g. grep by chatId, tag, or error)
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Project-Access-Token: $RAILWAY_PROJECT_TOKEN" \
  -d '{"query":"query { deploymentLogs(deploymentId: \"'"$DEPLOY_ID"'\", limit: 500, filter: \"ERROR\") { message timestamp severity } }"}'
```

Common filters: `"ERROR"`, `"[CR-Whitelist]"`, `"<chatId>"`, `"<phone number>"`, `"[Voice]"`, etc.

### 5. Connect to production MongoDB (read/write prod data from dev)

```bash
# Pull MONGO_URL + DB_NAME from Railway at runtime and connect
python3 << 'PY'
import os, json, urllib.request
TOKEN = os.environ['RAILWAY_PROJECT_TOKEN']
PID = os.environ['RAILWAY_PROJECT_ID']
EID = os.environ['RAILWAY_ENVIRONMENT_ID']
SID = os.environ['RAILWAY_SERVICE_ID']
body = json.dumps({"query": f'query {{ variables(projectId: "{PID}", environmentId: "{EID}", serviceId: "{SID}") }}'}).encode()
req = urllib.request.Request("https://backboard.railway.app/graphql/v2",
    data=body, headers={"Content-Type":"application/json","Project-Access-Token":TOKEN})
v = json.loads(urllib.request.urlopen(req).read())['data']['variables']

from pymongo import MongoClient
db = MongoClient(v['MONGO_URL'])[v['DB_NAME']]
# ...do work with prod DB...
print("Users in prod:", db.nameOf.count_documents({}))
PY
```

### Useful example queries

```bash
# Find a user by Telegram username
db.nameOf.find_one({'val': 'flmzv2'})  # → {'_id': '7304424395', ...}

# Check a user's subscription
db.planOf.find_one({'_id': chatId})
db.planEndingTime.find_one({'_id': chatId})

# Wallet balance = usdIn - usdOut; loyalty tier derived from usdOut + ngnOut/1500
db.walletOf.find_one({'_id': chatId})
```

### Safety notes

- **Never run** `initializeTelnyxResources`, `initializeTwilioResources`, `migrateNumbersToCallControlApp`, or `updateAniOverride` **from dev** — they mutate production Telnyx/Twilio state using the shared production API keys. `SKIP_WEBHOOK_SYNC=true` in `backend/.env` guards against this (see `js/_index.js:1475`).
- When writing to production MongoDB, prefer MongoDB's atomic operators (`$inc`, `$set` with `upsert:true`) to match the bot's own `set()` / `atomicIncrement()` helpers.
- After updating a Railway variable, the service auto-redeploys within ~30s. Check deployment status via the `deployments` query.
