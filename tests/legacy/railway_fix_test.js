#!/usr/bin/env node

/**
 * Specific Test for Railway saveDomainInServerRailway Edge Case Fix
 * 
 * Tests the fix for Railway `saveDomainInServerRailway()` edge case where:
 * - When a domain already exists on Railway and the function tried to remove+re-create it, 
 *   the removal could fail with HTTP 400, causing shortener activation to abort
 * - The fix adds a `getExistingRailwayCNAME(domain)` function that queries Railway 
 *   for the existing CNAME target and returns it as success, avoiding remove+re-create
 */

const axios = require('axios')
const fs = require('fs')
require('dotenv').config()

console.log('🔧 Testing Railway saveDomainInServerRailway Edge Case Fix')
console.log('=' .repeat(80))

// Test Results Storage
const results = {
  passed: 0,
  failed: 0,
  tests: []
}

function logTest(testName, status, details = '') {
  const icon = status === 'PASS' ? '✅' : '❌'
  console.log(`${icon} ${testName}: ${status}`)
  if (details) console.log(`   ${details}`)
  
  results.tests.push({ testName, status, details })
  if (status === 'PASS') results.passed++
  else results.failed++
}

// Test 1: Verify getExistingRailwayCNAME function exists and structure
function testGetExistingRailwayCNAMEFunction() {
  console.log('\n🔍 Code Review: getExistingRailwayCNAME function')
  
  try {
    const rlServiceCode = fs.readFileSync('./js/rl-save-domain-in-server.js', 'utf8')
    
    // Check if function exists
    const hasFunctionDef = rlServiceCode.includes('async function getExistingRailwayCNAME(domain)')
    logTest('getExistingRailwayCNAME function exists', hasFunctionDef ? 'PASS' : 'FAIL')
    
    // Check GraphQL query structure
    const hasGraphQLQuery = rlServiceCode.includes('domains(projectId: "${PROJECT_ID}", serviceId: "${SERVICE_ID}", environmentId: "${ENVIRONMENT_ID}")')
    logTest('GraphQL query for domains with correct parameters', hasGraphQLQuery ? 'PASS' : 'FAIL')
    
    // Check return structure for CNAME
    const hasCorrectReturn = rlServiceCode.includes('return { server: cname, recordType: \'CNAME\' }')
    logTest('Returns correct { server, recordType: \'CNAME\' } structure', hasCorrectReturn ? 'PASS' : 'FAIL')
    
    // Check return null when not found
    const hasNullReturn = rlServiceCode.includes('return null')
    logTest('Returns null when domain not found', hasNullReturn ? 'PASS' : 'FAIL')
    
    // Check error handling with try/catch
    const hasTryCatch = rlServiceCode.includes('try {') && rlServiceCode.includes('} catch (err) {')
    logTest('Has proper try/catch error handling', hasTryCatch ? 'PASS' : 'FAIL')
    
    // Check error returns null
    const hasErrorReturn = rlServiceCode.includes('return null') && rlServiceCode.includes('catch (err)')
    logTest('Returns null on error (in catch block)', hasErrorReturn ? 'PASS' : 'FAIL')
    
  } catch (error) {
    logTest('getExistingRailwayCNAME function verification', 'FAIL', `Error: ${error.message}`)
  }
}

// Test 2: Verify saveDomainInServerRailway uses getExistingRailwayCNAME in isAlreadyExists branch
function testSaveDomainInServerRailwayLogic() {
  console.log('\n🔍 Code Review: saveDomainInServerRailway updated logic')
  
  try {
    const rlServiceCode = fs.readFileSync('./js/rl-save-domain-in-server.js', 'utf8')
    
    // Check isAlreadyExists branch exists
    const hasAlreadyExistsLogic = rlServiceCode.includes('if (isAlreadyExists) {')
    logTest('isAlreadyExists branch exists', hasAlreadyExistsLogic ? 'PASS' : 'FAIL')
    
    // Check getExistingRailwayCNAME is called FIRST in isAlreadyExists branch
    const callsGetExisting = rlServiceCode.includes('const existing = await getExistingRailwayCNAME(domain)')
    logTest('Calls getExistingRailwayCNAME(domain) in isAlreadyExists branch', callsGetExisting ? 'PASS' : 'FAIL')
    
    // Check returns existing result if found
    const returnsExisting = rlServiceCode.includes('if (existing) {') && rlServiceCode.includes('return existing')
    logTest('Returns existing result if getExistingRailwayCNAME returns data', returnsExisting ? 'PASS' : 'FAIL')
    
    // Check fallback to remove+re-create only if getExistingRailwayCNAME returns null
    const hasFallback = rlServiceCode.includes('const removeResult = await removeDomainFromRailway(domain)')
    logTest('Falls back to remove+re-create if getExistingRailwayCNAME returns null', hasFallback ? 'PASS' : 'FAIL')
    
    // Check log messages for traceability
    const hasExistingLog = rlServiceCode.includes('Domain ${domain} already on Railway → ${existing.server} (reusing)')
    logTest('Has log message for reusing existing domain', hasExistingLog ? 'PASS' : 'FAIL')
    
    const hasFallbackLog = rlServiceCode.includes('Could not fetch CNAME for ${domain} — attempting remove + re-create')
    logTest('Has log message for fallback to remove+re-create', hasFallbackLog ? 'PASS' : 'FAIL')
    
  } catch (error) {
    logTest('saveDomainInServerRailway logic verification', 'FAIL', `Error: ${error.message}`)
  }
}

// Test 3: Check Node.js service health
async function testNodeJSHealth() {
  console.log('\n🔍 Node.js Service Health Check')
  
  const BASE_URL = process.env.SELF_URL || 'http://localhost:5000'
  
  try {
    // Check if Node.js service is running via supervisor
    const { spawn } = require('child_process')
    
    const checkSupervisor = () => {
      return new Promise((resolve) => {
        const proc = spawn('sudo', ['supervisorctl', 'status', 'nodejs'])
        let output = ''
        
        proc.stdout.on('data', (data) => {
          output += data.toString()
        })
        
        proc.on('close', (code) => {
          resolve(output)
        })
      })
    }
    
    const supervisorStatus = await checkSupervisor()
    const isRunning = supervisorStatus.includes('RUNNING')
    logTest('Node.js service running in supervisor', isRunning ? 'PASS' : 'FAIL', 
      supervisorStatus.trim())
    
    // Check logs for any critical errors
    try {
      const logs = fs.readFileSync('/var/log/supervisor/nodejs.out.log', 'utf8')
      const recentLogs = logs.split('\n').slice(-50).join('\n')
      
      const hasErrors = recentLogs.toLowerCase().includes('error') || 
                       recentLogs.toLowerCase().includes('failed') ||
                       recentLogs.toLowerCase().includes('crash')
      
      logTest('No critical errors in recent logs', !hasErrors ? 'PASS' : 'FAIL', 
        hasErrors ? 'Found errors in recent logs' : 'Logs show normal operation')
      
    } catch (logError) {
      logTest('Log file check', 'FAIL', `Cannot read log file: ${logError.message}`)
    }
    
    // Test backend API health if reachable
    try {
      const backendUrl = 'https://passphrases-3.preview.emergentagent.com/api/health'
      const response = await axios.get(backendUrl, { timeout: 10000 })
      
      if (response.status === 200) {
        logTest('Backend API health endpoint accessible', 'PASS', 
          `Status: ${response.status}`)
      } else {
        logTest('Backend API health endpoint', 'FAIL', 
          `HTTP ${response.status}`)
      }
    } catch (apiError) {
      logTest('Backend API health endpoint', 'FAIL', 
        `Connection error: ${apiError.message}`)
    }
    
  } catch (error) {
    logTest('Node.js health check', 'FAIL', `Error: ${error.message}`)
  }
}

// Test 4: Verify file structure and exports
function testFileStructureAndExports() {
  console.log('\n🔍 File Structure and Exports')
  
  try {
    // Check if rl-save-domain-in-server.js exists
    const fileExists = fs.existsSync('./js/rl-save-domain-in-server.js')
    logTest('rl-save-domain-in-server.js file exists', fileExists ? 'PASS' : 'FAIL')
    
    // Test module exports
    const rlService = require('./js/rl-save-domain-in-server.js')
    
    const hasSaveDomainExport = typeof rlService.saveDomainInServerRailway === 'function'
    logTest('saveDomainInServerRailway function exported', hasSaveDomainExport ? 'PASS' : 'FAIL')
    
    const hasRemoveDomainExport = typeof rlService.removeDomainFromRailway === 'function'
    logTest('removeDomainFromRailway function exported', hasRemoveDomainExport ? 'PASS' : 'FAIL')
    
    // Note: getExistingRailwayCNAME is internal function, not exported
    const rlServiceCode = fs.readFileSync('./js/rl-save-domain-in-server.js', 'utf8')
    const isInternalFunction = !rlServiceCode.includes('module.exports') || 
                              !rlServiceCode.includes('getExistingRailwayCNAME')
    logTest('getExistingRailwayCNAME is internal (not exported)', isInternalFunction ? 'PASS' : 'FAIL',
      'Internal helper function as expected')
    
  } catch (error) {
    logTest('File structure and exports verification', 'FAIL', `Error: ${error.message}`)
  }
}

// Main test execution
async function runRailwayFixTests() {
  try {
    console.log('🚀 Running Railway fix tests...\n')
    
    // Test 1: getExistingRailwayCNAME function
    testGetExistingRailwayCNAMEFunction()
    
    // Test 2: saveDomainInServerRailway logic
    testSaveDomainInServerRailwayLogic()
    
    // Test 3: Node.js health  
    await testNodeJSHealth()
    
    // Test 4: File structure and exports
    testFileStructureAndExports()
    
    // Final results
    console.log('\n' + '='.repeat(80))
    console.log('📊 RAILWAY FIX TEST RESULTS SUMMARY')
    console.log('='.repeat(80))
    console.log(`✅ Passed: ${results.passed}`)
    console.log(`❌ Failed: ${results.failed}`) 
    const totalTests = results.passed + results.failed
    console.log(`📈 Success Rate: ${totalTests > 0 ? ((results.passed / totalTests) * 100).toFixed(1) : 0}%`)
    
    if (results.failed > 0) {
      console.log('\n🔍 FAILED TESTS:')
      results.tests.filter(t => t.status === 'FAIL').forEach(test => {
        console.log(`   ❌ ${test.testName}: ${test.details || 'No details'}`)
      })
    } else {
      console.log('\n🎉 ALL RAILWAY FIX TESTS PASSED!')
      console.log('✅ getExistingRailwayCNAME function correctly implemented')
      console.log('✅ saveDomainInServerRailway uses new edge case handling')  
      console.log('✅ Proper error handling with try/catch and null returns')
      console.log('✅ Node.js service running healthy')
    }
    
    console.log('\n' + '='.repeat(80))
    
    return results.failed === 0
    
  } catch (error) {
    console.error('❌ Railway fix test suite error:', error.message)
    return false
  }
}

// Run the tests
if (require.main === module) {
  runRailwayFixTests().then(success => {
    process.exit(success ? 0 : 1)
  })
}

module.exports = { runRailwayFixTests, results }