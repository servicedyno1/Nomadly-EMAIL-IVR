#!/bin/bash
# PROSHOP: wait for .xyz delegation → LE certs (dns-cloudflare, same params as Voodoo) → enable nginx site.
# Run on droplet: nohup bash /root/proshop_cert_watch.sh > /root/proshop_cert_watch.log 2>&1 &
set -u
log() { echo "$(date -u +%FT%TZ) $*"; }
delegated() { dig +short NS "$1" @1.1.1.1 | grep -q cloudflare; }
cf_activate() {
  local id="$1" E K
  E=$(grep -E '^dns_cloudflare_email' /root/.cloudflare.ini | sed -E 's/.*= *//')
  K=$(grep -E '^dns_cloudflare_api_key' /root/.cloudflare.ini | sed -E 's/.*= *//')
  curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$id/activation_check" -H "X-Auth-Email: $E" -H "X-Auth-Key: $K" >/dev/null || true
}
for i in $(seq 1 240); do
  if delegated proshopivr.xyz && delegated proshophost.xyz; then log "delegated (both)"; break; fi
  [ $((i % 10)) -eq 1 ] && log "waiting for delegation (try $i)"
  sleep 30
done
delegated proshopivr.xyz && delegated proshophost.xyz || { log "GAVE UP waiting for delegation"; exit 1; }
cf_activate c13803ebc100a1c443a3697f746aaef5; cf_activate b62b004091cab34d0d1fafc3d59e97a4
for d in proshopivr.xyz panel.proshophost.xyz; do
  if [ -f "/etc/letsencrypt/live/$d/fullchain.pem" ]; then log "cert exists: $d"; continue; fi
  for attempt in 1 2 3; do
    certbot certonly --non-interactive --agree-tos --dns-cloudflare --dns-cloudflare-credentials /root/.cloudflare.ini \
      --dns-cloudflare-propagation-seconds 25 --key-type ecdsa -d "$d" && { log "cert OK: $d"; break; }
    log "cert attempt $attempt failed for $d"; sleep 60
  done
done
if [ -f /etc/letsencrypt/live/proshopivr.xyz/fullchain.pem ] && [ -f /etc/letsencrypt/live/panel.proshophost.xyz/fullchain.pem ]; then
  ln -sf /etc/nginx/sites-available/proshop /etc/nginx/sites-enabled/proshop
  if nginx -t; then systemctl reload nginx && log "nginx site proshop ENABLED + reloaded"
  else rm -f /etc/nginx/sites-enabled/proshop; log "nginx -t FAILED → site link removed"; fi
else
  log "certs missing → site NOT enabled"
fi
log "DONE"
