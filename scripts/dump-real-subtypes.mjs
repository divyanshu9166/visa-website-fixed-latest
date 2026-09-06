import https from 'https';

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
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

async function dump() {
  const forms = ['i-129', 'i-539', 'i-765', 'i-485', 'i-140', 'i-131', 'i-90', 'n-400', 'i-526', 'i-829'];
  for (const f of forms) {
    const data = await fetchJson(`https://immigrationtimes.org/api/v1/${f}.json`);
    console.log(`\n============================= FORM: ${f} =============================`);
    console.log(`last_updated: ${data.last_updated}, total office entries: ${data.offices?.length}`);
    const seen = new Set();
    for (const o of (data.offices || [])) {
      const key = `${o.office_code} | ${o.subtype} | ${o.subtype_info}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.log(`[${o.office_code}] subtype: "${o.subtype}" | info: "${o.subtype_info}" | lower: ${o.lower_months}, upper: ${o.upper_months}, SRD: ${o.service_request_date}`);
      }
    }
  }
}

dump().catch(console.error);
