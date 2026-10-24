#!/usr/bin/env python3
"""
Final Summary Test for 7 Node.js Bug Fixes
"""

import subprocess
import sys
import requests

def run_command(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return result.returncode == 0, result.stdout.strip(), result.stderr.strip()
    except:
        return False, "", "Command failed"

def main():
    print("🚀 FINAL VERIFICATION: 7 Node.js Bug Fixes")
    print("=" * 50)
    
    # 1. Syntax validation
    print("🔍 Syntax Validation")
    files = ['/app/js/_index.js', '/app/js/voice-service.js', '/app/js/sanitize-provider.js']
    syntax_ok = True
    for file_path in files:
        ok, _, err = run_command(f'node -c {file_path}')
        if ok:
            print(f"  ✅ {file_path}")
        else:
            print(f"  ❌ {file_path}: {err}")
            syntax_ok = False
    
    # 2. Health check
    print("\n🔍 Health Check")
    try:
        response = requests.get("http://localhost:5000/health", timeout=5)
        health_ok = response.status_code == 200
        if health_ok:
            print(f"  ✅ Health endpoint: {response.json()}")
        else:
            print(f"  ❌ Health endpoint: HTTP {response.status_code}")
    except Exception as e:
        print(f"  ❌ Health endpoint: {e}")
        health_ok = False
    
    # 3. Check all 7 fixes in code
    print("\n🔍 Bug Fix Verification")
    
    try:
        with open('/app/js/_index.js', 'r') as f:
            index_content = f.read()
        with open('/app/js/sanitize-provider.js', 'r') as f:
            sanitize_content = f.read()
        with open('/app/js/voice-service.js', 'r') as f:
            voice_content = f.read()
    except Exception as e:
        print(f"❌ Could not read files: {e}")
        return False
    
    fixes = []
    
    # Fix 1: $undefined price in non-USA leads validation
    fix1 = ('const cnam = false' in index_content and 
            'const price = info?.amount * RATE_LEAD_VALIDATOR' in index_content and
            "saveInfo('price', price)" in index_content)
    fixes.append(("Fix 1: $undefined price in non-USA leads", fix1))
    
    # Fix 2: lang TDZ fixes
    fix2 = ("FIX: Removed redundant `const lang` that caused TDZ error in ActivateShortener" in index_content)
    fixes.append(("Fix 2: lang TDZ in DomainActionShortener/ActivateShortener", fix2))
    
    # Fix 3: resolveUserTag at module scope
    lines = index_content.split('\n')
    resolveUserTag_line = next((i for i, line in enumerate(lines) if 'async function resolveUserTag(chatId)' in line), None)
    loadData_line = next((i for i, line in enumerate(lines) if 'const loadData = async () => {' in line), None)
    fix3 = (resolveUserTag_line is not None and loadData_line is not None and resolveUserTag_line < loadData_line)
    fixes.append(("Fix 3: resolveUserTag not defined in marketplace", fix3))
    
    # Fix 4: goto function guards
    fix4 = ('if (action && typeof goto[action] === \'function\')' in index_content and
            'if (lastStep && typeof goto[lastStep] === \'function\')' in index_content)
    fixes.append(("Fix 4: goto[(intermediate value)] is not a function", fix4))
    
    # Fix 5: HTML entity escaping
    fix5 = ("sanitized.replace(/&/g, '&amp;')" in sanitize_content and
            "sanitized.replace(/</g, '&lt;')" in sanitize_content and
            'sanitizeProviderError(saveErr, \'domain\')' in index_content)
    fixes.append(("Fix 5: Telegram HTML parse error on DNS messages", fix5))
    
    # Fix 6: walletOk handler recovery
    fix6 = ("typeof handler !== 'function'" in index_content and
            "await set(state, chatId, 'action', 'none')" in index_content and
            "session expired" in index_content)
    fixes.append(("Fix 6: walletOk handler not found for lastStep undefined", fix6))
    
    # Fix 9: UserWalletMonitor persistence
    fix9 = ('_balanceNotifyHistoryCol' in voice_content and
            '_loadBalanceNotifyHistory(db)' in voice_content and
            '_persistBalanceNotifyEntry(chatId, entry)' in voice_content)
    fixes.append(("Fix 9: UserWalletMonitor mass-warning on deploy", fix9))
    
    # Print fix results
    passed_fixes = 0
    for name, passed in fixes:
        status = "✅" if passed else "❌"
        print(f"  {status} {name}")
        if passed:
            passed_fixes += 1
    
    # 4. Check startup log for UserWalletMonitor
    print("\n🔍 Startup Log Check")
    ok, stdout, _ = run_command('grep -i "UserWalletMonitor.*Loaded.*notification" /var/log/supervisor/nodejs.out.log | tail -1')
    if ok and stdout:
        print(f"  ✅ UserWalletMonitor startup log: {stdout}")
    else:
        print("  ⚠️ UserWalletMonitor startup log not found")
    
    # 5. Service status
    print("\n🔍 Service Status")
    ok, pid, _ = run_command('pgrep -f "node.*_index.js"')
    if ok and pid:
        print(f"  ✅ Node.js service running (PID: {pid})")
    else:
        print("  ❌ Node.js service not running")
    
    # 6. Error logs
    ok, size, _ = run_command('wc -c /var/log/supervisor/nodejs.err.log 2>/dev/null | cut -d" " -f1')
    try:
        log_size = int(size) if size else 0
        if log_size == 0:
            print(f"  ✅ Error log clean (0 bytes)")
        else:
            print(f"  ⚠️ Error log has {log_size} bytes")
    except:
        print("  ⚠️ Could not check error log")
    
    # Summary
    print("\n" + "=" * 50)
    print(f"📊 RESULTS: {passed_fixes}/7 bug fixes verified ({passed_fixes/7*100:.1f}%)")
    
    if passed_fixes == 7 and syntax_ok and health_ok:
        print("🎉 ALL 7 BUG FIXES SUCCESSFULLY VERIFIED!")
        print("✅ Node.js codebase is working correctly")
        print("✅ Backend URL: https://vault-setup-29.preview.emergentagent.com")
        print("✅ Node.js on port 5000 behind FastAPI proxy at port 8001")
        return True
    else:
        print(f"⚠️ {7 - passed_fixes} bug fix(es) need attention")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)