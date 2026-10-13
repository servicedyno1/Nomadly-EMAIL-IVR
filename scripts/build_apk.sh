#!/bin/bash
# Build a BRAND-SPECIFIC BulkSMS APK from /app/sms-app.
#   bash scripts/build_apk.sh            → nomadly (static/nomadly-sms.apk)
#   bash scripts/build_apk.sh smadav     → smadav  (static/smadav-sms.apk)
# Follows the verified aarch64-pod sequence in /app/sms-app/README.md.
# Log: /tmp/apk_build_<brand>.log
set -euo pipefail
BRAND="${1:-nomadly}"
exec > "/tmp/apk_build_${BRAND}.log" 2>&1

echo "=== STAGE 0: brand=$BRAND at $(date -u +%FT%TZ) on $(uname -m) ==="
cd /app/sms-app
VERSION=$(node -e "console.log(require('./package.json').version)")

# Load brand vars from brands/brands.json: APP_NAME APP_ID BOT API_BASE ACCENT BRAND_NAME APK_NAME
load_brand() {
  local json
  json=$(node -e "const b=require('./brands/brands.json')['$1']; if(!b){console.error('unknown brand $1');process.exit(2)}; console.log(JSON.stringify(b))")
  bget() { node -e "console.log(JSON.parse(process.argv[1])[process.argv[2]])" "$json" "$1"; }
  APP_NAME=$(bget appName); APP_ID=$(bget appId); BOT=$(bget botUsername); API_BASE=$(bget apiBase); ACCENT=$(bget accent); BRAND_NAME=$(bget name); APK_NAME=$(bget apk)
}

# Write brand.js, index.html title/version, strings.xml, capacitor.config.json, icons/splash for brand $1
apply_brand() {
  load_brand "$1"
  cat > www/js/brand.js <<BRANDJS
// GENERATED PER BUILD by scripts/build_apk.sh $1 — do not hand-edit brand values.
window.BRAND = {
  slug: '$1',
  name: '$BRAND_NAME',
  appName: '$APP_NAME',
  botUsername: '$BOT',
  botUrl: 'https://t.me/$BOT',
  apiBase: '$API_BASE',
  accent: '$ACCENT',
  version: '$VERSION',
}
BRANDJS
  sed -i -E "s#<meta name=\"app-version\" content=\"[^\"]*\">#<meta name=\"app-version\" content=\"$VERSION\">#; s#<title data-brand=\"appName\">[^<]*</title>#<title data-brand=\"appName\">$APP_NAME</title>#" www/index.html
  sed -i -E "s#id=\"setVersion\">[^<]*<#id=\"setVersion\">$VERSION<#" www/index.html
  cat > android/app/src/main/res/values/strings.xml <<STRINGS
<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">$APP_NAME</string>
    <string name="title_activity_main">$APP_NAME</string>
    <string name="package_name">$APP_ID</string>
    <string name="custom_url_scheme">$APP_ID</string>
</resources>
STRINGS
  node -e "const f='capacitor.config.json';const c=require('./'+f);c.appId='$APP_ID';c.appName='$APP_NAME';require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
  python3 /app/scripts/brand_assets.py --install "$1"
}

load_brand "$BRAND"
echo "appName=$APP_NAME appId=$APP_ID bot=@$BOT api=$API_BASE version=$VERSION → static/$APK_NAME"

export ANDROID_SDK_ROOT=/opt/android-sdk
export ANDROID_HOME=$ANDROID_SDK_ROOT
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64
export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$JAVA_HOME/bin:$PATH"

echo "=== STAGE 1: apt deps ==="
if ! command -v javac >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq openjdk-17-jdk-headless unzip curl
else
  echo "java already present: $(java -version 2>&1 | head -1)"
fi

echo "=== STAGE 2: cmdline-tools + platform-34 + build-tools 34.0.0 ==="
if [ ! -x "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" ]; then
  mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"
  curl -sSL -o /tmp/cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q -o /tmp/cmdtools.zip -d "$ANDROID_SDK_ROOT/cmdline-tools/"
  if [ -d "$ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools" ]; then
    rm -rf "$ANDROID_SDK_ROOT/cmdline-tools/latest"
    mv "$ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools" "$ANDROID_SDK_ROOT/cmdline-tools/latest"
  fi
else
  echo "cmdline-tools already present"
fi
if [ ! -d "$ANDROID_SDK_ROOT/platforms/android-34" ] || [ ! -d "$ANDROID_SDK_ROOT/build-tools/34.0.0" ]; then
  yes | sdkmanager --licenses > /dev/null 2>&1 || true
  sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
else
  echo "platform-34 + build-tools 34.0.0 already installed"
fi

echo "=== STAGE 3: native-aarch64 aapt2 ==="
AAPT2_PATHS=("/opt/aapt2/aapt2" "/opt/aapt2-dir/aapt2")
need_install=0
for p in "${AAPT2_PATHS[@]}"; do
  if [ ! -x "$p" ] || ! "$p" version >/dev/null 2>&1; then need_install=1; fi
done
if [ "$need_install" = "1" ]; then
  curl -sSL -o /tmp/sdk-aarch64.zip https://github.com/lzhiyong/sdk-tools/releases/latest/download/android-sdk-tools-static-aarch64.zip
  mkdir -p /tmp/aarch64 && rm -rf /tmp/aarch64/*
  unzip -o -q /tmp/sdk-aarch64.zip -d /tmp/aarch64
  for p in "${AAPT2_PATHS[@]}"; do
    mkdir -p "$(dirname "$p")"; cp /tmp/aarch64/build-tools/aapt2 "$p"; chmod +x "$p"
    echo "Installed $p: $($p version)"
  done
else
  for p in "${AAPT2_PATHS[@]}"; do echo "$p OK: $($p version)"; done
fi

echo "=== STAGE 4: brand the sources (brand.js, strings.xml, icons, splash, version) ==="
apply_brand "$BRAND"

echo "=== STAGE 5: cap sync + gradle assembleDebug ==="
if [ ! -d node_modules ]; then npm install --no-audit --no-fund --silent; fi
echo "sdk.dir=$ANDROID_SDK_ROOT" > android/local.properties
npx cap sync android
cd android
./gradlew assembleDebug --no-daemon -PbrandAppId="$APP_ID" -PbrandVersion="$VERSION"

echo "=== STAGE 6: deploy APK + manifest ==="
APK=app/build/outputs/apk/debug/app-debug.apk
ls -la "$APK"
mkdir -p /app/backend/static /app/static
for dst in /app/static /app/backend/static; do
  cp "$APK" "$dst/$APK_NAME"
  node -e "require('fs').writeFileSync('$dst/$APK_NAME.json', JSON.stringify({brand:'$BRAND',appName:'$APP_NAME',appId:'$APP_ID',version:'$VERSION',apiBase:'$API_BASE',builtAt:new Date().toISOString(),md5:require('crypto').createHash('md5').update(require('fs').readFileSync('$dst/$APK_NAME')).digest('hex')},null,2)+'\n')"
done
ls -la /app/static/$APK_NAME /app/static/$APK_NAME.json

echo "=== STAGE 7: sanity-check brand + URLs baked in the APK ==="
mkdir -p /tmp/apk_inspect_$BRAND && rm -rf /tmp/apk_inspect_$BRAND/*
unzip -o -q /app/static/$APK_NAME -d /tmp/apk_inspect_$BRAND
grep -oE "https?://[a-zA-Z0-9./_-]+" /tmp/apk_inspect_$BRAND/assets/public/js/brand.js | sort -u || true
grep -o "slug: '[a-z]*'" /tmp/apk_inspect_$BRAND/assets/public/js/brand.js || true
grep -q "_reachable" /tmp/apk_inspect_$BRAND/assets/public/js/api.js && echo "api.js: baked-server-first resolver present"

echo "=== STAGE 8: restore default (nomadly) sources so the repo always holds the Nomadly brand ==="
cd /app/sms-app
if [ "$BRAND" != "nomadly" ]; then apply_brand nomadly; fi
echo "=== DONE brand=$BRAND at $(date -u +%FT%TZ) ==="
