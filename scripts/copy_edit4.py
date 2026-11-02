B = '/app/frontend/src/cloudivr/pages/Esim.js'
s = open(B).read()
def rep(a, b):
    global s
    assert a in s, a[:60]; s = s.replace(a, b, 1)
rep("['browser', Globe2, 'Ring in CloudIVR', 'Calls get the keypad menu, forwarding and voicemail of a calling number you pick.']];", "['browser', Globe2, 'Ring in CloudIVR', 'Not active yet: we’re waiting for the carrier to switch on call routing. Calls keep ringing on your phone.']];\n  const off = (k) => k === 'browser' && item.callsTo !== 'browser';")
rep("onClick={() => !on && set(k)} className={`civr-card text-left p-3 border-2 transition-colors ${on ? 'border-[#818cf8] bg-[#818cf8]/15' : 'border-transparent opacity-80 hover:opacity-100'}`}", "onClick={() => !on && !off(k) && set(k)} disabled={off(k)} aria-disabled={off(k)} className={`civr-card text-left p-3 border-2 transition-colors ${on ? 'border-[#818cf8] bg-[#818cf8]/15' : off(k) ? 'border-transparent opacity-50 cursor-not-allowed' : 'border-transparent opacity-80 hover:opacity-100'}`}")
rep("{nums.length > 0 && <label className=\"flex flex-wrap items-center gap-2 text-sm\" data-testid={`esim-calls-menu-${item.id}`}>", "{nums.length > 0 && item.callsTo === 'browser' && <label className=\"flex flex-wrap items-center gap-2 text-sm\" data-testid={`esim-calls-menu-${item.id}`}>")
rep("{nd && !nums.length && <p", "{nd && !nums.length && item.callsTo === 'browser' && <p")
open(B, 'w').write(s)
print('ok')
