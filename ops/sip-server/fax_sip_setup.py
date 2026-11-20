import re, os, subprocess
kc = '/etc/kamailio/kamailio.cfg'; s = open(kc).read()
key = re.search(r'#!substdef "!SIP_KEY!(.*?)!g"', s).group(1)
if '^fax\\\\.' not in s:
    a = '\t\tif ($rU =~ "^pstn\\\\.") {'
    assert a in s, 'pstn line'
    s = s.replace(a, '\t\t# Infobip fax number: to the fax receiver (fax.<number>)\n\t\tif ($rU =~ "^fax\\\\.") { remove_hf("X-Nomadly-Domain"); append_hf("X-Tandem: TANDEM_KEY\\r\\n"); route(AI_ENGINE); }\n' + a, 1)
    open(kc, 'w').write(s)
ec = '/etc/asterisk/extensions.conf'; e = open(ec).read()
if '[fax-in]' not in e:
    e = e.replace('[from-didww]\n', ''';  Infobip fax number → receive here, then post the PDF to the app (fax-hook). [f][a][x]: "x" alone is a digit wildcard
exten => _[f][a][x].,1,NoOp(Fax in ${EXTEN})
 same => n,GotoIf($["${PJSIP_HEADER(read,X-Tandem)}"="${TANDEM_KEY}"]?ok)
 same => n,Hangup(21)
 same => n(ok),Set(__FAXTO=${CUT(EXTEN,.,2)})
 same => n,Goto(fax-in,s,1)
[from-didww]
''', 1)
    e += '''
[fax-in]
exten => s,1,Set(FAXFILE=/var/spool/asterisk/fax/in-${UNIQUEID}.tif)
 same => n,Set(FAXOPT(ecm)=yes)
 same => n,Answer()
 same => n,ReceiveFAX(${FAXFILE})
 same => n,Hangup()
exten => h,1,System(/usr/local/bin/fax-hook in "${FAXTO}" "${CALLERID(num)}" "${FAXFILE}" "${FAXOPT(status)}" "${FAXOPT(pages)}" "${UNIQUEID}" "${FAXOPT(error)}" &)

[fax-out]
exten => s,1,Set(FAXFILE=/var/spool/asterisk/fax/out-${FAXID}.tif)
 same => n,System(/usr/local/bin/fax-prep "${FAXURL}" "${FAXFILE}")
 same => n,GotoIf($["${SYSTEMSTATUS}"="SUCCESS"]?send)
 same => n,Set(FAXOPT(status)=FAILED)
 same => n,Set(FAXOPT(error)=could not prepare document)
 same => n,Hangup()
 same => n(send),Set(FAXOPT(ecm)=yes)
 same => n,SendFAX(${FAXFILE})
 same => n,Hangup()
exten => h,1,System(/usr/local/bin/fax-hook out "" "" "${FAXFILE}" "${FAXOPT(status)}" "${FAXOPT(pages)}" "${FAXID}" "${FAXOPT(error)}" &)
exten => failed,1,System(/usr/local/bin/fax-hook out "" "" "" "FAILED" "0" "${FAXID}" "no answer" &)
'''
    open(ec, 'w').write(e)
open('/etc/asterisk/fax-hook.env', 'w').write(f'FAX_HOOK_URL=https://2.speechcue.com/fax/asterisk-hook\nFAX_HOOK_KEY={key}\n')
os.chmod('/etc/asterisk/fax-hook.env', 0o600); subprocess.run(['chown', 'asterisk:asterisk', '/etc/asterisk/fax-hook.env'])
open('/usr/local/bin/fax-hook', 'w').write('''#!/bin/bash
# fax-hook <in|out> <to> <from> <tif> <status> <pages> <id> <error>: tell the app (PDF body for inbound)
. /etc/asterisk/fax-hook.env
DIR=$1; TO=$2; FROM=$3; TIF=$4; ST=$5; PG=$6; ID=$7; ER=$8
Q="dir=$DIR&key=$FAX_HOOK_KEY&to=$TO&from=$FROM&status=$ST&pages=$PG&id=$ID&error=$(printf %s "$ER" | sed 's/[^A-Za-z0-9 ._-]//g; s/ /+/g')"
BODY=/dev/null
if [ "$DIR" = in ] && [ -s "$TIF" ]; then tiff2pdf -o "${TIF%.tif}.pdf" "$TIF" 2>/dev/null && BODY="${TIF%.tif}.pdf"; fi
curl -s -m 60 -X POST -H 'Content-Type: application/pdf' --data-binary @"$BODY" "$FAX_HOOK_URL?$Q" >/dev/null
rm -f "$TIF" "${TIF%.tif}.pdf"
''')
open('/usr/local/bin/fax-prep', 'w').write('''#!/bin/bash
# fax-prep <pdf-url> <out.tif>: fetch the PDF and render fax pages (204x196 G3)
set -e
P="${2%.tif}.pdf"
curl -s -f -m 60 -o "$P" "$1"
gs -q -dNOPAUSE -dBATCH -dSAFER -sDEVICE=tiffg3 -r204x196 -sPAPERSIZE=letter -dFIXEDMEDIA -dPDFFitPage -sOutputFile="$2" "$P"
rm -f "$P"
''')
for f in ('/usr/local/bin/fax-hook', '/usr/local/bin/fax-prep'): os.chmod(f, 0o755)
subprocess.run(['chown', '-R', 'asterisk:asterisk', '/var/spool/asterisk/fax'])
print('ok')
