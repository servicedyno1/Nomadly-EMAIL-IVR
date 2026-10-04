/**
 * Unit tests for inactive_released number detection and cleanup
 * Run: node tests/inactive-released.test.js
 */

const phoneConfig = require('../../js/phone-config.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}`); }
}

// ── Test 1: myNumbersList shows inactive_released status ──
console.log('\n=== Test 1: myNumbersList shows inactive_released badge ===');
{
  const txt = phoneConfig.getTxt('en');
  const nums = [
    { phoneNumber: '+11111111111', status: 'active', plan: 'pro', expiresAt: '2026-12-01T00:00:00Z' },
    { phoneNumber: '+12222222222', status: 'inactive_released', plan: 'pro', expiresAt: '2026-12-01T00:00:00Z', _inactiveSince: new Date(Date.now() - 6 * 3600000).toISOString() },
  ];
  const result = txt.myNumbersList(nums);
  assert(result.includes('Active'), 'Active number shows Active');
  assert(result.includes('Inactive (released by provider)'), 'Released number shows Inactive badge');
  assert(result.includes('Auto-removal in'), 'Shows auto-removal countdown');
  assert(result.includes('Contact support'), 'Shows support hint');
}

// ── Test 2: manageNumber returns early for inactive_released ──
console.log('\n=== Test 2: manageNumber returns early with warning ===');
{
  const txt = phoneConfig.getTxt('en');
  const num = { phoneNumber: '+12222222222', status: 'inactive_released', plan: 'pro', planPrice: 25, expiresAt: '2026-12-01T00:00:00Z', _inactiveSince: new Date(Date.now() - 10 * 3600000).toISOString(), capabilities: { voice: true } };
  const result = txt.manageNumber(num, 0, 3, [num]);
  assert(result.includes('INACTIVE — Released by Provider'), 'Shows INACTIVE header');
  assert(result.includes('removed by the telecom provider'), 'Explains provider removal');
  assert(!result.includes('Inbound Minutes'), 'Does NOT show usage stats (early return)');
  assert(!result.includes('Call Forwarding'), 'Does NOT show feature controls');
}

// ── Test 3: 48-hour countdown calculation ──
console.log('\n=== Test 3: Hours-left countdown ===');
{
  const txt = phoneConfig.getTxt('en');
  // Set inactiveSince to 24h ago → should show ~24h left
  const num24h = { phoneNumber: '+13333333333', status: 'inactive_released', plan: 'starter', expiresAt: '2026-12-01T00:00:00Z', _inactiveSince: new Date(Date.now() - 24 * 3600000).toISOString() };
  const list24 = txt.myNumbersList([num24h]);
  assert(list24.includes('~24h'), '24h elapsed → shows ~24h remaining');

  // Set inactiveSince to 47h ago → should show ~1h left
  const num47h = { phoneNumber: '+14444444444', status: 'inactive_released', plan: 'starter', expiresAt: '2026-12-01T00:00:00Z', _inactiveSince: new Date(Date.now() - 47 * 3600000).toISOString() };
  const list47 = txt.myNumbersList([num47h]);
  assert(list47.includes('~1h'), '47h elapsed → shows ~1h remaining');
}

// ── Test 4: All languages render without errors ──
console.log('\n=== Test 4: All languages render without error ===');
{
  const num = { phoneNumber: '+15555555555', status: 'inactive_released', plan: 'pro', planPrice: 25, expiresAt: '2026-12-01T00:00:00Z', _inactiveSince: new Date().toISOString(), capabilities: { voice: true } };
  for (const lang of ['en', 'fr', 'zh', 'hi']) {
    const txt = phoneConfig.getTxt(lang);
    try {
      const list = txt.myNumbersList([num]);
      const manage = txt.manageNumber(num, 0, 3, [num]);
      assert(typeof list === 'string' && list.length > 0, `${lang}: myNumbersList renders`);
      assert(typeof manage === 'string' && manage.length > 0, `${lang}: manageNumber renders`);
    } catch (e) {
      assert(false, `${lang}: THREW ERROR - ${e.message}`);
    }
  }
}

// ── Test 5: Active numbers are not affected ──
console.log('\n=== Test 5: Active numbers unaffected ===');
{
  const txt = phoneConfig.getTxt('en');
  const activeNum = { phoneNumber: '+16666666666', status: 'active', plan: 'pro', planPrice: 75, expiresAt: '2026-12-01T00:00:00Z', capabilities: { voice: true, sms: true } };
  const manage = txt.manageNumber(activeNum, 0, 3, [activeNum]);
  assert(manage.includes('✅ Active'), 'Active number shows correct status');
  assert(manage.includes('Inbound Minutes'), 'Active number shows usage stats');
  assert(!manage.includes('INACTIVE'), 'Active number does NOT show INACTIVE');
}

console.log(`\n${'='.repeat(40)}\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
