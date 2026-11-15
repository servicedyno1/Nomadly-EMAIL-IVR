import socket, hashlib, re, sys, random, string, os, time
# usage: sip_call_check.py domain user dest [host] ; env SIPPW. Places one short call (UDP), hangs up after ~6 s of ringing/answer.
domain, user, dest = sys.argv[1], sys.argv[2], sys.argv[3]
host = sys.argv[4] if len(sys.argv) > 4 else domain
pw = os.environ['SIPPW']
addr = (socket.gethostbyname(host), 5060)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('', 0)); s.settimeout(1)
lport = s.getsockname()[1]
import urllib.request
lip = urllib.request.urlopen('https://api.ipify.org', timeout=5).read().decode()
rnd = lambda k: ''.join(random.choices(string.ascii_lowercase + string.digits, k=k))
callid, tag = rnd(16), rnd(8)
ruri = f'sip:{dest}@{domain}'
sdp = f'v=0\r\no=- 1 1 IN IP4 {lip}\r\ns=-\r\nc=IN IP4 {lip}\r\nt=0 0\r\nm=audio {lport + 2} RTP/AVP 0 8 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000\r\na=sendrecv\r\n'

def send(method, cseq, branch, extra=(), body='', to_tag=''):
    lines = [f'{method} {ruri} SIP/2.0', f'Via: SIP/2.0/UDP {lip}:{lport};branch={branch};rport', 'Max-Forwards: 70',
             f'From: <sip:{user}@{domain}>;tag={tag}', f'To: <{ruri}>' + (f';tag={to_tag}' if to_tag else ''), f'Call-ID: {callid}',
             f'CSeq: {cseq} {method}', f'Contact: <sip:{user}@{lip}:{lport}>', 'User-Agent: call-check', *extra]
    if body: lines.append('Content-Type: application/sdp')
    lines += [f'Content-Length: {len(body)}', '', body]
    s.sendto('\r\n'.join(lines).encode(), addr)

def recv(until):
    while time.time() < until:
        try: return s.recvfrom(8192)[0].decode(errors='ignore')
        except socket.timeout: pass
    return ''

b1 = 'z9hG4bK' + rnd(10)
send('INVITE', 1, b1, body=sdp)
r = ''
while not re.match(r'SIP/2.0 (401|407)', r):
    r = recv(time.time() + 8)
    if not r: print('no challenge'); sys.exit(2)
print('1st:', r.split('\r\n')[0])
tt = re.search(r'^To:.*;tag=([^;\r\n]+)', r, re.M | re.I)
send('ACK', 1, b1, to_tag=tt.group(1) if tt else '')
m = re.search(r'(WWW|Proxy)-Authenticate:\s*Digest\s+(.*)', r, re.I)
ch = dict(re.findall(r'(\w+)="?([^",]+)"?', m.group(2)))
ha1 = hashlib.md5(f"{user}:{ch['realm']}:{pw}".encode()).hexdigest()
ha2 = hashlib.md5(f'INVITE:{ruri}'.encode()).hexdigest()
resp = hashlib.md5(f"{ha1}:{ch['nonce']}:{ha2}".encode()).hexdigest()
hdr = ('Proxy-Authorization' if m.group(1).lower() == 'proxy' else 'Authorization') + f': Digest username="{user}", realm="{ch["realm"]}", nonce="{ch["nonce"]}", uri="{ruri}", response="{resp}", algorithm=MD5'
b2 = 'z9hG4bK' + rnd(10)
send('INVITE', 2, b2, extra=[hdr], body=sdp)
end, ringing_at, final = time.time() + 25, None, None
while time.time() < end:
    r = recv(min(end, time.time() + 1))
    if not r: 
        if ringing_at and time.time() - ringing_at > 6: break
        continue
    first = r.split('\r\n')[0]; print('->', first)
    code = int(first.split()[1]) if first.startswith('SIP/2.0') else 0
    if 180 <= code < 200 and not ringing_at: ringing_at = time.time()
    if code >= 200: final = (code, r); break
if final and final[0] == 200:
    tt = re.search(r'^To:.*;tag=([^;\r\n]+)', final[1], re.M | re.I).group(1)
    send('ACK', 2, 'z9hG4bK' + rnd(10), to_tag=tt); time.sleep(float(os.environ.get('HOLD', '3')))
    send('BYE', 3, 'z9hG4bK' + rnd(10), to_tag=tt); print('answered -> BYE sent:', recv(time.time() + 4).split('\r\n')[0])
elif final:
    tt = re.search(r'^To:.*;tag=([^;\r\n]+)', final[1], re.M | re.I)
    send('ACK', 2, b2, to_tag=tt.group(1) if tt else '')
else:
    send('CANCEL', 2, b2, extra=[hdr]); print('CANCEL sent:', recv(time.time() + 4).split('\r\n')[0])
