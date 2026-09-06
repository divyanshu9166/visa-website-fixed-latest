import fs from 'fs';
import path from 'path';
import { WAIT_TIME_COUNTRIES } from './formsConfig.mjs';

const OUT_DIR = path.join(process.cwd(), 'src', 'content', 'appointmentWaitTimes');

// Real source: State Dept publishes a machine-readable XML summary of nonimmigrant
// visa appointment wait times by post, refreshed regularly.
const WAIT_TIMES_XML_URL = 'https://travel.state.gov/content/dam/visas/Statistics/machinereadable/Wait_Times_Summary.xml';

function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

async function fetchLiveXml() {
  const res = await fetch(WAIT_TIMES_XML_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; USVisaTrackerBot/1.0)' } });
  if (!res.ok) throw new Error(`Wait times XML ${res.status}`);
  const xml = await res.text();

  // Lightweight XML parsing without an extra dependency: the feed is a flat list of
  // <Post> (or similar) blocks. We split on a generic per-post tag and pull fields.
  const postBlocks = xml.split(/<\/(?:Post|post|MissionPost)>/).filter((b) => b.includes('<'));
  const posts = postBlocks.map((block) => ({
    post: xmlTag(block, 'Post_Name') || xmlTag(block, 'post_name') || xmlTag(block, 'Mission'),
    country: xmlTag(block, 'Country') || xmlTag(block, 'country'),
    waitTimeB1B2: xmlTag(block, 'Visitor_Visa_Wait_Time') || xmlTag(block, 'B1_B2_Wait'),
    waitTimeStudent: xmlTag(block, 'Student_Visa_Wait_Time') || xmlTag(block, 'F_Wait'),
  })).filter((p) => p.post && p.country);

  if (!posts.length) throw new Error('Parsed 0 posts from wait times XML');
  return posts;
}

function seededJitter(seedStr, amplitude) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 2 * amplitude;
}

// Rough illustrative baseline wait times (days) by post, intended only as seed
// placeholder data until the live XML fetch runs from an unrestricted network.
const POST_BASE_WAIT = {
  'New Delhi': 380, Mumbai: 410, Chennai: 360, Hyderabad: 390, Kolkata: 300,
  Beijing: 60, Shanghai: 55, Guangzhou: 65,
  'Mexico City': 280, Guadalajara: 310, Tijuana: 250, 'Ciudad Juarez': 240,
  Manila: 140,
  Lagos: 420, Abuja: 380,
  'Sao Paulo': 150, 'Rio de Janeiro': 160, Brasilia: 130,
  London: 45,
  Toronto: 35, Vancouver: 40, Montreal: 38,
  'Ho Chi Minh City': 90, Hanoi: 85,
  Islamabad: 200, Karachi: 220, Lahore: 210,
  Dhaka: 260,
  Kathmandu: 95,
  Bogota: 110,
  Jakarta: 100, Surabaya: 120,
  Seoul: 50,
  Cairo: 130,
  Istanbul: 70, Ankara: 75,
  'Addis Ababa': 180,
  Accra: 240,
  'Santo Domingo': 90,
  Lima: 105,
  'Buenos Aires': 60,
  Paris: 40,
  Frankfurt: 42, Berlin: 38,
  Johannesburg: 80, 'Cape Town': 70,
  Riyadh: 65, Jeddah: 70,
  Dubai: 30, 'Abu Dhabi': 35,
  Jerusalem: 25, 'Tel Aviv': 28,
  Nairobi: 150,
  Kingston: 60,
};

function buildSeedWaitTimes() {
  const records = [];
  const months = 12;
  const now = new Date();

  for (const country of WAIT_TIME_COUNTRIES) {
    const consulates = country.consulates.map((name) => {
      const base = POST_BASE_WAIT[name] ?? 90;
      const history = [];
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const jitter = seededJitter(`${name}|${period}`, base * 0.18);
        const seasonal = Math.sin((d.getMonth() / 12) * Math.PI * 2) * base * 0.08; // mild seasonal swing
        const wait = Math.max(7, Math.round(base + jitter + seasonal));
        history.push({ period, waitTimeB1B2: wait });
      }
      const current = history[history.length - 1].waitTimeB1B2;
      return {
        name,
        waitTimeB1B2: current,
        waitTimeStudent: Math.max(3, Math.round(current * 0.35)),
        waitTimeOther: Math.max(5, Math.round(current * 0.55)),
        hasEmergencyAppointments: current > 120,
        notes: current > 200
          ? 'High demand post — emergency/expedite appointment requests are common; check the embassy site for current criteria.'
          : '',
        history,
      };
    });

    records.push({
      country: country.name,
      slug: country.slug,
      countryCode: country.countryCode,
      lastUpdated: new Date().toISOString().slice(0, 10),
      dataSource: 'seed',
      consulates,
    });
  }
  return records;
}

function normalizeName(name) {
  return name.toLowerCase().trim()
    .replace(/['']/g, "'")
    .replace(/^u\.?s\.?\s*(embassy|consulate|mission)\s*/i, '')
    .replace(/\s+/g, ' ');
}

export async function fetchWaitTimes({ seedOnly = false, strictLive = false } = {}) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let livePosts = null;
  if (!seedOnly) {
    try {
      livePosts = await fetchLiveXml();
      console.log(`[waitTimes] live XML fetched — ${livePosts.length} consular posts parsed.`);
    } catch (err) {
      if (strictLive) throw new Error(`waitTimes unavailable: ${err.message}`);
      console.warn(`  [waitTimes] live fetch failed (${err.message}); using seed data.`);
    }
  }

  // Index live posts by normalized name for fuzzy matching
  const liveByPost = new Map();
  if (livePosts) {
    for (const p of livePosts) {
      liveByPost.set(normalizeName(p.post), p);
    }
  }

  let liveCount = 0;
  let seedCount = 0;
  const currentPeriod = new Date().toISOString().slice(0, 7);

  for (const country of WAIT_TIME_COUNTRIES) {
    const outPath = path.join(OUT_DIR, `${country.slug}.json`);
    const previousRecord = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf-8')) : null;

    let record = null;

    if (livePosts) {
      // Try to build record from live data
      const consulates = [];
      let matchedAny = false;

      for (const consulateName of country.consulates) {
        const normalized = normalizeName(consulateName);
        // Try exact match first, then substring match
        let live = liveByPost.get(normalized);
        if (!live) {
          // Fuzzy: find a live post whose normalized name contains our name or vice versa
          for (const [key, val] of liveByPost) {
            if (key.includes(normalized) || normalized.includes(key)) {
              live = val;
              break;
            }
          }
        }

        // Get previous consulate data for history accumulation
        const prevConsulate = previousRecord?.consulates?.find(c => c.name === consulateName);

        if (live) {
          matchedAny = true;
          const b1b2 = parseInt(live.waitTimeB1B2, 10);
          const student = parseInt(live.waitTimeStudent, 10);
          const waitB1B2 = !isNaN(b1b2) && b1b2 >= 0 ? b1b2 : (prevConsulate?.waitTimeB1B2 ?? POST_BASE_WAIT[consulateName] ?? 90);
          const waitStudent = !isNaN(student) && student >= 0 ? student : Math.max(3, Math.round(waitB1B2 * 0.35));

          // Accumulate history from previous record
          const history = prevConsulate?.history ? [...prevConsulate.history] : [];
          if (history.length > 0 && history[history.length - 1].period === currentPeriod) {
            history[history.length - 1] = { period: currentPeriod, waitTimeB1B2: waitB1B2 };
          } else {
            history.push({ period: currentPeriod, waitTimeB1B2: waitB1B2 });
          }
          // Keep at most 24 months
          while (history.length > 24) history.shift();

          consulates.push({
            name: consulateName,
            waitTimeB1B2: waitB1B2,
            waitTimeStudent: waitStudent,
            waitTimeOther: Math.max(5, Math.round(waitB1B2 * 0.55)),
            hasEmergencyAppointments: waitB1B2 > 120,
            notes: waitB1B2 > 200
              ? 'High demand post — emergency/expedite appointment requests are common; check the embassy site for current criteria.'
              : '',
            history,
          });
        } else {
          // No live match for this consulate — carry forward previous data or use seed
          if (prevConsulate) {
            consulates.push(prevConsulate);
          } else {
            // Generate seed for just this consulate
            const base = POST_BASE_WAIT[consulateName] ?? 90;
            const history = [];
            const now = new Date();
            for (let i = 11; i >= 0; i--) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              const jitter = seededJitter(`${consulateName}|${period}`, base * 0.18);
              const seasonal = Math.sin((d.getMonth() / 12) * Math.PI * 2) * base * 0.08;
              const wait = Math.max(7, Math.round(base + jitter + seasonal));
              history.push({ period, waitTimeB1B2: wait });
            }
            const current = history[history.length - 1].waitTimeB1B2;
            consulates.push({
              name: consulateName,
              waitTimeB1B2: current,
              waitTimeStudent: Math.max(3, Math.round(current * 0.35)),
              waitTimeOther: Math.max(5, Math.round(current * 0.55)),
              hasEmergencyAppointments: current > 120,
              notes: current > 200
                ? 'High demand post — emergency/expedite appointment requests are common; check the embassy site for current criteria.'
                : '',
              history,
            });
            console.log(`  [waitTimes] no live match for ${consulateName} — using seed/previous data.`);
          }
        }
      }

      if (matchedAny) {
        record = {
          country: country.name,
          slug: country.slug,
          countryCode: country.countryCode,
          lastUpdated: new Date().toISOString().slice(0, 10),
          dataSource: 'live',
          consulates,
        };
        liveCount++;
      }
    }

    if (!record) {
      // Fall back to seed for this country
      // Use buildSeedWaitTimes() but only for this country
      const seedAll = buildSeedWaitTimes();
      record = seedAll.find(r => r.slug === country.slug);
      seedCount++;
    }

    fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  }

  console.log(`[waitTimes] wrote ${WAIT_TIME_COUNTRIES.length} countries (${liveCount} live, ${seedCount} seed).`);
}
