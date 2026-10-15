#!/bin/bash
# READ-ONLY (run as root on the WHM box): per cPanel account, how much REAL user content exists.
# Ignores what cPanel / the bot puts there by itself: cgi-bin/, .well-known/, .htaccess, .user.ini,
# .antired-challenge.php, error_log, .ftpquota, php.ini and the Anti-Red index.php wrapper.
#   ssh root@WHM 'bash -s' < whm_empty_accounts_audit_2026-10.sh
python3 - <<'PY'
import os, re, json, time, subprocess, glob
IGN_DIR = re.compile(r'(^|/)(cgi-bin|\.well-known)(/|$)')
IGN_FILE = {'.htaccess', '.user.ini', '.antired-challenge.php', 'error_log', '.ftpquota', 'php.ini', '.htaccess.bak'}
def wrapper(p):
    try:
        with open(p, 'rb') as f: return b'Anti-Red: PHP wrapper' in f.read(4096)
    except Exception: return False
def docroots(user):
    roots = set()
    for f in glob.glob(f'/var/cpanel/userdata/{user}/*'):
        if f.endswith(('.cache', '.json', '_SSL')) or os.path.basename(f) in ('main', 'cache'): continue
        try:
            for line in open(f):
                if line.startswith('documentroot:'): roots.add(line.split(':', 1)[1].strip())
        except Exception: pass
    return sorted(roots) or [f'/home/{user}/public_html']
def mysql_dbs(user):
    try: return sorted(d for d in os.listdir('/var/lib/mysql') if d.startswith(user[:8] + '_'))
    except Exception: return []
def mailboxes(user):
    n = 0
    for p in glob.glob(f'/home/{user}/etc/*/passwd'):
        try: n += sum(1 for l in open(p) if l.strip())
        except Exception: pass
    return n
def kv(user):
    d = {}
    try:
        for l in open(f'/var/cpanel/users/{user}'):
            if '=' in l: k, v = l.rstrip('\n').split('=', 1); d[k] = v
    except Exception: pass
    return d
users = []
for l in open('/etc/trueuserdomains'):
    if ':' in l: dom, u = l.split(':', 1); users.append((u.strip(), dom.strip()))
suspended = set(os.listdir('/var/cpanel/suspended')) if os.path.isdir('/var/cpanel/suspended') else set()
for user, dom in sorted(users):
    meta = kv(user)
    files, size, newest, sample = 0, 0, 0, []
    seen = set()
    for root in docroots(user):
        for dp, dn, fn in os.walk(root):
            rel_dir = os.path.relpath(dp, root)
            if IGN_DIR.search(rel_dir.replace('\\', '/') + '/'): dn[:] = []; continue
            for f in fn:
                p = os.path.join(dp, f)
                if p in seen: continue
                seen.add(p)
                if f in IGN_FILE: continue
                if f == 'index.php' and rel_dir == '.' and wrapper(p): continue
                try: st = os.lstat(p)
                except Exception: continue
                files += 1; size += st.st_size; newest = max(newest, st.st_mtime)
                if len(sample) < 4: sample.append(os.path.relpath(p, f'/home/{user}'))
    du = subprocess.run(['du', '-sm', f'/home/{user}'], capture_output=True, text=True).stdout.split('\t')[0]
    print(json.dumps({
        'user': user, 'domain': dom, 'suspended': user in suspended, 'plan': meta.get('PLAN'),
        'created': time.strftime('%Y-%m-%d', time.gmtime(int(meta.get('STARTDATE', '0') or 0))),
        'addon_or_sub': len(docroots(user)) - 1, 'user_files': files, 'user_bytes': size,
        'newest_upload': time.strftime('%Y-%m-%d', time.gmtime(newest)) if newest else None,
        'sample': sample, 'mysql_dbs': len(mysql_dbs(user)), 'mailboxes': mailboxes(user), 'home_mb': int(du or 0),
    }))
PY
