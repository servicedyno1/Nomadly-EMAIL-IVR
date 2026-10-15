#!/bin/bash
# Read-only audit v2: cPanel accounts with no GENUINE activity for >= 21 days.
# Genuine activity = most recent of:
#   (a) cPanel owner login  (~/.lastlogin mtime)
#   (b) newest NON-SYSTEM file in public_html  (customer uploads + live runtime capture logs)
# System files excluded (auto-touched by anti-red enforcer / SSL renewals):
#   .htaccess, .user.ini, .antired-challenge.php, anything under .well-known/
# HTTP domlog mtime is reported for reference only (contaminated by bot/scanner traffic).
NOW=$(date +%s)
THRESH=$((21*86400))
DOMLOGS=/etc/apache2/logs/domlogs

printf "%s\n" "USER|PRIMARY_DOMAIN|PLAN|CREATED|AGE_D|LAST_LOGIN|LAST_USER_FILE|LAST_ACTIVITY|IDLE_D|HTTP(ref)|HOME_MB|STATUS"

for U in $(ls /var/cpanel/users 2>/dev/null); do
  UF=/var/cpanel/users/$U
  primary=$(grep -m1 '^DNS=' "$UF" | cut -d= -f2)
  plan=$(grep -m1 '^PLAN=' "$UF" | cut -d= -f2)
  start=$(grep -m1 '^STARTDATE=' "$UF" | cut -d= -f2); start=${start:-0}
  susp=$(grep -m1 '^SUSPENDED=' "$UF" | cut -d= -f2)
  home=$(getent passwd "$U" | cut -d: -f6); home=${home:-/home/$U}
  domains=$(grep -E '^DNS[0-9]*=' "$UF" | cut -d= -f2)

  # newest NON-SYSTEM file mtime in public_html
  ufile=$(find "$home/public_html" -type f \
            ! -name '.htaccess' ! -name '.user.ini' ! -name '.antired-challenge.php' \
            ! -path '*/.well-known/*' \
            -printf '%T@\n' 2>/dev/null | cut -d. -f1 | sort -n | tail -1)
  ufile=${ufile:-0}

  # http (reference only)
  hmt=0
  for d in $domains; do for suf in "" "-ssl_log"; do f="$DOMLOGS/$d$suf"; [ -f "$f" ] && { m=$(stat -c %Y "$f" 2>/dev/null); [ "${m:-0}" -gt "$hmt" ] && hmt=$m; }; done; done

  # cPanel login
  lmt=0; [ -f "$home/.lastlogin" ] && lmt=$(stat -c %Y "$home/.lastlogin" 2>/dev/null); lmt=${lmt:-0}

  # genuine last activity = max(ufile, lmt)
  last=$ufile; [ "$lmt" -gt "$last" ] && last=$lmt
  [ "$last" -eq 0 ] && last=$start

  idle=$(( (NOW - last) / 86400 ))
  age=$(( (NOW - start) / 86400 ))
  home_mb=$(du -sm "$home" 2>/dev/null | cut -f1); home_mb=${home_mb:-0}

  status="active"
  [ "$susp" = "1" ] && status="SUSPENDED"
  if [ "$age" -lt 21 ]; then
    status="too-new(${age}d)"
  elif [ $((NOW-last)) -ge "$THRESH" ]; then
    status="IDLE>=${idle}d"
  fi

  fmtd(){ [ "${1:-0}" -gt 0 ] && date -u -d "@$1" +%Y-%m-%d || echo "never"; }
  printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n" \
    "$U" "${primary:-?}" "${plan:-?}" "$(fmtd $start)" "$age" "$(fmtd $lmt)" "$(fmtd $ufile)" "$(fmtd $last)" "$idle" "$(fmtd $hmt)" "$home_mb" "$status"
done
