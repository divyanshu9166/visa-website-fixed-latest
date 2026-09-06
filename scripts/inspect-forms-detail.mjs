import https from 'https';

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    https.get({
      hostname: url.hostname,
      path: url.pathname,
      headers: { 'User-Agent': 'EasyVisaCheck-Bot/1.0', 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function inspect() {
  const formsToInspect = ['i-129', 'i-140', 'i-485', 'i-765', 'i-539', 'i-131', 'n-400'];
  for (const f of formsToInspect) {
    const data = await fetchJson(`https://immigrationtimes.org/api/v1/${f}.json`);
    console.log(`\n=== FORM: ${f} ===`);
    console.log('last_updated:', data.last_updated);
    console.log('processing_time summary:', data.processing_time);
    console.log('office_aggregates count:', data.office_aggregates?.length);
    console.log('office_aggregates sample:', data.office_aggregates?.slice(0, 3));
    console.log('offices count:', data.offices?.length);
    console.log('offices sample (first 3):', JSON.stringify(data.offices?.slice(0, 3), null, 2));
  }
}

inspect().catch(console.error);
