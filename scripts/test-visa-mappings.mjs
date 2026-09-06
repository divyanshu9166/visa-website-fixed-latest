import https from 'https';

function fetchJson(urlStr) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'EasyVisaCheck-Bot/1.0',
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

const FIELD_OFFICES = {
  ABQ: 'Albuquerque Field Office, NM', AGA: 'Agana Field Office, GU', ALB: 'Albany Field Office, NY', ANC: 'Anchorage Field Office, AK',
  ATL: 'Atlanta Field Office, GA', BAL: 'Baltimore Field Office, MD', BNY: 'Brooklyn Field Office, NY', BOI: 'Boise Field Office, ID',
  BOS: 'Boston Field Office, MA', BUF: 'Buffalo Field Office, NY', CHA: 'Charleston Field Office, SC', CHI: 'Chicago Field Office, IL',
  CHL: 'Charlotte Field Office, NC', CHR: 'Christiansted Field Office, VI', CIN: 'Cincinnati Field Office, OH', CLE: 'Cleveland Field Office, OH',
  CLM: 'Columbus Field Office, OH', CLT: 'Charlotte Field Office, NC', DAL: 'Dallas Field Office, TX', DEN: 'Denver Field Office, CO',
  DET: 'Detroit Field Office, MI', DSM: 'Des Moines Field Office, IA', ELP: 'El Paso Field Office, TX', FRE: 'Fresno Field Office, CA',
  FSA: 'Fort Smith Field Office, AR', GRR: 'Grand Rapids Field Office, MI', HAR: 'Hartford Field Office, CT', HEL: 'Helena Field Office, MT',
  HHW: 'Honolulu Field Office, HI', HIA: 'Hialeah Field Office, FL', HLG: 'Harlingen Field Office, TX', HOU: 'Houston Field Office, TX',
  IMP: 'Imperial Field Office, CA', INP: 'Indianapolis Field Office, IN', JAC: 'Jacksonville Field Office, FL', KAN: 'Kansas City Field Office, MO',
  KND: 'Kendall Field Office, FL', LAC: 'Los Angeles County Field Office, CA', LAW: 'Lawrence Field Office, MA', LNY: 'Long Island Field Office, NY',
  LOS: 'Los Angeles Field Office, CA', LOU: 'Louisville Field Office, KY', LVG: 'Las Vegas Field Office, NV', MAN: 'Manchester Field Office, NH',
  MEM: 'Memphis Field Office, TN', MGA: 'Montgomery Field Office, AL', MIA: 'Miami Field Office, FL', MIL: 'Milwaukee Field Office, WI',
  MTL: 'Mount Laurel Field Office, NJ', NEW: 'Newark Field Office, NJ', NJC: 'New Jersey City Field Office, NJ', NOL: 'New Orleans Field Office, LA',
  NOR: 'Norfolk Field Office, VA', NTN: 'Northwest Arkansas Field Office, AR', NYC: 'New York City Field Office, NY', OFM: 'Oakland Park Field Office, FL',
  OKC: 'Oklahoma City Field Office, OK', OKL: 'Oakland Field Office, CA', OMA: 'Omaha Field Office, NE', ORL: 'Orlando Field Office, FL',
  PHI: 'Philadelphia Field Office, PA', PHO: 'Phoenix Field Office, AZ', PIT: 'Pittsburgh Field Office, PA', POM: 'Pomona Field Office, CA',
  POO: 'Portland Field Office, OR', PRO: 'Providence Field Office, RI', QNS: 'Queens Field Office, NY', RAL: 'Raleigh-Durham Field Office, NC',
  REN: 'Reno Field Office, NV', SAA: 'Santa Ana Field Office, CA', SAC: 'Sacramento Field Office, CA', SAJ: 'San Jose Field Office, CA',
  SBD: 'San Bernardino Field Office, CA', SEA: 'Seattle Field Office, WA', SFR: 'San Francisco Field Office, CA', SFV: 'San Fernando Valley Field Office, CA',
  SLC: 'Salt Lake City Field Office, UT', SNA: 'San Antonio Field Office, TX', SND: 'San Diego Field Office, CA', SNJ: 'San Juan Field Office, PR',
  SPM: 'Saint Paul Field Office, MN', SPO: 'Spokane Field Office, WA', STA: 'Saint Albans Field Office, VT', STL: 'Saint Louis Field Office, MO',
  TAM: 'Tampa Field Office, FL', TUC: 'Tucson Field Office, AZ', WAS: 'Washington Field Office, DC', WIC: 'Wichita Field Office, KS',
  WPB: 'West Palm Beach Field Office, FL', YAK: 'Yakima Field Office, WA',
  SCD: 'Service Center Operations (All Centers)', NBC: 'National Benefits Center', IPO: 'Immigrant Investor Program Office',
  FOD: 'Field Operations Directorate (National Average)', CSC: 'California Service Center', NSC: 'Nebraska Service Center',
  TSC: 'Texas Service Center', VSC: 'Vermont Service Center', POS: 'Potomac Service Center'
};

function getOfficeInfo(code) {
  const name = FIELD_OFFICES[code] || (code + ' Office');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return { name, slug, code };
}

const VISA_MAPPINGS = {
  'h1b-visa': { apiForm: 'i-129', filter: o => o.subtype.startsWith('137-H1B') || o.subtype_info.includes('H-1B') },
  'l1-visa': { apiForm: 'i-129', filter: o => o.subtype === '137-L' || o.subtype_info.toLowerCase().includes('intracompany') },
  'o1-visa': { apiForm: 'i-129', filter: o => o.subtype === '137-O' || o.subtype_info.toLowerCase().includes('extraordinary') },
  'h4-visa': { apiForm: 'i-539', filter: o => o.subtype.includes('-H') || o.subtype_info.toLowerCase().includes('h4') },
  'l2-visa': { apiForm: 'i-539', filter: o => o.subtype.includes('-L') || o.subtype_info.toLowerCase().includes('l dependent') },
  'h4-ead': { apiForm: 'i-765', filter: o => o.subtype.includes('C26') || o.subtype_info.toLowerCase().includes('h-4 spouse') },
  'i-140': { apiForm: 'i-140', filter: () => true },
  'i-485-eb': { apiForm: 'i-485', filter: o => o.subtype === '131A' && o.subtype_info.toLowerCase().includes('employment') },
  'i-485-family': { apiForm: 'i-485', filter: o => o.subtype.includes('FAM') || o.subtype_info.toLowerCase().includes('family') },
  'i-131': { apiForm: 'i-131', filter: () => true },
  'i485-ead': { apiForm: 'i-765', filter: o => o.subtype.includes('C9') || o.subtype_info.toLowerCase().includes('adjustment application') },
  'opt-ead': { apiForm: 'i-765', filter: o => o.subtype === '147-C3' || o.subtype_info.toLowerCase().includes('student') || o.subtype_info.toLowerCase().includes('opt') },
  'i-90': { apiForm: 'i-90', filter: () => true },
  'n-400': { apiForm: 'n-400', filter: () => true },
  'i-526': { apiForm: 'i-526', filter: () => true },
  'i-829': { apiForm: 'i-829', filter: () => true },
};

async function testAll() {
  const cache = {};
  for (const [slug, conf] of Object.entries(VISA_MAPPINGS)) {
    if (!cache[conf.apiForm]) {
      cache[conf.apiForm] = await fetchJson(`https://immigrationtimes.org/api/v1/${conf.apiForm}.json`);
    }
    const data = cache[conf.apiForm];
    const filtered = (data.offices || []).filter(conf.filter);
    console.log(`[${slug}] -> Form ${conf.apiForm}: ${filtered.length} matching office records.`);
    if (filtered.length === 0) {
      console.error(`  ERROR: Zero matches for ${slug}!`);
    } else {
      console.log(`  Sample case: [${filtered[0].office_code}] ${filtered[0].subtype_info} -> ${filtered[0].lower_months}-${filtered[0].upper_months} mos (SRD: ${filtered[0].service_request_date})`);
    }
  }
}

testAll();
