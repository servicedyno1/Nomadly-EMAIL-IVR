import socket, hashlib, re, sys, random, string, os

# usage: sw_sip_register_check.py domain user pass [host] ; env SIP_TRANSPORT=udp|tcp, SIP_EXPIRES (0 = check only, no binding)
domain, user, pw = sys.argv[1], sys.argv[2], sys.argv[3]
host = sys.argv[4] if len(sys.argv) > 4 else domain
proto = os.environ.get('SIP_TRANSPORT', 'udp').lower()
port = 5061 if proto == 'tls' else 5060
expires = os.environ.get('SIP_EXPIRES', '60')
addr = (socket.gethostbyname(host), port)
if proto in ('tcp', 'tls'):
    s = socket.create_connection(addr, timeout=8)
    if proto == 'tls':
        import ssl
        ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        s = ctx.wrap_socket(s, server_hostname=domain)
else:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('', 0))
s.settimeout(8)
lip, lport = s.getsockname()[0], s.getsockname()[1]
try:
    import urllib.request
    lip = urllib.request.urlopen('https://api.ipify.org', timeout=5).read().decode()
except Exception:
    pass
callid = ''.join(random.choices(string.ascii_lowercase+string.digits, k=16))
branch = 'z9hG4bK' + ''.join(random.choices(string.ascii_lowercase+string.digits, k=12))
tag = ''.join(random.choices(string.ascii_lowercase+string.digits, k=8))

def recv():
    data = b''
    while True:
        chunk = s.recv(4096) if proto in ('tcp', 'tls') else s.recvfrom(4096)[0]
        data += chunk
        if proto not in ('tcp', 'tls') or b'\r\n\r\n' in data:
            txt = data.decode(errors='ignore')
            if txt.startswith('SIP/2.0 100'):
                data = data.split(b'\r\n\r\n', 1)[1] if b'\r\n\r\n' in data else b''
                if not data:
                    continue
                txt = data.decode(errors='ignore')
            return txt

def register(cseq, auth=None):
    lines = [
        f'REGISTER sip:{domain};transport={proto} SIP/2.0',
        f'Via: SIP/2.0/{proto.upper()} {lip}:{lport};branch={branch}{cseq};rport',
        'Max-Forwards: 70',
        f'From: <sip:{user}@{domain}>;tag={tag}',
        f'To: <sip:{user}@{domain}>',
        f'Call-ID: {callid}',
        f'CSeq: {cseq} REGISTER',
        f'Contact: <sip:{user}@{lip}:{lport};transport={proto}>',
        f'Expires: {expires}',
        'User-Agent: preflight-check',
    ]
    if auth:
        lines.append(auth)
    lines += ['Content-Length: 0', '', '']
    msg = ('\r\n'.join(lines)).encode()
    s.sendall(msg) if proto in ('tcp', 'tls') else s.sendto(msg, addr)
    return recv()

r1 = register(1)
print('1st:', r1.split('\r\n')[0])
m = re.search(r'(WWW-Authenticate|Proxy-Authenticate):\s*Digest\s+(.*)', r1, re.I)
if not m:
    print('no auth challenge -> result depends on first line above'); sys.exit(0)
ch = dict(re.findall(r'(\w+)="?([^",]+)"?', m.group(2)))
realm, nonce = ch.get('realm', domain), ch.get('nonce', '')
uri = f'sip:{domain};transport={proto}'
ha1 = hashlib.md5(f'{user}:{realm}:{pw}'.encode()).hexdigest()
ha2 = hashlib.md5(f'REGISTER:{uri}'.encode()).hexdigest()
resp = hashlib.md5(f'{ha1}:{nonce}:{ha2}'.encode()).hexdigest()
auth = (f'{m.group(1).replace("WWW-Authenticate","Authorization").replace("Proxy-Authenticate","Proxy-Authorization")}: '
        f'Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="{uri}", response="{resp}", algorithm=MD5')
r2 = register(2, auth)
print('2nd:', r2.split('\r\n')[0])
