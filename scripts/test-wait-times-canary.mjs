import { runCanaryDiagnostic } from './lib/waitTimes.mjs';

async function main() {
  console.log('=== Starting DOS Consular Wait Times Canary Diagnostic ===');
  console.log('Target: New Delhi (cid=P147)');
  console.log('Endpoint: https://travel.state.gov/content/travel/resources/database/database.getVisaWaitTimes.html?cid=P147&aid=VisaWaitTimesHomePage');
  console.log('Open Source Reference: https://github.com/missuo/USVisaWaitTimes');
  console.log('----------------------------------------------------------');

  const result = await runCanaryDiagnostic('New Delhi', 'P147');
  console.log('----------------------------------------------------------');
  console.log('Diagnostic Result:', JSON.stringify(result, null, 2));

  if (result.parsed) {
    console.log('✅ Canary verification successful! Machine endpoint returned valid wait times.');
  } else {
    console.log('ℹ️ Canary verification failed (expected when direct or proxy access blocked). Fallback to September 1, 2026 snapshot preserved.');
  }
}

main().catch(console.error);
