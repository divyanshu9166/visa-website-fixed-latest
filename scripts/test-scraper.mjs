import { fetchWithBypass } from './lib/fetchClient.mjs';

async function testEndpoint(name, url, isJson = false) {
  console.log(`\n========================================`);
  console.log(`Testing: ${name}`);
  console.log(`URL: ${url}`);
  const start = Date.now();
  try {
    const res = await fetchWithBypass(url, { isJson, renderJs: false, timeout: 15000 });
    const elapsed = Date.now() - start;
    if (isJson) {
      console.log(`✅ SUCCESS (${elapsed}ms) -> Parsed JSON successfully. Keys:`, Object.keys(res).slice(0, 5));
    } else {
      const length = typeof res === 'string' ? res.length : 0;
      const title = res.match(/<title>([^<]*)<\/title>/i)?.[1] || 'No <title>';
      console.log(`✅ SUCCESS (${elapsed}ms) -> Length: ${length} bytes | Title: "${title.trim()}"`);
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`❌ FAILED (${elapsed}ms) -> Error: ${err.message}`);
  }
}

async function main() {
  console.log('--- Universal Fetch Client Diagnostic ---');
  console.log('Proxy/API Key Status:');
  console.log('  ZENROWS_API_KEY / SCRAPER_API_KEY:', process.env.ZENROWS_API_KEY || process.env.SCRAPER_API_KEY ? 'Present' : 'Not set (using direct browser)');
  console.log('  SCRAPINGBEE_API_KEY:', process.env.SCRAPINGBEE_API_KEY ? 'Present' : 'Not set');
  console.log('  SCRAPERAPI_KEY:', process.env.SCRAPERAPI_KEY ? 'Present' : 'Not set');

  // Test 1: DOL Performance
  await testEndpoint('Department of Labor (H-1B Disclosures)', 'https://www.dol.gov/agencies/eta/foreign-labor/performance');

  // Test 2: USCIS Quarterly Open Data Landing Page
  await testEndpoint('USCIS Quarterly Reports', 'https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data');

  // Test 3: USCIS Processing Times API
  await testEndpoint('USCIS Live Processing Times API', 'https://egov.uscis.gov/processing-times/api/form/i-129', true);

  // Test 4: DOS Visa Bulletin
  await testEndpoint('DOS Visa Bulletin (State Dept)', 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/2026/visa-bulletin-for-september-2026.html');

  // Test 5: DOS Consular Wait Times
  await testEndpoint('DOS Consular Wait Times Database', 'https://travel.state.gov/content/travel/resources/database/database.getVisaWaitTimes.html?cid=P147&aid=VisaWaitTimesHomePage');
}

main();
