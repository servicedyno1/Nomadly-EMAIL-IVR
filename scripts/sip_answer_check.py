import socket, hashlib, re, sys, random, string, os, time, urllib.request
# usage: sip_answer_check.py domain user ; env SIPPW, WAIT (s to wait for a call), HOLD (s to stay answered)
# Registers like a softphone (UDP), answers the first incoming call, holds, hangs up, then unregisters.
domain, user = sys.argv[1], sys.argv[2]
pw = os.environ['SIPPW']; WAIT = float(os.environ.get('WAIT', '60')); HOLD = float(os.environ.get('HOLD', '5'))
addr = (socket.gethostbyname(domain), 5060)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('', 0)); s.settimeout(1)
lport = s.getsockname()[1]
lip = urllib.request.urlopen('https://api.ipify.org', timeout=5).read().decode()
rnd = lambda k: ''.join(random.choices(string.ascii_lowercase + string.digits, k=k))
callid, tag = rnd(16), rnd(8)

def recv(until):
    while time.time() < until:
        try: return s.recvfrom(8192)[0].decode(errors='ignore')
        except socket.timeout: pass
    return ''

def register(cseq, expires, auth=''):
    ruri = f'sip:{domain}'
    lines = [f'REGISTER {ruri} SIP/2.0', f'Via: SIP/2.0/UDP {lip}:{lport};branch=z9hG4bK{rnd(10)};rport', 'Max-Forwards: 70',
             f'From: <sip:{user}@{domain}>;tag={tag}', f'To: <sip:{user}@{domain}>', f'Call-ID: {callid}', f'CSeq: {cseq} REGISTER',
             f'Contact: <sip:{user}@{lip}:{lport}>', f'Expires: {expires}', 'User-Agent: answer-check']
    if auth: lines.append(auth)
    lines += ['Content-Length: 0', '', '']
    s.sendto('\r\n'.join(lines).encode(), addr)
    r = recv(time.time() + 6)
    m = re.search(r'WWW-Authenticate:\s*Digest\s+(.*)', r, re.I)
    if not m: return r.split('\r\n')[0]
    ch = dict(re.findall(r'(\w+)="?([^",]+)"?', m.group(1)))
    ha1 = hashlib.md5(f"{user}:{ch['realm']}:{pw}".encode()).hexdigest(); ha2 = hashlib.md5(f'REGISTER:{ruri}'.encode()).hexdigest()
    resp = hashlib.md5(f"{ha1}:{ch['nonce']}:{ha2}".encode()).hexdigest()
    return register(cseq + 1, expires, f'Authorization: Digest username="{user}", realm="{ch["realm"]}", nonce="{ch["nonce"]}", uri="{ruri}", response="{resp}", algorithm=MD5') if not auth else r.split('\r\n')[0]

print('register:', register(1, 120)); sys.stdout.flush()
end = time.time() + WAIT
while time.time() < end:
    r = recv(end)
    if not r.startswith('INVITE '): continue
    hd = lambda h: (re.search(rf'^{h}:\s*(.*)$', r, re.M | re.I) or [None, ''])[1].strip()
    via = [v.strip() for v in re.findall(r'^Via:.*$', r, re.M | re.I)]
    rrs = [v.strip() for v in re.findall(r'^Record-Route:.*$', r, re.M | re.I)]
    frm, to, cid, cseq = hd('From'), hd('To'), hd('Call-ID'), hd('CSeq')
    print('INVITE received, From:', frm.split(';')[0], 'To:', to.split(';')[0]); sys.stdout.flush()
    mytag = rnd(8)
    def reply(code, text, body=''):
        lines = [f'SIP/2.0 {code} {text}', *via, *rrs, f'From: {frm}', f'To: {to};tag={mytag}', f'Call-ID: {cid}', f'CSeq: {cseq}', f'Contact: <sip:{user}@{lip}:{lport}>']
        if body: lines.append('Content-Type: application/sdp')
        lines += [f'Content-Length: {len(body)}', '', body]
        s.sendto('\r\n'.join(lines).encode(), addr)
    reply(180, 'Ringing'); time.sleep(2)
    sdp = f'v=0\r\no=- 1 1 IN IP4 {lip}\r\ns=-\r\nc=IN IP4 {lip}\r\nt=0 0\r\nm=audio {lport + 2} RTP/AVP 0 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:101 telephone-event/8000\r\na=sendrecv\r\n'
    reply(200, 'OK', sdp); print('answered'); sys.stdout.flush()
    t_end = time.time() + HOLD
    while time.time() < t_end:
        x = recv(t_end)
        if x.startswith('ACK '): print('ACK received (call connected)')
        if x.startswith('BYE '): print('caller hung up'); break
    # hang up from our side
    rr = rrs[0] if rrs else None
    ctc = re.search(r'^Contact:\s*<([^>]+)>', r, re.M | re.I)
    target = ctc.group(1) if ctc else f'sip:{domain}'
    lines = [f'BYE {target} SIP/2.0', f'Via: SIP/2.0/UDP {lip}:{lport};branch=z9hG4bK{rnd(10)};rport', 'Max-Forwards: 70',
             f'From: {to};tag={mytag}', f'To: {frm}', f'Call-ID: {cid}', 'CSeq: 1 BYE']
    if rr: lines.append('Route: ' + rr.split(':', 1)[1].strip())
    lines += ['Content-Length: 0', '', '']
    s.sendto('\r\n'.join(lines).encode(), addr); print('BYE sent:', recv(time.time() + 4).split('\r\n')[0])
    break
else:
    print('no call arrived')
print('unregister:', register(10, 0))
