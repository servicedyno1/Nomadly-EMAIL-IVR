import socket, uuid, sys, time, re
key = sys.argv[1]
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('0.0.0.0', 0)); s.settimeout(2)
lp = s.getsockname()[1]; ip = '146.190.238.190'
r = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); r.bind(('0.0.0.0', 0)); rp = r.getsockname()[1]
cid = uuid.uuid4().hex; tag = uuid.uuid4().hex[:8]
sdp = f"v=0\r\no=- 1 1 IN IP4 {ip}\r\ns=-\r\nc=IN IP4 {ip}\r\nt=0 0\r\nm=audio {rp} RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n"
ruri = 'sip:sipbridge@sip.speechcue.com'
inv = f"INVITE {ruri} SIP/2.0\r\nVia: SIP/2.0/UDP {ip}:{lp};branch=z9hG4bK{uuid.uuid4().hex[:10]};rport\r\nMax-Forwards: 70\r\nFrom: <sip:+12074892004@sip.speechcue.com>;tag={tag}\r\nTo: <sip:sipbridge@sip.speechcue.com>\r\nCall-ID: {cid}\r\nCSeq: 1 INVITE\r\nContact: <sip:x@{ip}:{lp}>\r\nX-Nomadly-Key: {key}\r\nX-Nomadly-User: ai.aimediatest.tok_1\r\nContent-Type: application/sdp\r\nContent-Length: {len(sdp)}\r\n\r\n{sdp}"
s.sendto(inv.encode(), ('188.166.34.29', 5060))
end = time.time() + 15; final = None
while time.time() < end:
    try: m = s.recv(65535).decode(errors='ignore')
    except socket.timeout: continue
    code = m.split('\r\n')[0]; print('got', code)
    if re.match(r'SIP/2.0 [2-6]\d\d', code):
        final = m; break
if final and ' 200 ' in final.split('\r\n')[0]:
    to = re.search(r'^To:\s*(.*)$', final, re.M | re.I).group(1).strip()
    ct = re.search(r'^Contact:\s*<([^>]+)>', final, re.M | re.I).group(1)
    rr = re.findall(r'^Record-Route:\s*(.*)$', final, re.M | re.I)
    route = ''.join(f"Route: {x.strip()}\r\n" for x in rr)
    s.sendto(f"ACK {ct} SIP/2.0\r\nVia: SIP/2.0/UDP {ip}:{lp};branch=z9hG4bK{uuid.uuid4().hex[:10]};rport\r\n{route}Max-Forwards: 70\r\nFrom: <sip:+12074892004@sip.speechcue.com>;tag={tag}\r\nTo: {to}\r\nCall-ID: {cid}\r\nCSeq: 1 ACK\r\nContent-Length: 0\r\n\r\n".encode(), ('188.166.34.29', 5060))
    body = final.split('\r\n\r\n', 1)[1]
    rip = re.search(r'c=IN IP4 (\S+)', body).group(1); rport = int(re.search(r'm=audio (\d+)', body).group(1))
    r.settimeout(0.02); n = 0; seq = 1
    end = time.time() + 4
    while time.time() < end:
        seq += 1
        r.sendto(bytes([0x80, 0, seq >> 8 & 255, seq & 255, 0, 0, 0, 0, 0, 0, 0, 7]) + bytes([0xff]) * 160, (rip, rport))
        try:
            r.recv(2000); n += 1
        except socket.timeout: pass
    print('caller got rtp packets:', n)
