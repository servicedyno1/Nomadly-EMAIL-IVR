#!/usr/bin/env python3
"""SIP sign-in watchdog (runs every minute from sip-watchdog.timer on the SIP server).
Asks Kamailio to answer a sign-in on UDP, TCP, TLS and the browser-phone port. Two failed rounds in a row ->
restart Kamailio (waits up to 2 min for calls to end, at most once per 10 min) and tell the owner on Telegram.
Also reports crashes/restarts it did not make and a softphone certificate that is about to expire.
Config: /etc/sip-watchdog.env (TG_TOKEN, TG_CHAT, SIP_IP, SIP_HOST)."""
import json, os, socket, ssl, subprocess, time, urllib.parse, urllib.request

ENV = dict(l.strip().split('=', 1) for l in open('/etc/sip-watchdog.env') if '=' in l and not l.startswith('#'))
IP, HOST = ENV['SIP_IP'], ENV.get('SIP_HOST', 'sip.cloudivr.net')
STATE = '/var/lib/sip-watchdog/state.json'
COOLDOWN, WAIT_CALLS, CERT_DAYS = 600, 120, 14


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30).stdout.strip()


def tell(text):
    try:
        data = urllib.parse.urlencode({'chat_id': ENV['TG_CHAT'], 'text': text}).encode()
        urllib.request.urlopen(f"https://api.telegram.org/bot{ENV['TG_TOKEN']}/sendMessage", data, timeout=10)
    except Exception as e:
        print('telegram failed:', type(e).__name__)


def register(tr):
    m = (f"REGISTER sip:{HOST} SIP/2.0\r\nVia: SIP/2.0/{tr} {IP}:5099;branch=z9hG4bK{time.time_ns()};rport\r\nMax-Forwards: 70\r\n"
         f"From: <sip:watchdog@{HOST}>;tag=w1\r\nTo: <sip:watchdog@{HOST}>\r\nCall-ID: w{time.time_ns()}@wd\r\nCSeq: 1 REGISTER\r\n"
         f"Contact: <sip:watchdog@{IP}:5099>\r\nExpires: 0\r\nUser-Agent: cloudivr-selftest watchdog\r\nContent-Length: 0\r\n\r\n").encode()
    if tr == 'UDP':
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(4); s.sendto(m, (IP, 5060))
    else:
        s = socket.create_connection((IP, 5061 if tr == 'TLS' else 5060), 4)
        if tr == 'TLS':
            s = ssl.create_default_context().wrap_socket(s, server_hostname=HOST)
        s.settimeout(4); s.sendall(m)
    try:
        return s.recv(2048).startswith(b'SIP/2.0 ')
    finally:
        s.close()


def wss():
    s = ssl.create_default_context().wrap_socket(socket.create_connection((IP, 8443), 4), server_hostname=HOST)
    try:
        s.settimeout(4); s.sendall(f"GET / HTTP/1.1\r\nHost: {HOST}\r\n\r\n".encode())
        return s.recv(256).startswith(b'HTTP/1.1 ')
    finally:
        s.close()


def cert_days():
    s = ssl.create_default_context().wrap_socket(socket.create_connection((IP, 5061), 4), server_hostname=HOST)
    try:
        return int((ssl.cert_time_to_seconds(s.getpeercert()['notAfter']) - time.time()) / 86400)
    finally:
        s.close()


def probe():
    bad = []
    for name, fn in [('UDP 5060', lambda: register('UDP')), ('TCP 5060', lambda: register('TCP')), ('TLS 5061', lambda: register('TLS')), ('browser phone 8443', wss)]:
        ok = False
        for _ in range(2):
            try:
                ok = fn()
            except Exception:
                ok = False
            if ok:
                break
            time.sleep(1)
        if not ok:
            bad.append(name)
    return bad


def calls():
    out = sh('asterisk -rx "core show channels count" 2>/dev/null | grep -o "^[0-9]* active call"')
    return int(out.split()[0]) if out else 0


def main():
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    now = time.time()
    started = sh('systemctl show kamailio -p ActiveEnterTimestampMonotonic --value')
    if st.get('started') and started != st['started'] and now - st.get('restart_at', 0) > 180:
        tell('⚠️ CloudIVR SIP: the phone service restarted on its own (crash or manual restart). Softphones sign back in by themselves within a few minutes. I am checking that sign-ins are answered.')
    st['started'] = started

    bad = probe()
    if bad:
        st['fails'] = st.get('fails', 0) + 1
        print('no answer on', bad, 'round', st['fails'])
        if st['fails'] >= 2 and now - st.get('restart_at', 0) > COOLDOWN:
            t0 = time.time()
            while calls() > 0 and time.time() - t0 < WAIT_CALLS:
                time.sleep(10)
            live = calls()
            sh('systemctl restart kamailio'); time.sleep(5)
            st['restart_at'] = time.time(); st['started'] = sh('systemctl show kamailio -p ActiveEnterTimestampMonotonic --value')
            after = probe()
            tell(f"🚨 CloudIVR SIP: sign-ins were not answered on {', '.join(bad)} for 2 minutes, so I restarted the phone service"
                 f"{f' ({live} call(s) were still live)' if live else ' (no calls were live)'}.\n"
                 + ('✅ Sign-ins are answered again. Softphones sign back in by themselves.' if not after else f"❌ Still no answer on {', '.join(after)} — this needs a person to look."))
            st['fails'] = 0 if not after else st['fails']
            st['alerted'] = bool(after)
        elif st['fails'] >= 2 and now - st.get('still_at', 0) > COOLDOWN:
            st['still_at'] = now; st['alerted'] = True
            tell(f"❌ CloudIVR SIP: still no answer on {', '.join(bad)} after a restart. Not restarting again for 10 minutes — this needs a person to look.")
    else:
        if st.get('alerted'):
            tell('✅ CloudIVR SIP: sign-ins are answered again on every port.')
        st['fails'] = 0; st['alerted'] = False
        try:
            d = cert_days()
            if d <= CERT_DAYS and now - st.get('cert_at', 0) > 86400:
                st['cert_at'] = now
                tell(f'⚠️ CloudIVR SIP: the softphone security certificate expires in {d} day(s) and has not renewed itself. Encrypted sign-ins (TLS and browser phone) stop when it expires.')
        except Exception as e:
            print('cert check failed:', type(e).__name__)
    json.dump(st, open(STATE, 'w'))


if __name__ == '__main__':
    main()
