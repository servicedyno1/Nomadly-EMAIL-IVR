#!/bin/bash
# ============================================================
# Restore infra SSH keys + Git PAT from the Nomadly vault
# ============================================================
# Pulls DROPLET_SSH_KEY_B64 / WHM_BOX_SSH_KEY_B64 / GITHUB_PAT_CLASSIC
# out of memory/nomadly.vault.enc and writes them to /root/.ssh
# (chmod 600) + prints the git remote line. Use on a fresh pod so
# SSH to the DO droplet and WHM box + GitHub pushes work again.
#
# Usage: VAULT_PASSWORD='...' bash scripts/restore_infra_keys.sh
# ============================================================
set -e
VAULT="/app/memory/nomadly.vault.enc"
[ -n "$VAULT_PASSWORD" ] || { read -r -s -p "Vault password: " VAULT_PASSWORD; echo ""; }
TMP="$(mktemp)"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$VAULT" -out "$TMP" -pass "pass:$VAULT_PASSWORD" 2>/dev/null \
  || { echo "❌ wrong password / corrupt vault"; rm -f "$TMP"; exit 1; }

mkdir -p /root/.ssh && chmod 700 /root/.ssh
grep '^DROPLET_SSH_KEY_B64=' "$TMP" | cut -d= -f2- | base64 -d > /root/.ssh/nomadly_droplet
grep '^DROPLET_SSH_PUB='     "$TMP" | cut -d= -f2- > /root/.ssh/nomadly_droplet.pub
grep '^WHM_BOX_SSH_KEY_B64=' "$TMP" | cut -d= -f2- | base64 -d > /root/.ssh/whm_box
grep '^WHM_BOX_SSH_PUB='     "$TMP" | cut -d= -f2- > /root/.ssh/whm_box.pub
chmod 600 /root/.ssh/nomadly_droplet /root/.ssh/whm_box
chmod 644 /root/.ssh/nomadly_droplet.pub /root/.ssh/whm_box.pub

DROPLET_IP=$(grep '^DROPLET_IP=' "$TMP" | cut -d= -f2-)
WHM_IP=$(grep '^WHM_IP=' "$TMP" | cut -d= -f2-)
PAT=$(grep '^GITHUB_PAT_CLASSIC=' "$TMP" | cut -d= -f2-)
REPO=$(grep '^GITHUB_REPO=' "$TMP" | cut -d= -f2- | sed 's#https://##')
rm -f "$TMP"

echo "✅ Restored SSH keys to /root/.ssh"
echo "   DO droplet : ssh -i /root/.ssh/nomadly_droplet root@${DROPLET_IP}"
echo "   WHM box    : ssh -i /root/.ssh/whm_box root@${WHM_IP}"
echo "   Git remote : git remote set-url origin https://${PAT}@${REPO}"
