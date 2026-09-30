#!/bin/bash
# ============================================================
# Nomadly Secrets Vault
# ============================================================
# Encrypts /app/backend/.env (all app credentials) into a single
# AES-256 encrypted file that persists in /app/memory (git-tracked),
# so the full credential list never has to be re-shared — only the
# vault password is needed to restore everything on a fresh pod.
#
# Encryption: openssl aes-256-cbc, PBKDF2 (200k iterations), salted.
# The password is NEVER stored on disk.
#
# Usage:
#   VAULT_PASSWORD='yourpass' bash scripts/vault.sh lock     # .env  -> vault
#   VAULT_PASSWORD='yourpass' bash scripts/vault.sh unlock   # vault -> .env
#   bash scripts/vault.sh lock                               # prompt for pass
# ============================================================
set -e

VAULT_FILE="/app/memory/nomadly.vault.enc"
ENV_FILE="/app/backend/.env"
ITER=200000

get_pass() {
  if [ -n "$VAULT_PASSWORD" ]; then
    PASS="$VAULT_PASSWORD"
  else
    read -r -s -p "Vault password: " PASS; echo ""
  fi
  if [ -z "$PASS" ]; then echo "❌ Empty password"; exit 1; fi
}

cmd="$1"
case "$cmd" in
  lock)
    if [ ! -f "$ENV_FILE" ]; then echo "❌ $ENV_FILE not found"; exit 1; fi
    get_pass
    openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -salt \
      -in "$ENV_FILE" -out "$VAULT_FILE" -pass "pass:$PASS"
    echo "🔒 Locked $ENV_FILE -> $VAULT_FILE ($(wc -c < "$VAULT_FILE") bytes)"
    ;;
  unlock)
    if [ ! -f "$VAULT_FILE" ]; then echo "❌ $VAULT_FILE not found"; exit 1; fi
    get_pass
    tmp="$(mktemp)"
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter "$ITER" \
      -in "$VAULT_FILE" -out "$tmp" -pass "pass:$PASS" 2>/dev/null; then
      rm -f "$tmp"; echo "❌ Wrong password or corrupt vault"; exit 1
    fi
    mv "$tmp" "$ENV_FILE"
    rm -f /app/.env
    echo "🔓 Unlocked $VAULT_FILE -> $ENV_FILE"
    echo "   Run: sudo supervisorctl restart backend nodejs frontend"
    ;;
  verify)
    if [ ! -f "$VAULT_FILE" ]; then echo "❌ vault missing"; exit 1; fi
    get_pass
    if openssl enc -d -aes-256-cbc -pbkdf2 -iter "$ITER" \
      -in "$VAULT_FILE" -pass "pass:$PASS" 2>/dev/null | grep -q "MONGO_URL="; then
      echo "✅ Vault password OK — decrypts to a valid .env"
    else
      echo "❌ Wrong password or corrupt vault"; exit 1
    fi
    ;;
  *)
    echo "Usage: VAULT_PASSWORD=... bash scripts/vault.sh {lock|unlock|verify}"; exit 1
    ;;
esac
