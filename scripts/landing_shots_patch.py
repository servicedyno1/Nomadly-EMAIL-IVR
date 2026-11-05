B = '/app/scripts/landing_shots.py'
s = open(B).read()
s = s.replace("""            await ctx.add_init_script("localStorage.setItem('civr.theme','light'); localStorage.setItem('civr.lang','en');")""", """            await ctx.add_init_script("localStorage.setItem('civr.theme','light'); localStorage.setItem('civr.lang','en');" + HIDE)""")
s = s.replace("""SIZES = {""", """HIDE = \"\"\"
document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '[aria-label="Preview mode notice"],[data-testid="support-chat-toggle"],[data-testid="dashboard-channel-card"],.civr-offer{display:none!important}'; document.head.appendChild(st); });
setInterval(() => document.querySelectorAll('.civr-card').forEach(c => { if (/how is CloudIVR so far/i.test(c.textContent)) c.style.display = 'none'; }), 300);
\"\"\"
SIZES = {""")
s = s.replace("""    ('ivr', f'/app/numbers/{q("+13346972125")}?tab=ivr', None, None),""", """    ('ivr', f'/app/numbers/{q("+13346972125")}?tab=ivr', 'text=Keypad menu (IVR)', None),""")
open(B, 'w').write(s)
print('ok')
