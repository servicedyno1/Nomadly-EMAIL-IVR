import socket, hashlib, re, sys, random, string, time

domain, user, pw = sys.argv[1], sys.argv[2], sys.argv[3]
host = domain
port = 5060
addr = (socket.gethostbyname(host), port)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(('', 0)); s.settimeout(8)
lip, lport = s.getsockname()[0], s.getsockname()[1]
try:
    import urllib.request
    lip = urllib.request.urlopen('https://api.ipify.org', timeout=5).read().decode()
except Exception:
    pass
callid = ''.join(random.choices(string.ascii_lowercase+string.digits, k=16))
branch = 'z9hG4bK' + ''.join(random.choices(string.ascii_lowercase+string.digits, k=12))
tag = ''.join(random.choices(string.ascii_lowercase+string.digits, k=8))

def register(cseq, auth=None):
    lines = [
        f'REGISTER sip:{domain} SIP/2.0',
        f'Via: SIP/2.0/UDP {lip}:{lport};branch={branch}{cseq};rport',
        f'Max-Forwards: 70',
        f'From: <sip:{user}@{domain}>;tag={tag}',
        f'To: <sip:{user}@{domain}>',
        f'Call-ID: {callid}',
        f'CSeq: {cseq} REGISTER',
        f'Contact: <sip:{user}@{lip}:{lport}>',
        f'Expires: 60',
        'User-Agent: preflight-check',
    ]
    if auth:
        lines.append(auth)
    lines += ['Content-Length: 0', '', '']
    s.sendto(('\r\n'.join(lines)).encode(), addr)
    return s.recvfrom(4096)[0].decode(errors='ignore')

r1 = register(1)
code = r1.split('\r\n')[0]
print('1st:', code)
m = re.search(r'(WWW-Authenticate|Proxy-Authenticate):\s*Digest\s+(.*)', r1, re.I)
if not m:
    print('no auth challenge -> result depends on first line above'); sys.exit(0)
ch = dict(re.findall(r'(\w+)="?([^",]+)"?', m.group(2)))
realm, nonce = ch.get('realm', domain), ch.get('nonce', '')
ha1 = hashlib.md5(f'{user}:{realm}:{pw}'.encode()).hexdigest()
ha2 = hashlib.md5(f'REGISTER:sip:{domain}'.encode()).hexdigest()
resp = hashlib.md5(f'{ha1}:{nonce}:{ha2}'.encode()).hexdigest()
auth = (f'{m.group(1).replace("WWW-Authenticate","Authorization").replace("Proxy-Authenticate","Proxy-Authorization")}: '
        f'Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="sip:{domain}", response="{resp}", algorithm=MD5')
r2 = register(2, auth)
print('2nd:', r2.split('\r\n')[0])
