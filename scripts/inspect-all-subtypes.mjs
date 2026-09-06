import https from 'https';

function fetchJson(urlStr) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function run() {
  const forms = ['i-129', 'i-539', 'i-765', 'i-140', 'i-485', 'i-131', 'i-90', 'n-400', 'i-526', 'i-829'];
  for (const f of forms) {
    const data = await fetchJson(`https://immigrationtimes.org/api/v1/${f}.json`);
    console.log(`\n=================== ${f} ===================`);
    console.log('Offices (unique subtypes):');
    const seen = new Set();
    for (const o of (data.offices || [])) {
      const key = `${o.office_code} | ${o.subtype} | ${o.subtype_info}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.log(`  [${o.office_code}] ${o.subtype}: ${o.subtype_info} -> ${o.lower_months} - ${o.upper_months} mos (SRD: ${o.service_request_date})`);
      }
    }
  }
}

run();
