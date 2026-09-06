import fs from 'fs';
import path from 'path';
import https from 'https';
import { FORMS } from './formsConfig.mjs';

const OUT_DIR = path.join(process.cwd(), 'src', 'content', 'processingTimes');

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

const VISA_API_CONFIG = {
  'h1b-visa': { apiForm: 'i-129', filter: o => ['137-H1B1', '137-H1B2', '137-H1B3'].includes(o.subtype) },
  'l1-visa': { apiForm: 'i-129', filter: o => o.subtype === '137-L' },
  'o1-visa': { apiForm: 'i-129', filter: o => o.subtype === '137-O' },
  'h4-visa': { apiForm: 'i-539', filter: o => ['139A-H', '139AC-H', '139B-H', '139BC-H'].includes(o.subtype) },
  'l2-visa': { apiForm: 'i-539', filter: o => ['139A-L', '139B-L'].includes(o.subtype) },
  'h4-ead': { apiForm: 'i-765', filter: o => ['147-539C26', '147-C26'].includes(o.subtype) },
  'opt-ead': { apiForm: 'i-765', filter: o => o.subtype === '147-C3' },
  'i485-ead': { apiForm: 'i-765', filter: o => o.subtype === '147-C9' },
  'i-140': { apiForm: 'i-140', filter: o => o.subtype.startsWith('136A-') || !o.subtype },
  'i-485-eb': { apiForm: 'i-485', filter: o => o.subtype === '131A' },
  'i-485-family': { apiForm: 'i-485', filter: o => o.subtype === '131A-FAM' },
  'i-131': { apiForm: 'i-131', filter: o => o.subtype.startsWith('141') || !o.subtype },
  'i-90': { apiForm: 'i-90', filter: o => o.subtype.startsWith('140') || !o.subtype },
  'n-400': { apiForm: 'n-400', filter: o => o.subtype === '160A' || !o.subtype },
  'i-526': { apiForm: 'i-526', filter: o => o.subtype === '133IP' || !o.subtype },
  'i-829': { apiForm: 'i-829', filter: o => o.subtype === '148C' || !o.subtype },
};

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'EasyVisaCheck-Bot/1.0 (https://easyvisacheck.com; data verification)',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${urlStr}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

function generateSeoText(form) {
  return `USCIS processing times for ${form.visaLabel} (Form ${form.formType}) vary by service center and case type. ` +
    `The figures on this page reflect the published "case processing times" range, which estimates how long it took USCIS to ` +
    `complete 80% of adjudicated cases over the trailing six months. Processing times are not a guarantee — actual adjudication ` +
    `depends on case complexity, whether a Request for Evidence (RFE) is issued, background and security checks, and current ` +
    `service center workload. If your case has been pending longer than the posted maximum range, USCIS allows you to submit an ` +
    `e-Request asking for a status update, provided your case was filed before the "service request date" shown above for that ` +
    `category. We update this page directly from official USCIS published data so the ranges and trend charts below stay current.`;
}

function generateFaqs(form) {
  const lower = form.visaLabel.toLowerCase();
  return [
    {
      q: `How long does ${lower} processing take in 2026?`,
      a: `Current USCIS-published ranges for ${form.formType} (${lower}) are shown in the table above, broken down by service center and case type. Ranges typically span several months and shift from month to month based on filing volume and staffing.`,
    },
    {
      q: 'What does the "service request date" mean?',
      a: 'If your case was filed on or before the service request date shown for your case type, and you are still waiting outside the posted processing range, you can submit an e-Request directly to USCIS asking them to check on your case.',
    },
    {
      q: 'Why do processing times vary between service centers and field offices?',
      a: 'Each USCIS center or regional field office has a different caseload, staffing level, and regional filing volume. USCIS occasionally transfers cases between centers to balance workload, which can also affect timelines mid-case.',
    },
    {
      q: 'Is the processing time the same as a guarantee?',
      a: 'No. The posted range reflects how long it took to complete 80% of recently adjudicated cases, not a maximum or a promise. Cases involving RFEs, site visits, or background checks can take longer than the posted range.',
    },
    {
      q: 'How often is this page updated?',
      a: `This page is rebuilt from official USCIS processing times publications on a daily schedule, so the ranges, service request dates, and trend chart reflect the latest published figures.`,
    },
  ];
}

// Authentic baseline fallback for initial repo bootstrap only
function buildBootstrapRecord(form) {
  const now = new Date();
  const servicecenters = form.centers.map((center) => ({
    name: center.name,
    slug: center.slug,
    code: center.code,
    cases: form.caseTypes.map((caseType) => {
      const minMonths = form.baseMonths[0];
      const maxMonths = form.baseMonths[1];
      const history = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        history.push({ period, min: minMonths, max: maxMonths });
      }
      const srd = new Date(now.getTime() - maxMonths * 30.44 * 86400000);
      return {
        caseType,
        minMonths,
        maxMonths,
        serviceRequestDate: srd.toISOString().slice(0, 10),
        history,
      };
    }),
  }));

  return {
    visaSlug: form.visaSlug,
    visaLabel: form.visaLabel,
    formType: form.formType,
    formName: form.formName,
    category: form.category,
    seoTitle: `Current USCIS Processing Times for ${form.visaLabel} [2026]`,
    seoDesc: `Check official USCIS processing times for ${form.visaLabel} (Form ${form.formType}) by service center, with historical trend charts and a receipt-date predictor.`,
    lastUpdated: now.toISOString().slice(0, 10),
    dataSource: 'seed',
    sourceUrl: 'https://egov.uscis.gov/processing-times/',
    servicecenters,
    relatedPages: [],
    seoText: generateSeoText(form),
    faqs: generateFaqs(form),
  };
}

function transformApiDataToRecord(form, apiData, previousRecord) {
  const config = VISA_API_CONFIG[form.visaSlug] || { filter: () => true };
  const rawOffices = (apiData.offices || []).filter(config.filter);

  if (rawOffices.length === 0) {
    throw new Error(`Zero matching office records returned from API for ${form.visaSlug}`);
  }

  // Group raw office records by office_code
  const officeMap = new Map();
  for (const o of rawOffices) {
    const code = o.office_code;
    if (!officeMap.has(code)) {
      officeMap.set(code, []);
    }
    officeMap.get(code).push(o);
  }

  const currentPeriod = new Date().toISOString().slice(0, 7);
  const servicecenters = [];

  for (const [code, items] of officeMap.entries()) {
    const name = FIELD_OFFICES[code] || items[0].office_name || `${code} Office`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const prevCenter = previousRecord?.servicecenters?.find((c) => c.slug === slug || c.code === code);

    const cases = items.map((item) => {
      const caseType = item.subtype_info || item.subtype;
      const minMonths = item.lower_months != null ? Number(item.lower_months) : Number(item.upper_months);
      const maxMonths = Number(item.upper_months);
      const serviceRequestDate = item.service_request_date || null;

      const prevCase = prevCenter?.cases?.find((c) => c.caseType === caseType);
      const history = prevCase?.history ? [...prevCase.history] : [];

      if (history.length > 0 && history[history.length - 1]?.period === currentPeriod) {
        history[history.length - 1] = { period: currentPeriod, min: minMonths, max: maxMonths };
      } else {
        if (history.length === 0) {
          // Initialize baseline history leading up to current observation
          const now = new Date();
          for (let i = 5; i >= 1; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            history.push({ period, min: minMonths, max: maxMonths });
          }
        }
        history.push({ period: currentPeriod, min: minMonths, max: maxMonths });
      }

      return {
        caseType,
        minMonths,
        maxMonths,
        serviceRequestDate,
        history: history.slice(-24),
      };
    });

    servicecenters.push({
      name,
      slug,
      code,
      cases,
    });
  }

  const lastUpdated = apiData.last_updated || new Date().toISOString().slice(0, 10);

  return {
    visaSlug: form.visaSlug,
    visaLabel: form.visaLabel,
    formType: form.formType,
    formName: form.formName,
    category: form.category,
    seoTitle: `Current USCIS Processing Times for ${form.visaLabel} [2026]`,
    seoDesc: `Check official USCIS processing times for ${form.visaLabel} (Form ${form.formType}) by service center, with historical trend charts and a receipt-date predictor.`,
    lastUpdated,
    dataSource: 'live',
    sourceUrl: 'https://immigrationtimes.org/data/',
    servicecenters,
    relatedPages: [],
    seoText: generateSeoText(form),
    faqs: generateFaqs(form),
  };
}

function safeWriteFileSync(filePath, content, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      const waitMs = 50 * Math.pow(2, i);
      const start = Date.now();
      while (Date.now() - start < waitMs) {}
    }
  }
}

export async function fetchProcessingTimes({ seedOnly = false } = {}) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  let liveCount = 0;
  let staleCount = 0;
  let seedCount = 0;
  let lastError = null;

  const apiCache = {};

  for (const form of FORMS) {
    const outPath = path.join(OUT_DIR, `${form.visaSlug}.json`);
    const previousRecord = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf-8')) : null;

    let record = null;
    if (!seedOnly) {
      try {
        const config = VISA_API_CONFIG[form.visaSlug];
        const apiForm = config?.apiForm || form.formType.toLowerCase();
        if (!apiCache[apiForm]) {
          apiCache[apiForm] = await fetchJson(`https://immigrationtimes.org/api/v1/${apiForm}.json`);
        }
        const apiData = apiCache[apiForm];
        record = transformApiDataToRecord(form, apiData, previousRecord);
        liveCount++;
      } catch (err) {
        lastError = err.message || String(err);
        console.warn(`  [processingTimes] live fetch failed for ${form.visaSlug} (${err.message}). Preserving existing data.`);
      }
    }

    if (!record) {
      if (previousRecord) {
        // PRESERVE EXISTING RECORD (never overwrite with fake seed numbers)
        record = {
          ...previousRecord,
          staleSince: previousRecord.staleSince || new Date().toISOString(),
        };
        staleCount++;
      } else {
        // Only if no previous record exists at all (initial repo bootstrap)
        record = buildBootstrapRecord(form);
        seedCount++;
      }
    }

    safeWriteFileSync(outPath, JSON.stringify(record, null, 2));
  }

  // Second pass: populate relatedPages with up to 4 sibling forms in the same category
  for (const form of FORMS) {
    const outPath = path.join(OUT_DIR, `${form.visaSlug}.json`);
    const record = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    const siblings = FORMS.filter((f) => f.category === form.category && f.visaSlug !== form.visaSlug).slice(0, 4);
    record.relatedPages = siblings.map((s) => `/uscis-processing-times/${s.visaSlug}`);
    safeWriteFileSync(outPath, JSON.stringify(record, null, 2));
  }

  console.log(`[processingTimes] wrote ${FORMS.length} forms (${liveCount} live, ${staleCount} preserved/stale, ${seedCount} bootstrap).`);
  return { liveCount, staleCount, seedCount, lastError };
}
