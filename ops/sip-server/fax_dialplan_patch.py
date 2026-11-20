p = '/etc/asterisk/extensions.conf'; s = open(p).read()
s = s.replace(' same => n,Set(FAXOPT(ecm)=yes)\n', ' same => n,Set(FAXOPT(ecm)=no)\n')
for d, v in (('in', 'FAXTO'), ('out', 'FAXID')):
    a = 'exten => h,1,System(/usr/local/bin/fax-hook ' + d + ' '
    if a in s:
        s = s.replace(a, 'exten => h,1,Log(NOTICE,fax-' + d + ' ${' + v + '} status=${FAXOPT(status)} pages=${FAXOPT(pages)} error=${FAXOPT(error)})\n same => n,System(/usr/local/bin/fax-hook ' + d + ' ', 1)
open(p, 'w').write(s)
print('patched', s.count('ecm)=no'), s.count('Log(NOTICE,fax-'))
# Outbound over G.711: cap at 9600 bps and send our number as station ID (external fax lines failed training at 14400).
s = open(p).read()
old = ' same => n(send),Set(FAXOPT(ecm)=yes)\n'
if old in s and 'FAXOPT(maxrate)=9600' not in s:
    s = s.replace(old, old + ' same => n,Set(FAXOPT(maxrate)=9600)\n same => n,Set(FAXOPT(localstationid)=${CALLERID(num)})\n', 1)
    open(p, 'w').write(s)
print('fax-out tuned', 'FAXOPT(maxrate)=9600' in s)
# ECM per try (the app alternates FAXECM between calls).
s = open(p).read()
s = s.replace(' same => n(send),Set(FAXOPT(ecm)=yes)\n', ' same => n(send),Set(FAXOPT(ecm)=${IF($["${FAXECM}"="no"]?no:yes)})\n', 1)
open(p, 'w').write(s)
print('fax-out ecm per try', 'FAXECM' in s)
