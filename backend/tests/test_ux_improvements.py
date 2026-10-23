"""
Test Suite for 27 UX Improvements
Tests utility modules and their integration in the Telegram bot
"""
import pytest
import subprocess
import json
import os
import re
from datetime import datetime

# Base URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://app-vault-launch-1.preview.emergentagent.com')

# ============================================================================
# SECTION 1: Utility Module Import Tests (Items 22-27)
# ============================================================================

class TestUtilityModulesImport:
    """Test that all utility modules can be imported without syntax errors"""
    
    def test_transaction_id_module(self):
        """Test transaction-id.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const txn = require('./js/transaction-id.js');
console.log(JSON.stringify({
    generateTransactionId: typeof txn.generateTransactionId,
    logTransaction: typeof txn.logTransaction,
    updateTransactionStatus: typeof txn.updateTransactionStatus,
    getUserTransactions: typeof txn.getUserTransactions,
    getTransaction: typeof txn.getTransaction
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['generateTransactionId'] == 'function'
        assert exports['logTransaction'] == 'function'
        assert exports['updateTransactionStatus'] == 'function'
        assert exports['getUserTransactions'] == 'function'
        assert exports['getTransaction'] == 'function'
    
    def test_improved_messages_module(self):
        """Test improved-messages.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const msg = require('./js/improved-messages.js');
console.log(JSON.stringify({
    getInsufficientBalanceMessage: typeof msg.getInsufficientBalanceMessage,
    getDNSPropagationMessage: typeof msg.getDNSPropagationMessage,
    getPhoneVerificationMessage: typeof msg.getPhoneVerificationMessage,
    getTransactionConfirmation: typeof msg.getTransactionConfirmation
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['getInsufficientBalanceMessage'] == 'function'
        assert exports['getDNSPropagationMessage'] == 'function'
        assert exports['getPhoneVerificationMessage'] == 'function'
        assert exports['getTransactionConfirmation'] == 'function'
    
    def test_progress_tracker_module(self):
        """Test progress-tracker.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const prog = require('./js/progress-tracker.js');
console.log(JSON.stringify({
    ProgressTracker: typeof prog.ProgressTracker,
    createProgressTracker: typeof prog.createProgressTracker
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['ProgressTracker'] == 'function'
        assert exports['createProgressTracker'] == 'function'
    
    def test_error_handler_module(self):
        """Test error-handler.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const err = require('./js/error-handler.js');
console.log(JSON.stringify({
    handleError: typeof err.handleError,
    safeExecute: typeof err.safeExecute,
    safeRefund: typeof err.safeRefund,
    hasCriticalOps: err.CRITICAL_OPERATIONS instanceof Set
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['handleError'] == 'function'
        assert exports['safeExecute'] == 'function'
        assert exports['safeRefund'] == 'function'
        assert exports['hasCriticalOps'] is True
    
    def test_order_history_module(self):
        """Test order-history.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const oh = require('./js/order-history.js');
console.log(JSON.stringify({
    handleOrderHistory: typeof oh.handleOrderHistory
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['handleOrderHistory'] == 'function'
    
    def test_onboarding_module(self):
        """Test onboarding.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const ob = require('./js/onboarding.js');
console.log(JSON.stringify({
    hasCompletedOnboarding: typeof ob.hasCompletedOnboarding,
    markOnboardingComplete: typeof ob.markOnboardingComplete,
    getOnboardingMessage: typeof ob.getOnboardingMessage,
    showOnboarding: typeof ob.showOnboarding
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['hasCompletedOnboarding'] == 'function'
        assert exports['markOnboardingComplete'] == 'function'
        assert exports['getOnboardingMessage'] == 'function'
        assert exports['showOnboarding'] == 'function'
    
    def test_smart_recommendations_module(self):
        """Test smart-recommendations.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const sr = require('./js/smart-recommendations.js');
console.log(JSON.stringify({
    getRecommendationsAfterDomain: typeof sr.getRecommendationsAfterDomain,
    getRecommendationsAfterHosting: typeof sr.getRecommendationsAfterHosting,
    getRecommendationsAfterPhone: typeof sr.getRecommendationsAfterPhone
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['getRecommendationsAfterDomain'] == 'function'
        assert exports['getRecommendationsAfterHosting'] == 'function'
        assert exports['getRecommendationsAfterPhone'] == 'function'
    
    def test_dns_status_checker_module(self):
        """Test dns-status-checker.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const dns = require('./js/dns-status-checker.js');
console.log(JSON.stringify({
    checkDNSStatus: typeof dns.checkDNSStatus,
    formatDNSStatus: typeof dns.formatDNSStatus
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['checkDNSStatus'] == 'function'
        assert exports['formatDNSStatus'] == 'function'
    
    def test_session_recovery_module(self):
        """Test session-recovery.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const sr = require('./js/session-recovery.js');
console.log(JSON.stringify({
    saveResumableSession: typeof sr.saveResumableSession,
    getResumableSession: typeof sr.getResumableSession,
    clearResumableSession: typeof sr.clearResumableSession,
    generateResumePrompt: typeof sr.generateResumePrompt,
    updateSessionProgress: typeof sr.updateSessionProgress
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['saveResumableSession'] == 'function'
        assert exports['getResumableSession'] == 'function'
        assert exports['clearResumableSession'] == 'function'
        assert exports['generateResumePrompt'] == 'function'
        assert exports['updateSessionProgress'] == 'function'
    
    def test_timeout_constants_module(self):
        """Test timeout-constants.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const to = require('./js/timeout-constants.js');
console.log(JSON.stringify({
    TIMEOUTS: typeof to.TIMEOUTS,
    getTimeoutWithWarning: typeof to.getTimeoutWithWarning,
    getTimeoutErrorMessage: typeof to.getTimeoutErrorMessage,
    hasFastTimeout: to.TIMEOUTS.FAST === 8000,
    hasMediumTimeout: to.TIMEOUTS.MEDIUM === 15000,
    hasSlowTimeout: to.TIMEOUTS.SLOW === 30000
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['TIMEOUTS'] == 'object'
        assert exports['getTimeoutWithWarning'] == 'function'
        assert exports['getTimeoutErrorMessage'] == 'function'
        assert exports['hasFastTimeout'] is True
        assert exports['hasMediumTimeout'] is True
        assert exports['hasSlowTimeout'] is True
    
    def test_retry_logic_module(self):
        """Test retry-logic.js imports and exports correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const rl = require('./js/retry-logic.js');
console.log(JSON.stringify({
    retryWithProgress: typeof rl.retryWithProgress,
    retryDomainRegistration: typeof rl.retryDomainRegistration,
    retryDNSUpdate: typeof rl.retryDNSUpdate
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Import failed: {result.stderr}"
        exports = json.loads(result.stdout.strip())
        assert exports['retryWithProgress'] == 'function'
        assert exports['retryDomainRegistration'] == 'function'
        assert exports['retryDNSUpdate'] == 'function'


# ============================================================================
# SECTION 2: Transaction ID Format Tests (Items 1-6)
# ============================================================================

class TestTransactionIdFormat:
    """Test transaction ID generation follows TXN-YYYYMMDD-XXXXX format"""
    
    def test_transaction_id_format(self):
        """Test that generated transaction IDs follow the correct format"""
        result = subprocess.run(
            ['node', '-e', '''
const { generateTransactionId } = require('./js/transaction-id.js');
const ids = [];
for (let i = 0; i < 10; i++) {
    ids.push(generateTransactionId());
}
console.log(JSON.stringify(ids));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Generation failed: {result.stderr}"
        ids = json.loads(result.stdout.strip())
        
        # Verify format: TXN-YYYYMMDD-XXXXX
        pattern = r'^TXN-\d{8}-[A-Z0-9]{5}$'
        for txn_id in ids:
            assert re.match(pattern, txn_id), f"Invalid format: {txn_id}"
        
        # Verify date portion is today
        today = datetime.now().strftime('%Y%m%d')
        for txn_id in ids:
            date_part = txn_id.split('-')[1]
            assert date_part == today, f"Date mismatch: {date_part} != {today}"
        
        # Verify uniqueness
        assert len(set(ids)) == len(ids), "Transaction IDs are not unique"


# ============================================================================
# SECTION 3: Improved Balance Message Tests (Items 13-15)
# ============================================================================

class TestImprovedBalanceMessages:
    """Test improved insufficient balance messages with CTAs"""
    
    def test_insufficient_balance_message_format(self):
        """Test that insufficient balance message includes current/required/shortfall + Add Funds button"""
        result = subprocess.run(
            ['node', '-e', '''
const { getInsufficientBalanceMessage } = require('./js/improved-messages.js');
const result = getInsufficientBalanceMessage(10.50, 25.00, 'USD', 'en');
console.log(JSON.stringify(result));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Function failed: {result.stderr}"
        msg_data = json.loads(result.stdout.strip())
        
        # Check message contains required elements
        message = msg_data['message']
        assert 'Insufficient Balance' in message, "Missing title"
        assert '$10.50' in message, "Missing current balance"
        assert '$25.00' in message, "Missing required amount"
        assert '$14.50' in message, "Missing shortfall amount"
        
        # Check keyboard has Add Funds button
        keyboard = msg_data['keyboard']
        flat_keyboard = [btn for row in keyboard for btn in row]
        assert any('Add Funds' in btn for btn in flat_keyboard), "Missing Add Funds button"
    
    def test_insufficient_balance_multilingual(self):
        """Test insufficient balance message in multiple languages"""
        for lang in ['en', 'fr', 'zh', 'hi']:
            result = subprocess.run(
                ['node', '-e', f'''
const {{ getInsufficientBalanceMessage }} = require('./js/improved-messages.js');
const result = getInsufficientBalanceMessage(5.00, 20.00, 'USD', '{lang}');
console.log(JSON.stringify(result));
                '''],
                cwd='/app',
                capture_output=True,
                text=True
            )
            assert result.returncode == 0, f"Function failed for {lang}: {result.stderr}"
            msg_data = json.loads(result.stdout.strip())
            assert 'message' in msg_data, f"Missing message for {lang}"
            assert 'keyboard' in msg_data, f"Missing keyboard for {lang}"


# ============================================================================
# SECTION 4: Phone Verification Status Tests (Item 16)
# ============================================================================

class TestPhoneVerificationStatus:
    """Test phone verification status message with time elapsed"""
    
    def test_phone_verification_message_format(self):
        """Test that phone verification message shows time elapsed + status"""
        result = subprocess.run(
            ['node', '-e', '''
const { getPhoneVerificationMessage } = require('./js/improved-messages.js');
const result = getPhoneVerificationMessage('+14155551234', 3, 'en');
console.log(JSON.stringify(result));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Function failed: {result.stderr}"
        msg_data = json.loads(result.stdout.strip())
        
        message = msg_data['message']
        assert 'Verification' in message, "Missing verification title"
        assert '+14155551234' in message, "Missing phone number"
        assert '3 hours ago' in message, "Missing time elapsed"
        assert 'Refresh' in str(msg_data['keyboard']), "Missing refresh button"


# ============================================================================
# SECTION 5: Smart Recommendations Tests (Item 17)
# ============================================================================

class TestSmartRecommendations:
    """Test smart recommendations after purchases"""
    
    def test_domain_recommendations(self):
        """Test recommendations after domain purchase include hosting/email/shortener"""
        result = subprocess.run(
            ['node', '-e', '''
const { getRecommendationsAfterDomain } = require('./js/smart-recommendations.js');
const result = getRecommendationsAfterDomain('example.com', 'en');
console.log(JSON.stringify(result));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Function failed: {result.stderr}"
        rec_data = json.loads(result.stdout.strip())
        
        message = rec_data['message']
        assert 'Domain Registered' in message or 'example.com' in message, "Missing domain confirmation"
        assert 'Hosting' in message, "Missing hosting recommendation"
        assert 'Email' in message, "Missing email recommendation"
        assert 'Shortener' in message or 'short links' in message.lower(), "Missing shortener recommendation"
        
        # Check keyboard has action buttons
        keyboard = rec_data['keyboard']
        flat_keyboard = [btn for row in keyboard for btn in row]
        assert any('Hosting' in btn or 'Recommended' in btn for btn in flat_keyboard), "Missing action buttons"


# ============================================================================
# SECTION 6: Progress Tracker Tests (Items 10-11)
# ============================================================================

class TestProgressTracker:
    """Test progress tracker functionality"""
    
    def test_progress_tracker_creation(self):
        """Test that progress tracker can be created with steps"""
        result = subprocess.run(
            ['node', '-e', '''
const { createProgressTracker } = require('./js/progress-tracker.js');
// Mock bot object
const mockBot = {
    sendMessage: async () => ({ message_id: 123 }),
    editMessageText: async () => {}
};
const tracker = createProgressTracker(mockBot, 12345, 'VPS Setup', [
    'Creating instance',
    'Assigning IP address',
    'Installing OS',
    'Configuring access',
    'Finalizing setup'
]);
console.log(JSON.stringify({
    totalSteps: tracker.totalSteps,
    operation: tracker.operation,
    stepsCount: tracker.steps.length
}));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Creation failed: {result.stderr}"
        tracker_data = json.loads(result.stdout.strip())
        
        assert tracker_data['totalSteps'] == 5, "Wrong total steps"
        assert tracker_data['operation'] == 'VPS Setup', "Wrong operation name"
        assert tracker_data['stepsCount'] == 5, "Wrong steps count"


# ============================================================================
# SECTION 7: DNS Status Checker Tests (Item 12)
# ============================================================================

class TestDNSStatusChecker:
    """Test DNS status checker functionality"""
    
    def test_dns_status_format(self):
        """Test that DNS status is formatted correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const { formatDNSStatus } = require('./js/dns-status-checker.js');
const mockResults = {
    domain: 'example.com',
    nameservers: { status: 'configured', details: ['ns1.example.com', 'ns2.example.com'] },
    aRecord: { status: 'configured', ip: '192.168.1.1' },
    propagationPercent: 75,
    estimatedTime: '5-10 minutes',
    propagationChecks: [
        { server: 'Google', status: 'propagated' },
        { server: 'Cloudflare', status: 'propagated' },
        { server: 'OpenDNS', status: 'pending' },
        { server: 'Quad9', status: 'propagated' }
    ]
};
const formatted = formatDNSStatus(mockResults, 'en');
console.log(formatted);
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Format failed: {result.stderr}"
        output = result.stdout.strip()
        
        assert 'DNS Status' in output, "Missing title"
        assert 'example.com' in output, "Missing domain"
        assert 'Nameservers' in output, "Missing nameservers section"
        assert '75%' in output, "Missing propagation percentage"
        assert 'Google' in output, "Missing DNS server check"


# ============================================================================
# SECTION 8: Session Recovery Tests (Item 7)
# ============================================================================

class TestSessionRecovery:
    """Test session recovery functionality"""
    
    def test_resume_prompt_generation(self):
        """Test that resume prompt is generated correctly"""
        result = subprocess.run(
            ['node', '-e', '''
const { generateResumePrompt } = require('./js/session-recovery.js');
const mockSession = {
    flowType: 'domain-purchase',
    step: 'payment',
    data: { domain: 'example.com', amount: 15.99 }
};
const result = generateResumePrompt(mockSession, 'en');
console.log(JSON.stringify(result));
            '''],
            cwd='/app',
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Generation failed: {result.stderr}"
        prompt_data = json.loads(result.stdout.strip())
        
        message = prompt_data['message']
        assert 'Welcome back' in message, "Missing welcome message"
        assert 'Domain Purchase' in message, "Missing flow type"
        assert 'example.com' in message, "Missing domain details"
        
        keyboard = prompt_data['keyboard']
        flat_keyboard = [btn for row in keyboard for btn in row]
        assert any('Resume' in btn for btn in flat_keyboard), "Missing resume button"
        assert any('Fresh' in btn or 'Start' in btn for btn in flat_keyboard), "Missing start fresh button"


# ============================================================================
# SECTION 9: Integration Tests - _index.js Imports
# ============================================================================

class TestIndexJsIntegration:
    """Test that _index.js properly imports and uses utility modules"""
    
    def test_transaction_id_imported(self):
        """Test that transaction-id.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./transaction-id.js')" in content, "transaction-id.js not imported"
        assert "generateTransactionId" in content, "generateTransactionId not used"
        assert "logTransaction" in content, "logTransaction not used"
    
    def test_improved_messages_imported(self):
        """Test that improved-messages.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./improved-messages.js')" in content, "improved-messages.js not imported"
        assert "getInsufficientBalanceMessage" in content, "getInsufficientBalanceMessage not used"
    
    def test_progress_tracker_imported(self):
        """Test that progress-tracker.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./progress-tracker.js')" in content, "progress-tracker.js not imported"
        assert "createProgressTracker" in content, "createProgressTracker not used"
    
    def test_error_handler_imported(self):
        """Test that error-handler.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./error-handler.js')" in content, "error-handler.js not imported"
        assert "handleError" in content, "handleError not used"
        assert "safeRefund" in content, "safeRefund not used"
    
    def test_order_history_imported(self):
        """Test that order-history.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./order-history.js')" in content, "order-history.js not imported"
        assert "handleOrderHistory" in content, "handleOrderHistory not used"
        assert "/orderhistory" in content, "orderhistory command not implemented"
    
    def test_onboarding_imported(self):
        """Test that onboarding.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./onboarding.js')" in content, "onboarding.js not imported"
        assert "hasCompletedOnboarding" in content, "hasCompletedOnboarding not used"
        assert "showOnboarding" in content, "showOnboarding not used"
    
    def test_smart_recommendations_imported(self):
        """Test that smart-recommendations.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./smart-recommendations.js')" in content, "smart-recommendations.js not imported"
        assert "getRecommendationsAfterDomain" in content, "getRecommendationsAfterDomain not used"
    
    def test_dns_status_checker_imported(self):
        """Test that dns-status-checker.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./dns-status-checker.js')" in content, "dns-status-checker.js not imported"
        assert "checkDNSStatus" in content, "checkDNSStatus not used"
        assert "formatDNSStatus" in content, "formatDNSStatus not used"
    
    def test_session_recovery_imported(self):
        """Test that session-recovery.js is imported in _index.js"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        assert "require('./session-recovery.js')" in content, "session-recovery.js not imported"
        assert "getResumableSession" in content, "getResumableSession not used"
        assert "generateResumePrompt" in content, "generateResumePrompt not used"


# ============================================================================
# SECTION 10: Transaction ID in Success Messages Tests
# ============================================================================

class TestTransactionIdInMessages:
    """Test that transaction IDs appear in success messages"""
    
    def test_phone_wallet_purchase_has_txn_id(self):
        """Test phone purchase via wallet includes transaction ID in message"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        # Check for transaction ID in phone wallet purchase flow (around line 6759-6785)
        assert "Transaction ID:" in content, "Transaction ID label not found"
        assert "<code>${txnId}</code>" in content, "Transaction ID code block not found"
        assert "Quote this ID when contacting support" in content, "Support instruction not found"
    
    def test_vps_purchase_has_txn_id(self):
        """Test VPS purchase includes transaction ID in message"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        # Check VPS success message includes transaction ID (around line 22816-22836)
        # The buyVPSPlanFullProcess function is defined around line 22735
        vps_start = content.find('const buyVPSPlanFullProcess')
        vps_section = content[vps_start:vps_start + 8000]
        assert "txnId" in vps_section, "Transaction ID not generated in VPS flow"
        assert "Transaction ID:" in vps_section, "Transaction ID not shown in VPS success message"
    
    def test_domain_purchase_has_txn_id(self):
        """Test domain purchase includes transaction ID in message"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        # Check domain success message includes transaction ID (around line 22385)
        domain_section = content[content.find('domainBoughtSuccess'):content.find('domainBoughtSuccess') + 500]
        assert "txnId" in domain_section, "Transaction ID not in domain success message"
    
    def test_wallet_topup_has_txn_id(self):
        """Test wallet top-up includes transaction ID in message"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        # Check wallet top-up includes transaction ID (around line 25611-25628)
        # Search for the DynoPay wallet webhook section
        wallet_start = content.find("// Generate transaction ID for wallet top-up")
        if wallet_start == -1:
            # Fallback: search for the actual txnId generation near confirmationDepositMoney
            wallet_start = content.find("confirmationDepositMoney") - 200
        wallet_section = content[wallet_start:wallet_start + 500]
        assert "txnId" in wallet_section, "Transaction ID not in wallet top-up message"


# ============================================================================
# SECTION 11: Error Handler Admin Notification Tests (Items 18-21)
# ============================================================================

class TestErrorHandlerNotifications:
    """Test that critical errors notify admin"""
    
    def test_email_validation_refund_notifies_admin(self):
        """Test email validation refund failure notifies admin"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        # Check for safeRefund usage in email validation (around line 9133)
        assert "safeRefund" in content, "safeRefund not used"
        assert "email_validation_refund" in content, "email_validation_refund operation not tracked"
    
    def test_anti_red_deployment_notifies_admin(self):
        """Test Anti-Red deployment failure notifies admin"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        # Check for handleError in Anti-Red deployment (around line 8396)
        assert "anti_red_deployment" in content, "anti_red_deployment operation not tracked"
        assert "TELEGRAM_ADMIN_CHAT_ID" in content, "Admin notification not configured"
    
    def test_vps_cancel_notifies_admin(self):
        """Test VPS cancellation failure sends URGENT admin alert"""
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        # Check for URGENT notification in VPS cancel (around line 22569)
        assert "URGENT" in content, "URGENT alert not found"
        assert "VPS Cancel FAILED" in content or "VPS Cancel CRASH" in content, "VPS cancel failure alert not found"


# ============================================================================
# SECTION 12: Hosting Progress Tracker Integration Test
# ============================================================================

class TestHostingProgressTracker:
    """Test hosting flow uses progress tracker"""
    
    def test_hosting_flow_has_progress_tracker(self):
        """Test cr-register-domain-&-create-cpanel.js uses progress tracker"""
        with open('/app/js/cr-register-domain-&-create-cpanel.js', 'r') as f:
            content = f.read()
        assert "createProgressTracker" in content, "Progress tracker not used in hosting flow"
        assert "progress.startStep" in content, "Progress steps not tracked"
        assert "progress.completeStep" in content, "Progress completion not tracked"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
