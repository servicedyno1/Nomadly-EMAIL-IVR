import sys
sys.path.insert(0, '/app/scripts')
from edit_helper import edit

edit('/app/js/phone-config.js', [
("long <code>gencred…</code> usernames (49 chars) get truncated by some dialers.", "a mistyped username or password, or one cut short by the dialer."),
("<b>copy-paste, don't retype</b> (usernames are 49 chars)", "<b>copy-paste, don't retype</b>"),
("most SIP dialers accept 50+ char usernames but some old builds truncate. Copy-paste the full <code>gencred…</code> string exactly.", "some old dialers cut long usernames short. Copy-paste the full username exactly."),
("the username is JUST <code>gencred…</code>. Do NOT enter <code>gencred…@${domain}</code> in the username box.", "the username box holds ONLY the username. Do NOT enter <code>username@${domain}</code> there."),
("   Username + Auth ID: your <code>gencred…</code> SIP username", "   Username + Auth ID: your SIP username"),
("   Username + Auth ID : votre identifiant SIP <code>gencred…</code>", "   Username + Auth ID : votre identifiant SIP"),
("   Username + Auth ID：您的 <code>gencred…</code> SIP 用户名", "   Username + Auth ID：您的 SIP 用户名"),
("   Username + Auth ID: आपका <code>gencred…</code> SIP उपयोगकर्ता नाम", "   Username + Auth ID: आपका SIP उपयोगकर्ता नाम"),
])
