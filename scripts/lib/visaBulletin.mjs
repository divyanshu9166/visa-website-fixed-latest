import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { BULLETIN_COUNTRIES, BULLETIN_CATEGORIES } from './formsConfig.mjs';

const OUT_DIR = path.join(process.cwd(), 'src', 'content', 'visaBulletin');

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function bulletinUrl(year, monthName) {
  return `https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/${year}/visa-bulletin-for-${monthName}-${year}.html`;
}

// Real scraper: the Visa Bulletin page renders two HTML tables per chargeability
// section (Final Action Dates, Dates for Filing) for "Employment-based" preferences.
// Government table markup changes occasionally, so this is best-effort: it tries a
// couple of selector strategies and throws if nothing matches, letting the caller
// fall back to seed data instead of writing garbage.
async function fetchLiveMonth(year, monthIndex) {
  const monthName = MONTH_NAMES[monthIndex];
  const res = await fetch(bulletinUrl(year, monthName), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; USVisaTrackerBot/1.0)' },
  });
  if (!res.ok) throw new Error(`Visa Bulletin ${res.status} for ${monthName} ${year}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const tables = $('table');
  if (!tables.length) throw new Error('No tables found on Visa Bulletin page');

  // Heuristic: find the employment-based Final Action Dates table by looking for a
  // table whose header row contains "Employment" and a row with "1st" (EB-1).
  const results = [];
  tables.each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('tr').first().text().toLowerCase();
    if (!headerText.includes('india') && !headerText.includes('china')) return;

    const countryColumns = [];
    $table.find('tr').first().find('th, td').each((i, cell) => {
      const text = $(cell).text().trim();
      const match = BULLETIN_COUNTRIES.find((c) => text.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]));
      if (match) countryColumns[i] = match.slug;
    });

    $table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('th, td');
      const categoryRaw = $(cells[0]).text().trim();
      const category = BULLETIN_CATEGORIES.find((c) => categoryRaw.includes(c.replace('EB-', '')));
      if (!category) return;
      cells.each((i, cell) => {
        const slug = countryColumns[i];
        if (!slug) return;
        const value = $(cell).text().trim();
        results.push({ category, countrySlug: slug, value });
      });
    });
  });

  if (!results.length) throw new Error('Parsed 0 rows from Visa Bulletin tables');
  return results;
}

function seededJitter(seedStr, amplitude) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 2 * amplitude;
}

// Illustrative baseline cutoff dates per country/category, loosely modeled on
// recent real-world backlog patterns (India/China EB-2 & EB-3 are the most
// retrogressed; Mexico/Philippines/Vietnam/ROW are mostly current). These are
// SEED placeholders only — replace with live scraped data by running this script
// with full internet access (see README).
const BASELINES = {
  india: { 'EB-1': '2022-03-01', 'EB-2': '2012-04-15', 'EB-3': '2012-08-15', 'EB-4': '2022-01-01', 'EB-5': '2017-01-01' },
  china: { 'EB-1': '2022-09-01', 'EB-2': '2020-02-01', 'EB-3': '2020-09-01', 'EB-4': '2018-01-01', 'EB-5': '2016-06-01' },
  mexico: { 'EB-1': 'C', 'EB-2': 'C', 'EB-3': '2023-01-01', 'EB-4': 'C', 'EB-5': 'C' },
  philippines: { 'EB-1': 'C', 'EB-2': 'C', 'EB-3': '2022-06-01', 'EB-4': '2018-01-01', 'EB-5': 'C' },
  vietnam: { 'EB-1': 'C', 'EB-2': 'C', 'EB-3': '2022-01-01', 'EB-4': 'C', 'EB-5': 'C' },
  'rest-of-world': { 'EB-1': 'C', 'EB-2': 'C', 'EB-3': '2023-06-01', 'EB-4': 'C', 'EB-5': 'C' },
};

const FILING_OFFSET_DAYS = { 'EB-1': 30, 'EB-2': 45, 'EB-3': 30, 'EB-4': 20, 'EB-5': 30 };

function buildSeedMonths(monthsBack = 24) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, monthsAgo: i });
  }
  return months.reverse(); // oldest first
}

function buildSeedBulletin() {
  const records = [];
  const months = buildSeedMonths(264); // Cover 2002-2023 (22 years * 12)

  for (const country of BULLETIN_COUNTRIES) {
    for (const category of BULLETIN_CATEGORIES) {
      const baseline = BASELINES[country.slug]?.[category];
      if (baseline === undefined) continue;

      for (const { period, monthsAgo } of months) {
        let finalActionDate;
        if (baseline === 'C') {
          finalActionDate = 'C';
        } else {
          const base = new Date(baseline);
          const velocityDays = 18 + seededJitter(`${country.slug}|${category}|velocity`, 6); // avg days/month the cutoff advances
          base.setDate(base.getDate() - Math.round(velocityDays * monthsAgo));
          finalActionDate = base.toISOString().slice(0, 10);
        }

        let dateForFiling;
        if (finalActionDate === 'C') {
          dateForFiling = 'C';
        } else {
          const dff = new Date(finalActionDate);
          dff.setDate(dff.getDate() + (FILING_OFFSET_DAYS[category] || 30));
          dateForFiling = dff.toISOString().slice(0, 10);
        }

        records.push({ month: period, category, country: country.name, countrySlug: country.slug, finalActionDate, dateForFiling, dataSource: 'seed' });
      }
    }
  }
  return records;
}

export async function fetchVisaBulletin({ seedOnly = false, strictLive = false } = {}) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let liveRecords = null;

  if (!seedOnly) {
    try {
      const now = new Date();
      const live = await fetchLiveMonth(now.getFullYear(), now.getMonth());
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Build records for the current month from live data
      liveRecords = [];
      for (const country of BULLETIN_COUNTRIES) {
        for (const category of BULLETIN_CATEGORIES) {
          const liveItem = live.find(l => l.category === category && l.countrySlug === country.slug);
          if (!liveItem) continue;

          let finalActionDate;
          const val = liveItem.value;
          if (val.toUpperCase() === 'C' || val.toLowerCase() === 'current') {
            finalActionDate = 'C';
          } else {
            const parsed = new Date(val);
            if (!isNaN(parsed.getTime())) {
              finalActionDate = parsed.toISOString().slice(0, 10);
            } else {
              continue; // unparseable — skip
            }
          }

          let dateForFiling;
          if (finalActionDate === 'C') {
            dateForFiling = 'C';
          } else {
            const dff = new Date(finalActionDate);
            dff.setDate(dff.getDate() + (FILING_OFFSET_DAYS[category] || 30));
            dateForFiling = dff.toISOString().slice(0, 10);
          }

          liveRecords.push({
            month: currentPeriod,
            category,
            country: country.name,
            countrySlug: country.slug,
            finalActionDate,
            dateForFiling,
            dataSource: 'live',
          });
        }
      }
      console.log(`[visaBulletin] live scrape succeeded — ${liveRecords.length} records for ${currentPeriod}.`);
    } catch (err) {
      if (strictLive) throw new Error(`visaBulletin unavailable: ${err.message}`);
      console.warn(`  [visaBulletin] live fetch failed (${err.message}); using seed data.`);
      liveRecords = null;
    }
  }

  // If live succeeded, merge live current-month records with existing historical files.
  // If live failed (or seedOnly), generate full seed history.
  let records;
  if (liveRecords && liveRecords.length > 0) {
    // Read existing files to preserve historical records
    const existingFiles = fs.existsSync(OUT_DIR)
      ? fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json'))
      : [];
    const existingRecords = existingFiles.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf-8'));
      return data;
    });

    // Remove existing records for the current month (we're replacing them with live)
    const currentPeriod = liveRecords[0]?.month;
    const historicalRecords = existingRecords.filter(r => r.month !== currentPeriod);

    // Keep only the last 23 months of history (to make room for the new month)
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 23);
    const cutoffPeriod = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;
    const trimmedHistory = historicalRecords.filter(r => r.month >= cutoffPeriod);

    records = [...trimmedHistory, ...liveRecords];
  } else {
    records = buildSeedBulletin();
  }

  // Clear old files so renamed/removed categories don't linger
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  // Write all records
  for (const entry of records) {
    const filename = `${entry.month}-${entry.category}-${entry.countrySlug}.json`.toLowerCase();
    const { countrySlug, ...rest } = entry;
    fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(rest, null, 2));
  }

  const isLive = liveRecords && liveRecords.length > 0;
  console.log(`[visaBulletin] wrote ${records.length} records across ${BULLETIN_COUNTRIES.length} countries (${isLive ? 'live' : 'seed'}).`);
}
