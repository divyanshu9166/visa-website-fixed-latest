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
      res.on('data', c => data += c);
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

async function check() {
  const configs = {
    'h1b-visa': { api: 'i-129', filter: o => ['137-H1B1', '137-H1B2', '137-H1B3'].includes(o.subtype) },
    'l1-visa': { api: 'i-129', filter: o => o.subtype === '137-L' },
    'o1-visa': { api: 'i-129', filter: o => o.subtype === '137-O' },
    'h4-visa': { api: 'i-539', filter: o => ['139A-H', '139AC-H', '139B-H', '139BC-H'].includes(o.subtype) },
    'l2-visa': { api: 'i-539', filter: o => ['139A-L', '139B-L'].includes(o.subtype) },
    'h4-ead': { api: 'i-765', filter: o => ['147-539C26', '147-C26'].includes(o.subtype) },
    'opt-ead': { api: 'i-765', filter: o => o.subtype === '147-C3' },
    'i485-ead': { api: 'i-765', filter: o => o.subtype === '147-C9' },
    'i-140': { api: 'i-140', filter: o => o.subtype.startsWith('136A-') },
    'i-485-eb': { api: 'i-485', filter: o => o.subtype === '131A' },
    'i-485-family': { api: 'i-485', filter: o => o.subtype === '131A-FAM' },
    'i-131': { api: 'i-131', filter: o => o.subtype.startsWith('141') },
    'i-90': { api: 'i-90', filter: o => o.subtype.startsWith('140') },
    'n-400': { api: 'n-400', filter: o => o.subtype === '160A' },
    'i-526': { api: 'i-526', filter: o => o.subtype === '133IP' },
    'i-829': { api: 'i-829', filter: o => o.subtype === '148C' },
  };

  const cache = {};
  for (const [slug, conf] of Object.entries(configs)) {
    if (!cache[conf.api]) {
      cache[conf.api] = await fetchJson('https://immigrationtimes.org/api/v1/' + conf.api + '.json');
    }
    const matched = (cache[conf.api].offices || []).filter(conf.filter);
    console.log(`\n[${slug}] matches: ${matched.length} (API Form: ${conf.api})`);
    matched.slice(0, 3).forEach(m => {
      console.log(`  -> Office: ${m.office_code} | Subtype: "${m.subtype}" | Info: "${m.subtype_info}" | Range: ${m.lower_months}-${m.upper_months} mo | SRD: ${m.service_request_date}`);
    });
  }
}

check().catch(console.error);
