#!/usr/bin/env python3
# Tiny SIP probe (UDP, no audio) for checking a SIP login against Telnyx — run where UDP replies can reach it (droplet).
#   python3 sip_probe.py register USER PASS [--domain sip.telnyx.com] [--listen 60]   → REGISTER, wait for INVITEs, unregister
#   python3 sip_probe.py call USER PASS +14155550100 [--domain …] [--ring 8]           → outbound INVITE, CANCEL after --ring s
# Prints one line per SIP event; exit 0 = registered (register) / call reached the network (call).
import hashlib, random, re, socket, sys, time, uuid

def opt(name, default):
    a = sys.argv
    return a[a.index(name) + 1] if name in a else default

MODE, USER, PASS = sys.argv[1], sys.argv[2], sys.argv[3]
DOMAIN = opt('--domain', 'sip.telnyx.com')
REG_HOST = socket.gethostbyname(DOMAIN)
SRV = (REG_HOST, 5060)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', 0))
sock.connect(SRV)
LIP, LPORT = sock.getsockname()
PUBLIC = opt('--ip', LIP)
sock.settimeout(1.0)
md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
rnd = lambda n=10: ''.join(random.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(n))
log = lambda *a: print(time.strftime('%H:%M:%S'), *a, flush=True)

def send(msg):
    sock.send(msg.encode())

def recv(timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            data = sock.recv(65535).decode(errors='replace')
        except socket.timeout:
            continue
        if data.strip():
            return data
    return None

def hdr(msg, name):
    m = re.search(rf'^{name}:\s*(.+)$', msg, re.I | re.M)
    return m.group(1).strip() if m else ''

def status(msg):
    m = re.match(r'SIP/2.0 (\d{3}) (.*)', msg)
    return (int(m.group(1)), m.group(2).strip()) if m else (0, msg.split('\r\n', 1)[0])

def digest(chal, method, uri):
    p = dict(re.findall(r'(\w+)="?([^",]+)"?', chal))
    ha1, ha2 = md5(f'{USER}:{p["realm"]}:{PASS}'), md5(f'{method}:{uri}')
    if 'auth' in p.get('qop', ''):
        cn, nc = rnd(8), '00000001'
        resp = md5(f'{ha1}:{p["nonce"]}:{nc}:{cn}:auth:{ha2}')
        return f'Digest username="{USER}", realm="{p["realm"]}", nonce="{p["nonce"]}", uri="{uri}", response="{resp}", algorithm=MD5, qop=auth, nc={nc}, cnonce="{cn}"' + (f', opaque="{p["opaque"]}"' if 'opaque' in p else '')
    resp = md5(f'{ha1}:{p["nonce"]}:{ha2}')
    return f'Digest username="{USER}", realm="{p["realm"]}", nonce="{p["nonce"]}", uri="{uri}", response="{resp}", algorithm=MD5' + (f', opaque="{p["opaque"]}"' if 'opaque' in p else '')

CALLID, TAG = f'{uuid.uuid4()}@civr-probe', rnd()

def register(expires, cseq, auth=None):
    uri = f'sip:{DOMAIN}'
    send(f'REGISTER {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {PUBLIC}:{LPORT};branch=z9hG4bK{rnd()};rport\r\nMax-Forwards: 70\r\n'
         f'From: <sip:{USER}@{DOMAIN}>;tag={TAG}\r\nTo: <sip:{USER}@{DOMAIN}>\r\nCall-ID: {CALLID}\r\nCSeq: {cseq} REGISTER\r\n'
         f'Contact: <sip:{USER}@{PUBLIC}:{LPORT}>\r\nExpires: {expires}\r\n' + (f'Authorization: {auth}\r\n' if auth else '') +
         'User-Agent: civr-probe\r\nContent-Length: 0\r\n\r\n')

def do_register(expires, cseq):
    register(expires, cseq)
    r = recv()
    while r and status(r)[0] == 100:
        r = recv()
    if r and status(r)[0] == 401:
        register(expires, cseq + 1, digest(hdr(r, 'WWW-Authenticate'), 'REGISTER', f'sip:{DOMAIN}'))
        r = recv()
        while r and status(r)[0] == 100:
            r = recv()
    return status(r) if r else (0, 'no reply')

def reply(req, code, text, to_tag=None):
    via = re.findall(r'^Via:.*$', req, re.I | re.M)
    to = hdr(req, 'To') + (f';tag={to_tag}' if to_tag and 'tag=' not in hdr(req, 'To') else '')
    send(f'SIP/2.0 {code} {text}\r\n' + '\r\n'.join(via) + f'\r\nFrom: {hdr(req, "From")}\r\nTo: {to}\r\nCall-ID: {hdr(req, "Call-ID")}\r\nCSeq: {hdr(req, "CSeq")}\r\nContent-Length: 0\r\n\r\n')

def listen(secs):
    end, got = time.time() + secs, 0
    while time.time() < end:
        m = recv(1.0)
        if not m:
            continue
        first = m.split('\r\n', 1)[0]
        if first.startswith('INVITE'):
            got += 1
            log('INVITE received', 'from', hdr(m, 'From')[:80], '| to', first.split(' ')[1][:60])
            tag = rnd()
            reply(m, 180, 'Ringing', tag)
            time.sleep(2)
            reply(m, 486, 'Busy Here', tag)
            log('replied 180 then 486')
        elif first.startswith('OPTIONS') or first.startswith('NOTIFY'):
            reply(m, 200, 'OK')
        elif first.startswith(('ACK', 'CANCEL', 'BYE')):
            if not first.startswith('ACK'):
                reply(m, 200, 'OK')
            log(first.split(' ')[0], 'received')
    return got

def invite(dest, cseq, auth=None, branch=None):
    uri = f'sip:{dest}@{DOMAIN}'
    sdp = f'v=0\r\no=- 0 0 IN IP4 {PUBLIC}\r\ns=-\r\nc=IN IP4 {PUBLIC}\r\nt=0 0\r\nm=audio 40000 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n'
    send(f'INVITE {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {PUBLIC}:{LPORT};branch={branch};rport\r\nMax-Forwards: 70\r\n'
         f'From: <sip:{USER}@{DOMAIN}>;tag={TAG}\r\nTo: <{uri}>\r\nCall-ID: {CALLID}\r\nCSeq: {cseq} INVITE\r\nContact: <sip:{USER}@{PUBLIC}:{LPORT}>\r\n'
         + (f'Proxy-Authorization: {auth}\r\n' if auth else '') + f'Content-Type: application/sdp\r\nContent-Length: {len(sdp)}\r\n\r\n{sdp}')
    return uri

def ack(uri, cseq, branch, to):
    send(f'ACK {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {PUBLIC}:{LPORT};branch={branch};rport\r\nMax-Forwards: 70\r\nFrom: <sip:{USER}@{DOMAIN}>;tag={TAG}\r\nTo: {to}\r\nCall-ID: {CALLID}\r\nCSeq: {cseq} ACK\r\nContent-Length: 0\r\n\r\n')

def cancel(uri, cseq, branch):
    send(f'CANCEL {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {PUBLIC}:{LPORT};branch={branch};rport\r\nMax-Forwards: 70\r\nFrom: <sip:{USER}@{DOMAIN}>;tag={TAG}\r\nTo: <{uri}>\r\nCall-ID: {CALLID}\r\nCSeq: {cseq} CANCEL\r\nContent-Length: 0\r\n\r\n')

def bye(uri, cseq, to):
    send(f'BYE {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {PUBLIC}:{LPORT};branch=z9hG4bK{rnd()};rport\r\nMax-Forwards: 70\r\nFrom: <sip:{USER}@{DOMAIN}>;tag={TAG}\r\nTo: {to}\r\nCall-ID: {CALLID}\r\nCSeq: {cseq} BYE\r\nContent-Length: 0\r\n\r\n')

if MODE == 'register':
    code, text = do_register(120, 1)
    log('REGISTER', DOMAIN, '→', code, text)
    if code != 200:
        sys.exit(1)
    n = listen(int(opt('--listen', '0')))
    log('INVITEs received:', n)
    log('UNREGISTER →', *do_register(0, 10))
    sys.exit(0)

if MODE == 'call':
    dest, ring = sys.argv[4], int(opt('--ring', '8'))
    b1 = f'z9hG4bK{rnd()}'
    uri = invite(dest, 1, branch=b1)
    r = recv()
    while r and status(r)[0] == 100:
        r = recv()
    if r and status(r)[0] in (401, 407):
        ack(uri, 1, b1, hdr(r, 'To'))
        b2 = f'z9hG4bK{rnd()}'
        invite(dest, 2, digest(hdr(r, 'Proxy-Authenticate') or hdr(r, 'WWW-Authenticate'), 'INVITE', uri), b2)
        log('INVITE auth challenge answered')
        end, reached, answered_to = time.time() + ring, False, None
        while time.time() < end:
            m = recv(1.0)
            if not m:
                continue
            code, text = status(m)
            if code:
                log('INVITE →', code, text)
            if code in (100, 180, 183):
                reached = True
            elif code == 200:
                reached, answered_to = True, hdr(m, 'To')
                ack(uri, 2, f'z9hG4bK{rnd()}', answered_to)
                break
            elif code >= 300:
                ack(uri, 2, b2, hdr(m, 'To'))
                break
        if answered_to:
            bye(uri, 3, answered_to)
            log('BYE sent')
        elif reached:
            cancel(uri, 2, b2)
            log('CANCEL sent')
            for _ in range(4):
                m = recv(1.0)
                if m and status(m)[0] >= 300:
                    ack(uri, 2, b2, hdr(m, 'To'))
        sys.exit(0 if reached else 1)
    log('INVITE first reply:', status(r) if r else 'none')
    sys.exit(1)
