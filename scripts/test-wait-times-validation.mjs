import { validateDatabasePayload, parseWaitDays } from './lib/waitTimes.mjs';

function runValidationTests() {
  console.log('=== Testing DOS Consular Wait Times Body Validation Rules ===');

  // Test 1: Valid machine payload
  const validPayload = '120 Days | 15 Days | 30 Days | 5 Days';
  const res1 = validateDatabasePayload(validPayload);
  console.log('Test 1 (Valid Pipe String):', res1.valid ? 'PASSED ✅' : 'FAILED ❌', res1);

  // Test 2: WAF Challenge HTML returned with HTTP 200
  const wafChallengePayload = '<html><head><title>Just a moment...</title></head><body><div class="cf-turnstile">Please verify you are human</div></body></html>';
  const res2 = validateDatabasePayload(wafChallengePayload);
  console.log('Test 2 (WAF Challenge HTML Rejection):', !res2.valid ? 'PASSED ✅' : 'FAILED ❌', res2.error);

  // Test 3: Access Denied HTML returned with HTTP 200
  const accessDeniedPayload = '<!DOCTYPE html><html><body><h1>Access Denied</h1><p>You do not have permission to access this server.</p></body></html>';
  const res3 = validateDatabasePayload(accessDeniedPayload);
  console.log('Test 3 (Access Denied HTML Rejection):', !res3.valid ? 'PASSED ✅' : 'FAILED ❌', res3.error);

  // Test 4: Insufficient pipe segments
  const malformedPayload = '120 Days';
  const res4 = validateDatabasePayload(malformedPayload);
  console.log('Test 4 (Insufficient Segments Rejection):', !res4.valid ? 'PASSED ✅' : 'FAILED ❌', res4.error);

  // Test 5: Number parsing
  const days1 = parseWaitDays('120 Days');
  const days2 = parseWaitDays('Same Day');
  const days3 = parseWaitDays('N/A');
  console.log('Test 5 (Wait Days Parsing):', (days1 === 120 && days2 === 0 && days3 === -1) ? 'PASSED ✅' : 'FAILED ❌', { days1, days2, days3 });

  const allPassed = res1.valid && !res2.valid && !res3.valid && !res4.valid && (days1 === 120 && days2 === 0 && days3 === -1);
  console.log('----------------------------------------------------------');
  console.log('All Validation Tests Passed:', allPassed ? 'YES ✅' : 'NO ❌');
  if (!allPassed) {
    process.exit(1);
  }
}

runValidationTests();
