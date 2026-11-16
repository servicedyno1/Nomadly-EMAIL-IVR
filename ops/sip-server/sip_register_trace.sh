#!/bin/sh
# Passive trace of softphone sign-in attempts on the SIP server (who tried, from where, with which login/app).
# Captures only REGISTER requests on 5060 and new TLS connections on 5061; no call audio, no passwords.
#   sip_register_trace.sh start   — run for 24h (hourly files, auto-stops)
#   sip_register_trace.sh show [login-or-ip]
#   sip_register_trace.sh stop
DIR=/var/tmp/sipcap
IP=$(ip -o -4 addr show eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)
case "$1" in
  start)
    mkdir -p "$DIR" && chmod 700 "$DIR"
    pkill -f "tcpdump -i eth0 -nn -s 0 -U -G 3600" 2>/dev/null; sleep 1
    F="dst host $IP and ((udp dst port 5060 and udp[8:4] = 0x52454749) or (tcp dst port 5060 and tcp[((tcp[12:1] & 0xf0) >> 2):4] = 0x52454749) or (tcp dst port 5061 and tcp[tcpflags] & (tcp-syn|tcp-ack) = tcp-syn))"
    nohup timeout 24h tcpdump -i eth0 -nn -s 0 -U -G 3600 -W 24 -w "$DIR/reg-%Y%m%d-%H.pcap" "$F" >"$DIR/tcpdump.log" 2>&1 &
    sleep 2; pgrep -f "tcpdump -i eth0 -nn -s 0 -U -G 3600" >/dev/null && echo "trace running (24h)" || { echo "trace failed"; cat "$DIR/tcpdump.log"; }
    ;;
  show)
    for f in "$DIR"/*.pcap; do
      [ -f "$f" ] || continue
      tcpdump -nn -A -r "$f" 2>/dev/null | awk '
        function flush() { if (t != "") print d, t, src, u, ua, (auth ? "with-password" : "first-try") }
        /^[0-9:.]+ IP/ { flush(); t=$1; src=$3; u="-"; ua="-"; auth=0; if ($0 ~ /\.5061: Flags/) u="(TLS-connection)" }
        /^From:/ { if (match($0, /sip:[^>;]+/)) u=substr($0, RSTART+4, RLENGTH-4) }
        /^User-Agent:/ { ua=substr($0, 13, 40); gsub(/\r/, "", ua); gsub(/ /, "_", ua) }
        /^Authorization:/ { auth=1 }
        END { flush() }' d="$(basename "$f" .pcap | cut -c5-)"
    done | { if [ -n "$2" ]; then grep -i -- "$2"; else cat; fi; }
    ;;
  stop)
    pkill -f "tcpdump -i eth0 -nn -s 0 -U -G 3600" && echo stopped || echo "not running"
    ;;
  *) echo "usage: $0 start|show [filter]|stop"; exit 1 ;;
esac
