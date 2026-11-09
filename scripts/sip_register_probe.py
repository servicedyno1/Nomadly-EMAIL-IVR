#!/usr/bin/env python3
# One-shot SIP REGISTER probe with digest auth. Usage: sip_register_probe.py user pass domain [udp|tcp] [host]
import hashlib, random, re, socket, sys

user, pw, dom = sys.argv[1:4]
proto = sys.argv[4] if len(sys.argv) > 4 else 'udp'
host = sys.argv[5] if len(sys.argv) > 5 else dom
md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
tag, cid, br = '%x' % random.getrandbits(32), '%x@probe' % random.getrandbits(48), 'z9hG4bK%x' % random.getrandbits(40)

if proto == 'udp':
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect((host, int(sys.argv[6]) if len(sys.argv) > 6 else 5060))
else:
    s = socket.create_connection((host, int(sys.argv[6]) if len(sys.argv) > 6 else 5060), timeout=8)
s.settimeout(8)
lip, lport = s.getsockname()
T = proto.upper()

def req(cseq, auth=''):
    b = '%s%x' % (br, cseq)
    m = (f'REGISTER sip:{dom} SIP/2.0\r\nVia: SIP/2.0/{T} {lip}:{lport};branch={b};rport\r\nMax-Forwards: 70\r\n'
         f'From: <sip:{user}@{dom}>;tag={tag}\r\nTo: <sip:{user}@{dom}>\r\nCall-ID: {cid}\r\nCSeq: {cseq} REGISTER\r\n'
         f'Contact: <sip:{user}@{lip}:{lport};transport={proto}>\r\nExpires: 0\r\nUser-Agent: probe\r\n{auth}Content-Length: 0\r\n\r\n')
    s.send(m.encode())
    while True:
        try:
            r = s.recv(65535).decode(errors='replace')
        except socket.timeout:
            return None
        if f'CSeq: {cseq} ' in r and not r.startswith('SIP/2.0 100'):
            return r

r = req(1)
if not r:
    print(proto, 'NO RESPONSE (timeout) from', host); sys.exit(2)
print(proto, 'resp1:', r.split('\r\n')[0])
if ' 401 ' in r.split('\r\n')[0] or ' 407 ' in r.split('\r\n')[0]:
    h = re.search(r'(?:WWW|Proxy)-Authenticate: Digest (.*)', r, re.I).group(1)
    realm = re.search(r'realm="([^"]+)"', h).group(1); nonce = re.search(r'nonce="([^"]+)"', h).group(1)
    uri = f'sip:{dom}'
    resp = md5(f'{md5(f"{user}:{realm}:{pw}")}:{nonce}:{md5(f"REGISTER:{uri}")}')
    hdr = 'Authorization' if ' 401 ' in r else 'Proxy-Authorization'
    a = f'{hdr}: Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="{uri}", response="{resp}", algorithm=MD5' + (', opaque="%s"' % o.group(1) if (o := re.search(r'opaque="([^"]*)"', h)) else '') + '\r\n'
    r2 = req(2, a)
    print(proto, 'resp2:', r2.split('\r\n')[0] if r2 else 'NO RESPONSE')
