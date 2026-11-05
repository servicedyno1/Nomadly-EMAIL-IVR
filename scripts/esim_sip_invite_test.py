# Synthetic Spenza-style INVITE to the eSIM SIP relay: proves relay -> Telnyx SIP subdomain -> CloudIVR webhook.
import socket, random, re, sys, time
RELAY = ('146.190.238.190', 5060)
did = sys.argv[1] if len(sys.argv) > 1 else '+16462556424'
caller = sys.argv[2] if len(sys.argv) > 2 else '+14155550199'
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3); s.bind(('0.0.0.0', 0))
port = s.getsockname()[1]; tag = str(random.randint(1, 10**9)); cid = f'{tag}@esim-test'
ip = socket.gethostbyname(socket.gethostname())
sdp = f"v=0\r\no=- {tag} 1 IN IP4 {ip}\r\ns=-\r\nc=IN IP4 {ip}\r\nt=0 0\r\nm=audio 40000 RTP/AVP 0 8 101\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000\r\na=sendrecv\r\n"
def req(method, uri, cseq, extra='', body='', branch=None):
    b = branch or 'z9hG4bK' + str(random.randint(1, 10**9))
    return (f"{method} {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {ip}:{port};branch={b};rport\r\nMax-Forwards: 70\r\n"
            f"From: <sip:{caller}@spenza.test>;tag={tag}\r\nTo: <sip:{did}@{RELAY[0]}>{extra}\r\nCall-ID: {cid}\r\nCSeq: {cseq} {method}\r\n"
            f"Contact: <sip:{caller}@{ip}:{port}>\r\n" + ("Content-Type: application/sdp\r\n" if body else '') + f"Content-Length: {len(body)}\r\n\r\n{body}")
s.sendto(req('INVITE', f'sip:{did}@{RELAY[0]}', 1, body=sdp).encode(), RELAY)
final = None; t0 = time.time()
while time.time() - t0 < 25:
    try: m = s.recv(65535).decode(errors='ignore')
    except socket.timeout: continue
    line = m.split('\r\n')[0]; print('<-', line)
    if re.match(r'SIP/2.0 [2-6]\d\d', line) and 'INVITE' in m.split('CSeq:')[1].split('\r\n')[0]: final = m; break
if not final: print('no final answer'); sys.exit(1)
code = int(final.split(' ')[1])
to_tag = re.search(r'^To:.*?;tag=([^;\r\n>]+)', final, re.M | re.I)
routes = [r.strip() for h in re.findall(r'^Record-Route:\s*(.*)$', final, re.M | re.I) for r in h.split(',')]
contact = re.search(r'^(?:Contact|m):\s*<([^>]+)>', final, re.M | re.I)
if code >= 300:
    s.sendto(req('ACK', f'sip:{did}@{RELAY[0]}', 1, extra=f';tag={to_tag.group(1)}' if to_tag else '').encode(), RELAY); print('RESULT rejected', code); sys.exit(2)
rt = ''.join(f'Route: {r}\r\n' for r in routes)
ack = req('ACK', contact.group(1), 1, extra=f';tag={to_tag.group(1)}').replace('Max-Forwards: 70\r\n', 'Max-Forwards: 70\r\n' + rt)
s.sendto(ack.encode(), RELAY); print('-> ACK; holding 10 s')
time.sleep(10)
bye = req('BYE', contact.group(1), 2, extra=f';tag={to_tag.group(1)}').replace('Max-Forwards: 70\r\n', 'Max-Forwards: 70\r\n' + rt)
s.sendto(bye.encode(), RELAY)
try: print('<-', s.recv(65535).decode(errors='ignore').split('\r\n')[0])
except socket.timeout: print('no BYE reply')
print('RESULT answered', code)
