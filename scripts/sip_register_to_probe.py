#!/usr/bin/env python3
# REGISTER probe (Expires: 0, nothing saved) with a different To/From user than the auth username, as some softphones send.
# Usage: python3 scripts/sip_register_to_probe.py <user> <password> <domain> <server_ip> [to_user]
import socket, uuid, hashlib, re, sys

user, pw, domain, server = sys.argv[1:5]
import os
EXP = os.environ.get("EXP", "0")
to_user = sys.argv[5] if len(sys.argv) > 5 else user
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('0.0.0.0', 0)); s.settimeout(6)
lport = s.getsockname()[1]
md5 = lambda x: hashlib.md5(x.encode()).hexdigest()
tag, cid, ruri = uuid.uuid4().hex[:8], uuid.uuid4().hex, f"sip:{domain}"

def reg(cseq, a=''):
    s.sendto((f"REGISTER {ruri} SIP/2.0\r\nVia: SIP/2.0/UDP 0.0.0.0:{lport};branch=z9hG4bK{uuid.uuid4().hex[:12]};rport\r\nMax-Forwards: 70\r\n"
              f"From: <sip:{to_user}@{domain}>;tag={tag}\r\nTo: <sip:{to_user}@{domain}>\r\nCall-ID: {cid}\r\nCSeq: {cseq} REGISTER\r\n"
              f"Contact: <sip:{to_user}@0.0.0.0:{lport}>\r\nExpires: {EXP}\r\n{a}Content-Length: 0\r\n\r\n").encode(), (server, 5060))
    return s.recvfrom(65535)[0].decode(errors='ignore')

r = reg(1)
print('1st:', r.split('\r\n')[0])
ch = re.search(r'^WWW-Authenticate:\s*(.*)$', r, re.M | re.I)
if ch:
    h = ch.group(1)
    realm, nonce = re.search(r'realm="([^"]+)"', h).group(1), re.search(r'nonce="([^"]+)"', h).group(1)
    resp = md5(f"{md5(f'{user}:{realm}:{pw}')}:{nonce}:{md5(f'REGISTER:{ruri}')}")
    r = reg(2, f'Authorization: Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="{ruri}", response="{resp}", algorithm=MD5\r\n')
    print('2nd:', r.split('\r\n')[0])
