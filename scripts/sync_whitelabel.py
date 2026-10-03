#!/usr/bin/env python3
"""
Brand-safe sync:  main  ->  WhiteLabel
======================================

Carries every CODE change made on `main` since the last sync over to the
`WhiteLabel` branch (Smadav bot, app-wl) while protecting everything that makes
WhiteLabel a different brand:

  * WhiteLabel-owned brand files (Smadav logo/favicon, branding.js, the /sales
    dashboard, frontend/.env.production, ...) are NEVER touched.
  * Session docs (memory/, test_reports/, .emergent/, *.md, ...) are not synced;
    each branch keeps its own notes.
  * A file only main changed  -> main's version is taken.
  * A file BOTH branches changed (e.g. js/_index.js, frontend/src/App.js) gets a
    real per-file 3-way merge. If a RUNTIME file conflicts, the whole sync STOPS
    and nothing is pushed. (Resolving such conflicts "in favour of main" is
    exactly what wiped the Smadav branding in the old "Merge main into
    WhiteLabel" commit 7129cae9.) Conflicts in test/artifact files simply keep
    WhiteLabel's copy.
  * Every updated backend .js/.py file is syntax-checked before committing.

The last synced main commit is recorded in `.whitelabel-sync` on WhiteLabel, so
each run carries over only what is new. Works purely on git objects (no
checkout of WhiteLabel needed); pushes are fast-forward only (never --force).

Usage (normally run by .github/workflows/sync-whitelabel.yml):
  python3 scripts/sync_whitelabel.py [--source origin/main] [--target origin/WhiteLabel]
                                     [--base <sha>] [--dry-run | --push]
                                     [--remote origin] [--target-branch WhiteLabel]

Exit codes: 0 ok / nothing to do · 1 error · 2 conflicts (nothing pushed) ·
            3 syntax check failed (nothing pushed)
"""
import argparse
import datetime
import fnmatch
import os
import re
import shutil
import subprocess
import sys
import tempfile

# main commit that was last hand-synced to WhiteLabel (WhiteLabel 16bb4dd7,
# 2026-10-02 RDP poll-hardening). Used only until `.whitelabel-sync` exists.
BOOTSTRAP_BASE = 'e92a09ed4257823ae7b13da146a553faafcd0ba6'
MARKER = '.whitelabel-sync'
ZERO_OID = '0' * 40

# Session notes / reports — each branch keeps its own copy.
DOC_PATTERNS = [
    'memory/*', '.emergent/*', 'test_reports/*', 'investigations/*', 'docs/*',
    'archive/*', 'test_result.md', '*.md', MARKER,
]

# WhiteLabel-owned brand files — always keep WhiteLabel's version.
BRAND_PATTERNS = [
    'frontend/.env.production',
    'frontend/src/branding.js',
    'frontend/src/pages/SalesDashboard.js',
    'frontend/public/smadav-*',
    'frontend/public/brand-placeholder-*',
    'js/branding.js',
    'js/routes/sales.js',
]

REGULAR_MODES = ('100644', '100755')

# GitHub refuses pushes made with the Actions GITHUB_TOKEN that create/modify
# workflow files ("refusing to allow a GitHub App to create or update workflow
# ... without `workflows` permission"), so workflow files are never synced. They
# are dispatched from main anyway (deploy.yml / sync-whitelabel.yml).
CI_PATTERNS = ['.github/workflows/*']


# ── git helpers ──────────────────────────────────────────────────────────────
def git(*args, input=None, env=None, check=True):
    r = subprocess.run(['git', *args], input=input, capture_output=True, env=env)
    if check and r.returncode != 0:
        err = r.stderr.decode(errors='replace').strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {err}")
    return r


def out(*args, **kw):
    return git(*args, **kw).stdout.decode(errors='replace').strip()


def rev(ref):
    return out('rev-parse', '--verify', f'{ref}^{{commit}}')


def tree_map(commit):
    """path -> (mode, blob_sha) for every blob/symlink in the commit's tree."""
    data = git('ls-tree', '-r', '-z', '--full-tree', commit).stdout.decode(errors='surrogateescape')
    m = {}
    for rec in data.split('\0'):
        if not rec:
            continue
        meta, path = rec.split('\t', 1)
        mode, typ, sha = meta.split()
        if typ == 'blob':
            m[path] = (mode, sha)
    return m


def blob(sha):
    return git('cat-file', 'blob', sha).stdout


def is_binary(sha):
    return b'\0' in blob(sha)[:8000]


def hash_blob(content):
    return out('hash-object', '-w', '--stdin', input=content)


def matches(path, patterns):
    return any(fnmatch.fnmatch(path, p) for p in patterns)


def is_non_runtime(path):
    """Tests / result artifacts: on conflict we just keep WhiteLabel's copy."""
    parts = path.split('/')
    if any(seg in ('tests', '__tests__', 'legacy', 'test_reports') for seg in parts[:-1]):
        return True
    name = parts[-1]
    if re.match(r'^(test_.*|.*_tests?|.*_tests?_.*|.*\.test)\.(py|js|json|xml)$', name):
        return True
    if len(parts) == 1:  # root-level result dumps / logs / screenshots
        ext = os.path.splitext(name)[1]
        if ext in ('.txt', '.out', '.log', '.png', '.xml'):
            return True
        if ext == '.json' and re.search(r'(result|test|report)', name):
            return True
    return False


def merge3(t_sha, b_sha, s_sha):
    """3-way merge WhiteLabel(t) / base(b) / main(s). Returns (bytes, n_conflicts)."""
    d = tempfile.mkdtemp(prefix='wlsync-')
    try:
        paths = []
        for name, sha in (('wl', t_sha), ('base', b_sha), ('main', s_sha)):
            p = os.path.join(d, name)
            with open(p, 'wb') as fh:
                fh.write(blob(sha))
            paths.append(p)
        r = subprocess.run(['git', 'merge-file', '-p', '-L', 'WhiteLabel', '-L', 'base', '-L', 'main', *paths],
                           capture_output=True)
        if r.returncode < 0 or r.returncode >= 128:
            raise RuntimeError(f'git merge-file error: {r.stderr.decode(errors="replace")}')
        return r.stdout, r.returncode
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ── syntax check ─────────────────────────────────────────────────────────────
def _check_cmd(path):
    if path.endswith('.js') and path.split('/')[0] in ('js', 'scripts', 'backend'):
        return 'node'
    if path.endswith('.py') and not is_non_runtime(path):
        return 'python'
    return None


def _syntax_ok(kind, content, path):
    d = tempfile.mkdtemp(prefix='wlsync-chk-')
    try:
        f = os.path.join(d, os.path.basename(path))
        with open(f, 'wb') as fh:
            fh.write(content)
        if kind == 'node':
            cmd = ['node', '--check', f]
        else:
            cmd = [sys.executable, '-m', 'py_compile', f]
        r = subprocess.run(cmd, capture_output=True)
        return r.returncode == 0, (r.stderr or r.stdout).decode(errors='replace').strip()[:600]
    finally:
        shutil.rmtree(d, ignore_errors=True)


def syntax_check(ops, T):
    """Block the sync if it would break a file that is valid on WhiteLabel today
    (or add a broken new file) — no matter whether main or the merge broke it.
    A file that is ALREADY broken on WhiteLabel is only reported as a warning."""
    failures, warnings = [], []
    have_node = shutil.which('node') is not None
    for path, ent in ops:
        if ent is None:
            continue
        kind = _check_cmd(path)
        if kind is None:
            continue
        if kind == 'node' and not have_node:
            warnings.append(f'{path}: node not installed — syntax check skipped')
            continue
        ok, msg = _syntax_ok(kind, blob(ent[1]), path)
        if ok:
            continue
        cur = T.get(path)
        already_broken = cur is not None and not _syntax_ok(kind, blob(cur[1]), path)[0]
        if already_broken:
            warnings.append(f'{path}: already fails on WhiteLabel today (pre-existing) — {msg[:200]}')
        else:
            failures.append(f'{path}: {msg}')
    return failures, warnings


# ── outputs ──────────────────────────────────────────────────────────────────
def gh_output(**kv):
    f = os.environ.get('GITHUB_OUTPUT')
    if f:
        with open(f, 'a') as fh:
            for k, v in kv.items():
                fh.write(f'{k}={v}\n')


def gh_summary(text):
    f = os.environ.get('GITHUB_STEP_SUMMARY')
    if f:
        with open(f, 'a') as fh:
            fh.write(text + '\n')


def section(title, items, prefix='  '):
    if not items:
        return ''
    return f'{title} ({len(items)}):\n' + '\n'.join(prefix + i for i in items) + '\n'


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description='Brand-safe sync of main -> WhiteLabel')
    ap.add_argument('--source', default='origin/main')
    ap.add_argument('--target', default='origin/WhiteLabel')
    ap.add_argument('--target-branch', default='WhiteLabel')
    ap.add_argument('--remote', default='origin')
    ap.add_argument('--base', default=None, help='main commit last synced (default: read .whitelabel-sync)')
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', help='report only, push nothing (default)')
    mode.add_argument('--push', action='store_true', help='push the sync commit (fast-forward only)')
    a = ap.parse_args()

    source, target = rev(a.source), rev(a.target)

    # 1) where did the last sync leave off?
    base, base_from = a.base, '--base'
    if not base:
        r = git('show', f'{target}:{MARKER}', check=False)
        mm = re.search(r'^main=([0-9a-f]{7,64})\s*$', r.stdout.decode(errors='replace'), re.M) if r.returncode == 0 else None
        base, base_from = (mm.group(1), MARKER) if mm else (BOOTSTRAP_BASE, 'bootstrap (2026-10-02 hand sync)')
    base = rev(base)
    if git('merge-base', '--is-ancestor', base, source, check=False).returncode != 0:
        raise RuntimeError(f'base {base[:8]} is not an ancestor of {a.source} {source[:8]} '
                           f'(main history rewritten?) — re-run with --base <last synced main sha>')

    print(f'main        : {a.source} {source[:8]}')
    print(f'WhiteLabel  : {a.target} {target[:8]}')
    print(f'last synced : {base[:8]}  (from {base_from})')

    if base == source:
        print('\n✅ WhiteLabel already has every main change — nothing to do.')
        gh_output(changed='false', runtime_changed='false', pushed='false', commit=target)
        gh_summary(f'### ✅ WhiteLabel already up to date with main `{source[:8]}`')
        return 0

    changed = [p for p in git('diff', '--name-only', '-z', '--no-renames', base, source)
               .stdout.decode(errors='surrogateescape').split('\0') if p]
    B, S, T = tree_map(base), tree_map(source), tree_map(target)

    ops = []  # (path, (mode, sha) | None-for-delete)
    taken, merged, kept_wl, in_sync, skipped_docs, skipped_brand, skipped_ci, conflicts = [], [], [], [], [], [], [], []

    for p in changed:
        if matches(p, DOC_PATTERNS):
            skipped_docs.append(p)
            continue
        if matches(p, BRAND_PATTERNS):
            skipped_brand.append(p)
            continue
        if matches(p, CI_PATTERNS):
            skipped_ci.append(p)
            continue
        b, s, t = B.get(p), S.get(p), T.get(p)
        if t == s:
            in_sync.append(p)
            continue
        if t == b:  # WhiteLabel never edited it since the last sync -> take main's version
            ops.append((p, s))
            taken.append(('D ' if s is None else ('A ' if b is None else 'M ')) + p)
            continue
        # both branches changed it -> real 3-way merge (regular text files only)
        if (b and s and t and b[0] in REGULAR_MODES and s[0] in REGULAR_MODES and t[0] in REGULAR_MODES
                and not (is_binary(b[1]) or is_binary(s[1]) or is_binary(t[1]))):
            content, n = merge3(t[1], b[1], s[1])
            if n == 0:
                file_mode = s[0] if t[0] == b[0] else t[0]
                ops.append((p, (file_mode, hash_blob(content))))
                merged.append(p)
                continue
            reason = f'{n} conflicting hunk(s)'
        else:
            reason = 'changed/added/deleted differently on both branches'
        if is_non_runtime(p):
            kept_wl.append(f'{p}  ({reason})')
        else:
            conflicts.append(f'{p}  ({reason})')

    report = (
        section('Updated from main (WhiteLabel had not edited them)', taken)
        + section('3-way merged (both branches edited, merged cleanly)', merged)
        + section('Kept WhiteLabel version (test/artifact file conflict)', kept_wl)
        + section('Skipped — WhiteLabel brand files (never synced)', skipped_brand)
        + section('Skipped — GitHub workflow files (Actions token may not change them; run from main)', skipped_ci)
        + section('Already identical on both branches', in_sync)
        + f'Skipped — docs/session notes: {len(skipped_docs)} file(s)\n'
    )
    print('\n' + report)

    if conflicts:
        msg = section('⛔ CONFLICTS in runtime files — sync STOPPED, nothing pushed', conflicts)
        print(msg + '\nResolve these on WhiteLabel by hand (keep the Smadav branding), then re-run.')
        gh_summary('### ⛔ Sync stopped — conflicts, nothing pushed\n```\n' + msg + report + '```')
        gh_output(changed='false', runtime_changed='false', pushed='false', commit=target)
        return 2

    if not ops:
        # Only docs / brand / workflow / kept-WL test files changed — nothing to carry.
        # Don't create a marker-only commit on every save (automatic runs).
        print('✅ No code changes to carry over to WhiteLabel — nothing pushed.')
        gh_summary(f'### ✅ No code to carry over (main `{base[:8]}..{source[:8]}`) — WhiteLabel unchanged\n```\n{report}```')
        gh_output(changed='false', runtime_changed='false', pushed='false', commit=target)
        return 0

    failures, warnings = syntax_check(ops, T)
    for w in warnings:
        print(f'⚠️  {w}')
    if failures:
        msg = section('⛔ SYNTAX CHECK FAILED after merge — nothing pushed', failures)
        print(msg)
        gh_summary('### ⛔ Sync stopped — syntax check failed\n```\n' + msg + '```')
        gh_output(changed='false', runtime_changed='false', pushed='false', commit=target)
        return 3

    # 2) build the new WhiteLabel commit straight from git objects (temp index)
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    marker = (f'# Managed by scripts/sync_whitelabel.py — do not edit by hand.\n'
              f'# Last main commit whose code changes were synced onto WhiteLabel.\n'
              f'main={source}\nsynced_at={now}\n').encode()
    marker_sha = hash_blob(marker)

    env = dict(os.environ)
    fd, idx = tempfile.mkstemp(prefix='wlsync-index-')
    os.close(fd)
    os.unlink(idx)
    env['GIT_INDEX_FILE'] = idx
    for k, v in (('GIT_AUTHOR_NAME', 'whitelabel-sync'), ('GIT_AUTHOR_EMAIL', 'whitelabel-sync@users.noreply.github.com')):
        env.setdefault(k, v)
    env.setdefault('GIT_COMMITTER_NAME', env['GIT_AUTHOR_NAME'])
    env.setdefault('GIT_COMMITTER_EMAIL', env['GIT_AUTHOR_EMAIL'])
    try:
        git('read-tree', target, env=env)
        recs = []
        for p, ent in ops + [(MARKER, ('100644', marker_sha))]:
            recs.append((f'0 {ZERO_OID}' if ent is None else f'{ent[0]} {ent[1]}') + '\t' + p)
        git('update-index', '-z', '--index-info', env=env,
            input=('\0'.join(recs) + '\0').encode(errors='surrogateescape'))
        tree = out('write-tree', env=env)
    finally:
        if os.path.exists(idx):
            os.unlink(idx)

    n_code = len(taken) + len(merged)
    body = (f'sync(WhiteLabel): carry main {base[:8]}..{source[:8]} ({n_code} file(s))\n\n'
            f'Brand-safe sync by scripts/sync_whitelabel.py — WhiteLabel brand files and\n'
            f'session docs untouched; only main\'s code changes carried over.\n\n' + report)
    commit = out('commit-tree', tree, '-p', target, input=body.encode(), env=env)

    # 3) self-verify: the new commit changes ONLY what we planned
    # -z: raw paths (no C-quoting of spaces/unicode), same decoding as `changed` above
    touched = {p for p in git('diff', '--name-only', '-z', target, commit)
               .stdout.decode(errors='surrogateescape').split('\0') if p}
    planned = {p for p, _ in ops} | {MARKER}
    if not touched <= planned:
        raise RuntimeError(f'internal check failed — unexpected paths: {sorted(touched - planned)[:10]}')
    brand_hit = sorted(p for p in touched if matches(p, BRAND_PATTERNS) or matches(p, CI_PATTERNS))
    if brand_hit:
        raise RuntimeError(f'internal check failed — brand/workflow files would change: {brand_hit}')

    runtime_changed = any(not is_non_runtime(p) for p, _ in ops)
    print(out('diff', '--stat=120', target, commit))
    print(f'\nnew WhiteLabel commit: {commit[:8]}  (parent {target[:8]})  runtime code changed: {runtime_changed}')

    if not a.push:
        print('\n🔎 DRY RUN — nothing pushed. Re-run with --push to publish.')
        gh_summary(f'### 🔎 Dry run — would sync main `{base[:8]}..{source[:8]}` onto WhiteLabel\n```\n{report}```')
        gh_output(changed='true', runtime_changed=str(runtime_changed).lower(), pushed='false', commit=commit)
        return 0

    git('push', a.remote, f'{commit}:refs/heads/{a.target_branch}')  # fast-forward only (no --force)
    print(f'\n🚀 Pushed {commit[:8]} to {a.remote}/{a.target_branch}')
    gh_summary(f'### 🚀 Synced main `{base[:8]}..{source[:8]}` onto WhiteLabel → `{commit[:8]}`\n```\n{report}```')
    gh_output(changed='true', runtime_changed=str(runtime_changed).lower(), pushed='true', commit=commit)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f'❌ {e}', file=sys.stderr)
        sys.exit(1)
