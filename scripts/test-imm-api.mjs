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
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, headers: res.headers, parsed, rawLength: data.length });
        } catch (e) {
          resolve({ statusCode: res.statusCode, headers: res.headers, error: e.message, raw: data.slice(0, 1000) });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function testApi() {
  console.log('Testing /api/v1/forms.json...');
  const forms = await fetchJson('https://immigrationtimes.org/api/v1/forms.json');
  console.log('forms.json status:', forms.statusCode);
  if (forms.parsed) {
    console.log('Forms count:', Array.isArray(forms.parsed) ? forms.parsed.length : Object.keys(forms.parsed).length);
    console.log('Sample forms:', JSON.stringify(Array.isArray(forms.parsed) ? forms.parsed.slice(0, 3) : forms.parsed, null, 2).slice(0, 1000));
  } else {
    console.log('Error/raw:', forms.raw || forms.error);
  }

  console.log('\nTesting /api/v1/i-129.json (H-1B / L-1 / O-1)...');
  const i129 = await fetchJson('https://immigrationtimes.org/api/v1/i-129.json');
  console.log('i-129.json status:', i129.statusCode, 'data size:', i129.rawLength);
  if (i129.parsed) {
    console.log('Keys in i-129:', Object.keys(i129.parsed));
    console.log('i-129 preview (first 1500 chars):', JSON.stringify(i129.parsed, null, 2).slice(0, 1500));
  } else {
    console.log('Error/raw:', i129.raw || i129.error);
  }

  console.log('\nTesting /api/v1/i-140.json...');
  const i140 = await fetchJson('https://immigrationtimes.org/api/v1/i-140.json');
  console.log('i-140.json status:', i140.statusCode, 'data size:', i140.rawLength);
  if (i140.parsed) {
    console.log('Keys in i-140:', Object.keys(i140.parsed));
    console.log('i-140 preview (first 1000 chars):', JSON.stringify(i140.parsed, null, 2).slice(0, 1000));
  }

  console.log('\nTesting /api/v1/i-485.json...');
  const i485 = await fetchJson('https://immigrationtimes.org/api/v1/i-485.json');
  console.log('i-485.json status:', i485.statusCode, 'data size:', i485.rawLength);
  if (i485.parsed) {
    console.log('Keys in i-485:', Object.keys(i485.parsed));
    console.log('i-485 preview (first 1000 chars):', JSON.stringify(i485.parsed, null, 2).slice(0, 1000));
  }
}

testApi();
