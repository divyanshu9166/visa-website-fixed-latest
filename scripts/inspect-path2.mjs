import https from 'https';
import fs from 'fs';

function fetchFull(urlStr) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function run() {
  console.log('Fetching Mendeley...');
  const mendeley = await fetchFull('https://data.mendeley.com/datasets/krzjyk8hfx/1');
  fs.writeFileSync('./tmp/mendeley_raw.html', mendeley.data || '');
  console.log('Saved mendeley_raw.html, status:', mendeley.statusCode, 'length:', mendeley.data?.length);

  console.log('Fetching ImmigrationTimes...');
  const immTimes = await fetchFull('https://immigrationtimes.org/data/');
  fs.writeFileSync('./tmp/imm_times_raw.html', immTimes.data || '');
  console.log('Saved imm_times_raw.html, status:', immTimes.statusCode, 'length:', immTimes.data?.length);
}

run().catch(console.error);
