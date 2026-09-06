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
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, error: e.message });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function run() {
  const formsListRes = await fetchJson('https://immigrationtimes.org/api/v1/forms.json');
  console.log('Forms available on API:', formsListRes.data);

  const neededForms = [
    'i-129',
    'i-539',
    'i-765',
    'i-140',
    'i-485',
    'i-131',
    'i-90',
    'n-400',
    'i-526',
    'i-829'
  ];

  for (const f of neededForms) {
    const res = await fetchJson(`https://immigrationtimes.org/api/v1/${f}.json`);
    console.log(`\n=== Form ${f} === (Status: ${res.status})`);
    if (res.data) {
      console.log('last_updated:', res.data.last_updated);
      console.log('processing_time:', res.data.processing_time);
      console.log('offices count:', res.data.offices?.length);
      console.log('office_aggregates count:', res.data.office_aggregates?.length);
      if (res.data.offices && res.data.offices.length > 0) {
        console.log('Sample office entries (first 3):', JSON.stringify(res.data.offices.slice(0, 3), null, 2));
        const subtypes = [...new Set(res.data.offices.map(o => `${o.office_code} | ${o.subtype} | ${o.subtype_info}`))];
        console.log('Unique subtypes sample:', subtypes.slice(0, 10));
      }
    } else {
      console.log('Error/Status:', res.status, res.error);
    }
  }
}

run();
