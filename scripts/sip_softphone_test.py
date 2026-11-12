#!/usr/bin/env python3
# Minimal softphone for testing the brand SIP server: REGISTER (digest), answer one incoming INVITE, place one outgoing INVITE.
# Usage: python3 scripts/sip_softphone_test.py <user> <password> <domain> <server_ip> <dial_number> [wait_secs]
import socket, uuid, hashlib, re, sys, time, random

user, pw, domain, server, dial = sys.argv[1:6]
wait = int(sys.argv[6]) if len(sys.argv) > 6 else 40
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('0.0.0.0', 0)); s.settimeout(1)
lport = s.getsockname()[1]
lip = socket.gethostbyname(socket.gethostname())
rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); rtp.bind(('0.0.0.0', 0)); rport = rtp.getsockname()[1]
md5 = lambda x: hashlib.md5(x.encode()).hexdigest()
log = lambda *a: print(time.strftime('%H:%M:%S'), *a, flush=True)

def send(m): s.sendto(m.encode(), (server, 5060))
def via(): return f"Via: SIP/2.0/UDP {lip}:{lport};branch=z9hG4bK{uuid.uuid4().hex[:12]};rport"
def auth(hdr, method, uri):
    realm = re.search(r'realm="([^"]+)"', hdr).group(1); nonce = re.search(r'nonce="([^"]+)"', hdr).group(1)
    resp = md5(f"{md5(f'{user}:{realm}:{pw}')}:{nonce}:{md5(f'{method}:{uri}')}")
    return f'Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="{uri}", response="{resp}", algorithm=MD5'
def recv(t=5):
    end = time.time() + t
    while time.time() < end:
        try: d, a = s.recvfrom(65535); return d.decode(errors='ignore')
        except socket.timeout: pass
    return None
def hdr(m, name):
    r = re.search(rf'^{name}:\s*(.*)$', m, re.M | re.I); return r.group(1).strip() if r else ''
sdp = lambda: f"v=0\r\no=- 1 1 IN IP4 {lip}\r\ns=-\r\nc=IN IP4 {lip}\r\nt=0 0\r\nm=audio {rport} RTP/AVP 0 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:101 telephone-event/8000\r\na=sendrecv\r\n"

# REGISTER
cid = uuid.uuid4().hex; tag = uuid.uuid4().hex[:8]; ruri = f"sip:{domain}"
def reg(cseq, a=''):
    send(f"REGISTER {ruri} SIP/2.0\r\n{via()}\r\nMax-Forwards: 70\r\nFrom: <sip:{user}@{domain}>;tag={tag}\r\nTo: <sip:{user}@{domain}>\r\nCall-ID: {cid}\r\nCSeq: {cseq} REGISTER\r\nContact: <sip:{user}@{lip}:{lport}>\r\nExpires: 300\r\n{a}Content-Length: 0\r\n\r\n")
reg(1); r = recv()
if r and r.startswith('SIP/2.0 401'):
    reg(2, f"Authorization: {auth(hdr(r, 'WWW-Authenticate'), 'REGISTER', ruri)}\r\n"); r = recv()
log('REGISTER →', r.split('\r\n')[0] if r else 'no reply')
if not r or not r.startswith('SIP/2.0 200'): sys.exit(1)

def answer(m):
    h = {k: hdr(m, k) for k in ['Via', 'From', 'To', 'Call-ID', 'CSeq', 'Record-Route']}
    vias = '\r\n'.join(f"Via: {v}" for v in re.findall(r'^Via:\s*(.*)$', m, re.M | re.I))
    rr = '\r\n'.join(f"Record-Route: {v}" for v in re.findall(r'^Record-Route:\s*(.*)$', m, re.M | re.I))
    to = h['To'] + (';tag=' + uuid.uuid4().hex[:8] if 'tag=' not in h['To'] else '')
    body = sdp()
    for code in ['180 Ringing', '200 OK']:
        b = body if code.startswith('200') else ''
        send(f"SIP/2.0 {code}\r\n{vias}\r\n{rr + chr(13) + chr(10) if rr else ''}From: {h['From']}\r\nTo: {to}\r\nCall-ID: {h['Call-ID']}\r\nCSeq: {h['CSeq']}\r\nContact: <sip:{user}@{lip}:{lport}>\r\n" + (f"Content-Type: application/sdp\r\n" if b else '') + f"Content-Length: {len(b)}\r\n\r\n{b}")
    log('answered incoming call from', h['From'][:60])

def ok_reply(m):
    vias = '\r\n'.join(f"Via: {v}" for v in re.findall(r'^Via:\s*(.*)$', m, re.M | re.I))
    send(f"SIP/2.0 200 OK\r\n{vias}\r\nFrom: {hdr(m,'From')}\r\nTo: {hdr(m,'To')}\r\nCall-ID: {hdr(m,'Call-ID')}\r\nCSeq: {hdr(m,'CSeq')}\r\nContent-Length: 0\r\n\r\n")

# Outgoing call
icid = uuid.uuid4().hex; itag = uuid.uuid4().hex[:8]; iuri = f"sip:{dial}@{domain}"
def invite(cseq, a=''):
    b = sdp()
    send(f"INVITE {iuri} SIP/2.0\r\n{via()}\r\nMax-Forwards: 70\r\nFrom: <sip:{user}@{domain}>;tag={itag}\r\nTo: <sip:{dial}@{domain}>\r\nCall-ID: {icid}\r\nCSeq: {cseq} INVITE\r\nContact: <sip:{user}@{lip}:{lport}>\r\n{a}Content-Type: application/sdp\r\nContent-Length: {len(b)}\r\n\r\n{b}")
def ack(m, cseq):
    send(f"ACK {iuri} SIP/2.0\r\n{via()}\r\nMax-Forwards: 70\r\nFrom: <sip:{user}@{domain}>;tag={itag}\r\nTo: {hdr(m,'To')}\r\nCall-ID: {icid}\r\nCSeq: {cseq} ACK\r\nContent-Length: 0\r\n\r\n")
if dial != '-':
    invite(1)
cseq = 1; end = time.time() + wait; got_in = False; out_state = 'sent' if dial != '-' else 'skip'
while time.time() < end:
    m = recv(1)
    if not m: continue
    first = m.split('\r\n')[0]
    if first.startswith('INVITE '): log('INCOMING', first); got_in = True; answer(m); continue
    if first.startswith('BYE '): log('BYE received'); ok_reply(m); continue
    if first.startswith(('OPTIONS ', 'NOTIFY ')): ok_reply(m); continue
    if first.startswith('SIP/2.0') and icid in m:
        code = first.split()[1]
        if code == '407':
            ack(m, cseq); cseq += 1; invite(cseq, f"Proxy-Authorization: {auth(hdr(m, 'Proxy-Authenticate'), 'INVITE', iuri)}\r\n"); continue
        log('OUTGOING →', first)
        if code.startswith('2'): ack(m, cseq); out_state = 'answered'
        elif int(code) >= 300: ack(m, cseq); out_state = 'failed ' + code
log('RESULT incoming=%s outgoing=%s' % (got_in, out_state))
