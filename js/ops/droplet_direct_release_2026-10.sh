#!/usr/bin/env bash
# Build a blue/green release on the droplet from a git-archive tarball (no GitHub push needed).
# Usage (on the droplet): droplet_direct_release_2026-10.sh <app> <tarball.tgz> <sha> <branch> <fe_tree>
# Mirrors deploy.sh build_release: reuses node_modules + frontend build from the active release,
# links shared backend.env, and carries over runtime audio files. Prints the new release dir.
set -euo pipefail
APP="$1"; TGZ="$2"; SHA="$3"; BRANCH="$4"; FE_TREE="$5"
ROOT=/opt/nomadly
CUR="$(readlink -f "$ROOT/current/$APP")"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
REL="$ROOT/releases/$APP/$TS-${SHA:0:7}"
mkdir -p "$REL"
tar -xzf "$TGZ" -C "$REL"
FE_ENV="$(sed -n 's/^fe_env=//p' "$CUR/RELEASE")"
printf 'sha=%s\nbranch=%s\nfe_tree=%s\nfe_env=%s\nbuilt_at=%s\npatched=direct deploy from Emergent workspace (not on GitHub yet); frontend build reused from %s\n' \
  "$SHA" "$BRANCH" "$FE_TREE" "${FE_ENV:-none}" "$TS" "$(basename "$CUR")" > "$REL/RELEASE"
mkdir -p "$REL/backend" && ln -sfn "$ROOT/shared/$APP/backend.env" "$REL/backend/.env"
cmp -s "$CUR/package.json" "$REL/package.json" || { echo "package.json changed — refusing (use the normal deploy)" >&2; exit 1; }
cp -al "$CUR/node_modules" "$REL/node_modules"
if [ -d "$CUR/frontend/node_modules" ]; then cp -al "$CUR/frontend/node_modules" "$REL/frontend/node_modules"; fi
cp -a "$CUR/frontend/build" "$REL/frontend/build"
for d in js/assets/user-audio audio_cache; do
  if [ -d "$CUR/$d" ]; then mkdir -p "$REL/$d" && cp -aln "$CUR/$d/." "$REL/$d/"; fi
done
for f in js/_index.js js/bulk-call-service.js js/voice-service.js js/telnyx-service.js js/telnyx-regulatory.js js/phone-config.js js/phone-scheduler.js js/twilio-service.js; do
  node --check "$REL/$f"
done
echo "$REL"
