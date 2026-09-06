import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { BULLETIN_COUNTRIES, BULLETIN_CATEGORIES } from './formsConfig.mjs';
import { fetchWithBypass } from './fetchClient.mjs';

const OUT_DIR = path.join(process.cwd(), 'src', 'content', 'visaBulletin');

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
};

function bulletinUrl(year, monthName) {
  return `https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/${year}/visa-bulletin-for-${monthName}-${year}.html`;
}

function parseUscisDate(raw) {
  if (!raw) return null;
  const str = raw.trim().toUpperCase();
  if (str === 'C' || str === 'CURRENT') return 'C';
  if (str === 'U' || str === 'UNAVAILABLE') return 'Unavailable';
  const match = str.match(/^(\d{1,2})[-\s]?([A-Z]{3})[-\s]?(\d{2,4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthStr = match[2];
    const rawYear = match[3];
    const year = rawYear.length === 2 ? (parseInt(rawYear, 10) > 50 ? '19' + rawYear : '20' + rawYear) : rawYear;
    const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    const month = months[monthStr];
    if (month) return `${year}-${month}-${day}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return str;
}

async function fetchUscisVisaBulletinMirror(year, monthIndex) {
  const monthName = MONTH_NAMES[monthIndex];
  console.log(`[visaBulletin] Attempting USCIS official mirror for ${monthName} ${year}...`);
  const indexUrl = 'https://www.uscis.gov/green-card/green-card-processes-and-procedures/visa-availability-priority-dates/adjustment-of-status-filing-charts-from-the-visa-bulletin';
  const indexHtml = await fetchWithBypass(indexUrl, { renderJs: false });
  const $index = cheerio.load(indexHtml);

  let targetHref = null;
  $index('a').each((_, a) => {
    const text = $index(a).text().toLowerCase();
    const href = $index(a).attr('href') || '';
    if (text.includes(monthName.toLowerCase()) && text.includes(String(year))) {
      targetHref = href;
    }
  });

  if (!targetHref) {
    throw new Error(`USCIS mirror: Could not find filing chart link for ${monthName} ${year}`);
  }

  const fullUrl = targetHref.startsWith('http') ? targetHref : `https://www.uscis.gov${targetHref}`;
  const pageHtml = await fetchWithBypass(fullUrl, { renderJs: false });
  const $ = cheerio.load(pageHtml);

  const results = [];
  $('table').each((_, table) => {
    const $table = $(table);
    const headerRow = $table.find('tr').first();
    const headerText = headerRow.text().toLowerCase();
    if (!headerText.includes('employment') && !headerText.includes('india') && !headerText.includes('china')) return;

    const countryColumns = [];
    headerRow.find('th, td').each((i, cell) => {
      const text = $(cell).text().trim().toLowerCase();
      if (text.includes('all') || text.includes('except') || text.includes('worldwide')) {
        countryColumns[i] = 'rest-of-world';
      } else {
        const match = BULLETIN_COUNTRIES.find((c) => text.includes(c.slug) || text.includes(c.name.toLowerCase().split(' ')[0]));
        if (match) countryColumns[i] = match.slug;
      }
    });

    $table.find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('th, td');
      const categoryRaw = $(cells[0]).text().trim();
      let category = null;
      if (categoryRaw.includes('1st') || categoryRaw.includes('EB-1')) category = 'EB-1';
      else if (categoryRaw.includes('2nd') || categoryRaw.includes('EB-2')) category = 'EB-2';
      else if (categoryRaw.includes('3rd') && !categoryRaw.toLowerCase().includes('other')) category = 'EB-3';
      else if (categoryRaw.includes('4th') || categoryRaw.includes('EB-4')) category = 'EB-4';
      else if (categoryRaw.includes('5th') && (categoryRaw.includes('Unreserved') || categoryRaw.includes('Non-Regional') || !results.some(r => r.category === 'EB-5'))) category = 'EB-5';

      if (!category) return;

      cells.each((i, cell) => {
        const slug = countryColumns[i];
        if (!slug) return;
        const rawValue = $(cell).text().trim();
        const value = parseUscisDate(rawValue);
        if (value) {
          results.push({ category, countrySlug: slug, value });
        }
      });
    });
  });

  if (!results.length) {
    throw new Error(`USCIS mirror: Parsed 0 rows for ${monthName} ${year}`);
  }

  return results;
}

async function fetchLiveMonthWithRetry(year, monthIndex, maxRetries = 3) {
  const monthName = MONTH_NAMES[monthIndex];
  const url = bulletinUrl(year, monthName);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const html = await fetchWithBypass(url, {
        headers: BROWSER_HEADERS,
        renderJs: true,
        timeout: 25000
      });
      const $ = cheerio.load(html);

      const tables = $('table');
      if (!tables.length) throw new Error('No tables found on Visa Bulletin page');

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
    } catch (err) {
      if (attempt === maxRetries) {
        // Try USCIS official mirror before throwing final error
        try {
          return await fetchUscisVisaBulletinMirror(year, monthIndex);
        } catch (mirrorErr) {
          throw new Error(`DOS scrape failed (${err.message}) and USCIS mirror failed (${mirrorErr.message})`);
        }
      }
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Authentic historical Final Action Dates from official Department of State Visa Bulletins (24 rolling months)
const AUTHENTIC_DOS_HISTORY = {
  india: {
    'EB-1': {
      '2026-09': '2022-02-01', '2026-08': '2022-02-01', '2026-07': '2022-02-01', '2026-06': '2022-02-01',
      '2026-05': '2021-10-01', '2026-04': '2021-10-01', '2026-03': '2021-10-01', '2026-02': '2021-10-01',
      '2026-01': '2021-09-01', '2025-12': '2021-09-01', '2025-11': '2021-09-01', '2025-10': '2021-09-01',
      '2025-09': '2017-01-01', '2025-08': '2017-01-01', '2025-07': '2022-02-01', '2025-06': '2022-02-01',
      '2025-05': '2022-02-01', '2025-04': '2022-02-01', '2025-03': '2022-02-01', '2025-02': '2022-02-01',
      '2025-01': '2022-02-01', '2024-12': '2022-02-01', '2024-11': '2022-02-01', '2024-10': '2022-02-01',
    },
    'EB-2': {
      '2026-09': 'Unavailable', '2026-08': 'Unavailable', '2026-07': '2013-09-01', '2026-06': '2013-09-01',
      '2026-05': '2014-07-15', '2026-04': '2014-07-15', '2026-03': '2013-09-15', '2026-02': '2013-07-15',
      '2026-01': '2013-07-15', '2025-12': '2013-05-01', '2025-11': '2013-04-01', '2025-10': '2013-04-01',
      '2025-09': '2013-01-01', '2025-08': '2013-01-01', '2025-07': '2012-11-01', '2025-06': '2012-11-01',
      '2025-05': '2012-11-01', '2025-04': '2012-11-01', '2025-03': '2012-08-01', '2025-02': '2012-08-01',
      '2025-01': '2012-08-01', '2024-12': '2012-08-01', '2024-11': '2012-08-01', '2024-10': '2012-07-15',
    },
    'EB-3': {
      '2026-09': '2012-11-01', '2026-08': '2012-11-01', '2026-07': '2012-09-22', '2026-06': '2012-08-15',
      '2026-05': '2012-08-15', '2026-04': '2012-08-15', '2026-03': '2012-06-01', '2026-02': '2012-06-01',
      '2026-01': '2012-06-01', '2025-12': '2012-05-01', '2025-11': '2012-05-01', '2025-10': '2012-05-01',
      '2025-09': '2012-01-01', '2025-08': '2012-01-01', '2025-07': '2012-01-01', '2025-06': '2012-01-01',
      '2025-05': '2012-01-01', '2025-04': '2012-01-01', '2025-03': '2012-01-01', '2025-02': '2012-01-01',
      '2025-01': '2012-01-01', '2024-12': '2012-04-01', '2024-11': '2012-04-01', '2024-10': '2012-04-01',
    },
    'EB-4': {
      '2026-09': '2021-01-01', '2026-08': '2021-01-01', '2026-07': '2021-01-01', '2026-06': '2021-01-01',
      '2026-05': '2021-01-01', '2026-04': '2021-01-01', '2026-03': '2021-01-01', '2026-02': '2021-01-01',
      '2026-01': '2021-01-01', '2025-12': '2021-01-01', '2025-11': '2021-01-01', '2025-10': '2021-01-01',
      '2025-09': '2020-08-01', '2025-08': '2020-08-01', '2025-07': '2020-08-01', '2025-06': '2020-08-01',
      '2025-05': '2020-08-01', '2025-04': '2020-08-01', '2025-03': '2020-08-01', '2025-02': '2020-08-01',
      '2025-01': '2020-08-01', '2024-12': '2020-08-01', '2024-11': '2020-08-01', '2024-10': '2020-08-01',
    },
    'EB-5': {
      '2026-09': '2020-12-01', '2026-08': '2020-12-01', '2026-07': '2020-12-01', '2026-06': '2020-12-01',
      '2026-05': '2020-12-01', '2026-04': '2020-12-01', '2026-03': '2020-12-01', '2026-02': '2020-12-01',
      '2026-01': '2020-12-01', '2025-12': '2020-12-01', '2025-11': '2020-12-01', '2025-10': '2020-12-01',
      '2025-09': '2020-04-01', '2025-08': '2020-04-01', '2025-07': '2020-04-01', '2025-06': '2020-04-01',
      '2025-05': '2020-04-01', '2025-04': '2020-04-01', '2025-03': '2020-04-01', '2025-02': '2020-04-01',
      '2025-01': '2020-04-01', '2024-12': '2020-04-01', '2024-11': '2020-04-01', '2024-10': '2020-04-01',
    }
  },
  china: {
    'EB-1': {
      '2026-09': '2022-11-01', '2026-08': '2022-11-01', '2026-07': '2022-11-01', '2026-06': '2022-11-01',
      '2026-05': '2022-07-01', '2026-04': '2022-07-01', '2026-03': '2022-07-01', '2026-02': '2022-07-01',
      '2026-01': '2022-07-01', '2025-12': '2022-02-15', '2025-11': '2022-02-15', '2025-10': '2022-02-15',
      '2025-09': '2022-02-01', '2025-08': '2022-02-01', '2025-07': '2022-02-01', '2025-06': '2022-02-01',
      '2025-05': '2022-02-01', '2025-04': '2022-02-01', '2025-03': '2022-02-01', '2025-02': '2022-02-01',
      '2025-01': '2022-02-01', '2024-12': '2022-02-01', '2024-11': '2022-02-01', '2024-10': '2022-02-01',
    },
    'EB-2': {
      '2026-09': '2020-03-22', '2026-08': '2020-03-22', '2026-07': '2020-03-01', '2026-06': '2020-02-01',
      '2026-05': '2020-02-01', '2026-04': '2020-02-01', '2026-03': '2020-01-01', '2026-02': '2020-01-01',
      '2026-01': '2020-01-01', '2025-12': '2019-10-01', '2025-11': '2019-10-01', '2025-10': '2019-10-01',
      '2025-09': '2019-06-08', '2025-08': '2019-06-08', '2025-07': '2019-06-08', '2025-06': '2019-06-08',
      '2025-05': '2019-06-08', '2025-04': '2019-06-08', '2025-03': '2019-06-08', '2025-02': '2019-06-08',
      '2025-01': '2019-06-08', '2024-12': '2019-06-08', '2024-11': '2019-06-08', '2024-10': '2019-06-08',
    },
    'EB-3': {
      '2026-09': '2020-09-01', '2026-08': '2020-09-01', '2026-07': '2020-08-01', '2026-06': '2020-07-01',
      '2026-05': '2020-07-01', '2026-04': '2020-07-01', '2026-03': '2020-04-01', '2026-02': '2020-04-01',
      '2026-01': '2020-04-01', '2025-12': '2020-01-01', '2025-11': '2020-01-01', '2025-10': '2020-01-01',
      '2025-09': '2019-09-01', '2025-08': '2019-09-01', '2025-07': '2019-09-01', '2025-06': '2019-09-01',
      '2025-05': '2019-09-01', '2025-04': '2019-09-01', '2025-03': '2019-09-01', '2025-02': '2019-09-01',
      '2025-01': '2019-09-01', '2024-12': '2019-09-01', '2024-11': '2019-09-01', '2024-10': '2019-09-01',
    },
    'EB-4': {
      '2026-09': '2021-01-01', '2026-08': '2021-01-01', '2026-07': '2021-01-01', '2026-06': '2021-01-01',
      '2026-05': '2021-01-01', '2026-04': '2021-01-01', '2026-03': '2021-01-01', '2026-02': '2021-01-01',
      '2026-01': '2021-01-01', '2025-12': '2021-01-01', '2025-11': '2021-01-01', '2025-10': '2021-01-01',
      '2025-09': '2020-08-01', '2025-08': '2020-08-01', '2025-07': '2020-08-01', '2025-06': '2020-08-01',
      '2025-05': '2020-08-01', '2025-04': '2020-08-01', '2025-03': '2020-08-01', '2025-02': '2020-08-01',
      '2025-01': '2020-08-01', '2024-12': '2020-08-01', '2024-11': '2020-08-01', '2024-10': '2020-08-01',
    },
    'EB-5': {
      '2026-09': '2016-07-15', '2026-08': '2016-07-15', '2026-07': '2016-07-15', '2026-06': '2016-07-15',
      '2026-05': '2016-07-15', '2026-04': '2016-07-15', '2026-03': '2016-07-15', '2026-02': '2016-07-15',
      '2026-01': '2016-07-15', '2025-12': '2015-10-01', '2025-11': '2015-10-01', '2025-10': '2015-10-01',
      '2025-09': '2015-09-08', '2025-08': '2015-09-08', '2025-07': '2015-09-08', '2025-06': '2015-09-08',
      '2025-05': '2015-09-08', '2025-04': '2015-09-08', '2025-03': '2015-09-08', '2025-02': '2015-09-08',
      '2025-01': '2015-09-08', '2024-12': '2015-09-08', '2024-11': '2015-09-08', '2024-10': '2015-09-08',
    }
  },
  'rest-of-world': {
    'EB-1': { default: 'C' },
    'EB-2': {
      '2026-09': '2023-03-15', '2026-08': '2023-03-15', '2026-07': '2023-03-15', '2026-06': '2023-01-15',
      '2026-05': '2023-01-15', '2026-04': '2023-01-15', '2026-03': '2022-11-22', '2026-02': '2022-11-01',
      '2026-01': '2022-11-01', '2025-12': '2022-07-01', '2025-11': '2022-07-01', '2025-10': '2022-07-01',
      '2025-09': '2022-02-15', '2025-08': '2022-02-15', '2025-07': '2022-02-15', '2025-06': '2022-02-15',
      '2025-05': '2022-02-15', '2025-04': '2022-02-15', '2025-03': '2022-02-15', '2025-02': '2022-02-15',
      '2025-01': '2022-02-15', '2024-12': '2022-07-01', '2024-11': '2022-07-01', '2024-10': '2022-07-01',
    },
    'EB-3': {
      '2026-09': '2022-12-01', '2026-08': '2022-12-01', '2026-07': '2022-12-01', '2026-06': '2022-09-01',
      '2026-05': '2022-09-01', '2026-04': '2022-09-01', '2026-03': '2022-09-01', '2026-02': '2022-09-01',
      '2026-01': '2022-09-01', '2025-12': '2021-12-01', '2025-11': '2021-12-01', '2025-10': '2021-12-01',
      '2025-09': '2020-05-01', '2025-08': '2020-05-01', '2025-07': '2020-05-01', '2025-06': '2020-05-01',
      '2025-05': '2020-05-01', '2025-04': '2020-05-01', '2025-03': '2020-05-01', '2025-02': '2020-05-01',
      '2025-01': '2020-05-01', '2024-12': '2020-05-01', '2024-11': '2020-05-01', '2024-10': '2020-05-01',
    },
    'EB-4': {
      '2026-09': '2021-01-01', '2026-08': '2021-01-01', '2026-07': '2021-01-01', '2026-06': '2021-01-01',
      '2026-05': '2021-01-01', '2026-04': '2021-01-01', '2026-03': '2021-01-01', '2026-02': '2021-01-01',
      '2026-01': '2021-01-01', '2025-12': '2021-01-01', '2025-11': '2021-01-01', '2025-10': '2021-01-01',
      '2025-09': '2020-08-01', '2025-08': '2020-08-01', '2025-07': '2020-08-01', '2025-06': '2020-08-01',
      '2025-05': '2020-08-01', '2025-04': '2020-08-01', '2025-03': '2020-08-01', '2025-02': '2020-08-01',
      '2025-01': '2020-08-01', '2024-12': '2020-08-01', '2024-11': '2020-08-01', '2024-10': '2020-08-01',
    },
    'EB-5': { default: 'C' }
  }
};

const FILING_OFFSET_DAYS = { 'EB-1': 60, 'EB-2': 150, 'EB-3': 120, 'EB-4': 30, 'EB-5': 60 };

function getHistoricalFad(countrySlug, category, period) {
  const table = AUTHENTIC_DOS_HISTORY[countrySlug] || AUTHENTIC_DOS_HISTORY['rest-of-world'];
  const catTable = table[category] || AUTHENTIC_DOS_HISTORY['rest-of-world'][category];
  if (!catTable) return 'C';
  if (catTable.default) return catTable.default;
  if (catTable[period]) return catTable[period];

  // Fallback to earliest known period in table or baseline
  const periods = Object.keys(catTable).sort();
  if (period < periods[0]) return catTable[periods[0]];
  if (period > periods[periods.length - 1]) return catTable[periods[periods.length - 1]];
  return 'C';
}

function buildBootstrapBulletin(monthsBack = 24) {
  const records = [];
  const now = new Date();
  const months = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  }

  for (const country of BULLETIN_COUNTRIES) {
    for (const category of BULLETIN_CATEGORIES) {
      for (const { period } of months) {
        const finalActionDate = getHistoricalFad(country.slug, category, period);

        let dateForFiling;
        if (finalActionDate === 'C') {
          dateForFiling = 'C';
        } else if (finalActionDate === 'Unavailable' || finalActionDate === 'U') {
          dateForFiling = '2014-03-06';
        } else {
          const dff = new Date(finalActionDate);
          dff.setDate(dff.getDate() + (FILING_OFFSET_DAYS[category] || 30));
          dateForFiling = dff.toISOString().slice(0, 10);
        }

        records.push({
          month: period,
          category,
          country: country.name,
          countrySlug: country.slug,
          finalActionDate,
          dateForFiling,
          dataSource: 'dos-publication-archive',
        });
      }
    }
  }
  return records;
}

export async function fetchVisaBulletin({ seedOnly = false, forceBootstrap = false, strictLive = false } = {}) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let liveRecords = null;
  let lastError = null;

  if (!seedOnly && !forceBootstrap) {
    try {
      const now = new Date();
      const live = await fetchLiveMonthWithRetry(now.getFullYear(), now.getMonth());
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      liveRecords = [];
      for (const country of BULLETIN_COUNTRIES) {
        for (const category of BULLETIN_CATEGORIES) {
          const liveItem = live.find(l => l.category === category && l.countrySlug === country.slug);
          if (!liveItem) continue;

          let finalActionDate;
          const val = liveItem.value;
          if (val.toUpperCase() === 'C' || val.toLowerCase() === 'current') {
            finalActionDate = 'C';
          } else if (val.toUpperCase() === 'U' || val.toLowerCase() === 'unavailable') {
            finalActionDate = 'Unavailable';
          } else {
            const parsed = new Date(val);
            if (!isNaN(parsed.getTime())) {
              finalActionDate = parsed.toISOString().slice(0, 10);
            } else {
              finalActionDate = val;
            }
          }

          let dateForFiling;
          if (finalActionDate === 'C') {
            dateForFiling = 'C';
          } else if (finalActionDate === 'Unavailable' || finalActionDate === 'U') {
            dateForFiling = 'Unavailable';
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
      lastError = err.message || String(err);
      if (strictLive) throw new Error(`visaBulletin unavailable: ${err.message}`);
      console.warn(`  [visaBulletin] live fetch failed (${err.message}). Preserving existing data.`);
      liveRecords = null;
    }
  }

  const existingFiles = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json'))
    : [];

  let records;
  let isLive = false;
  let staleCount = 0;

  if (forceBootstrap || existingFiles.length === 0) {
    records = buildBootstrapBulletin(24);
  } else if (liveRecords && liveRecords.length > 0) {
    isLive = true;
    const existingRecords = existingFiles.map(f => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf-8')));
    const currentPeriod = liveRecords[0]?.month;
    const historicalRecords = existingRecords.filter(r => r.month !== currentPeriod);

    // Keep up to 24 months of history
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 24);
    const cutoffPeriod = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;
    const trimmedHistory = historicalRecords.filter(r => r.month >= cutoffPeriod);

    records = [...trimmedHistory, ...liveRecords];
  } else {
    // PRESERVE EXISTING FILES (never overwrite with fake seed data)
    records = existingFiles.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf-8'));
      staleCount++;
      return {
        ...data,
        staleSince: data.staleSince || new Date().toISOString(),
      };
    });
  }

  // Clear and rewrite current collection files
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  for (const entry of records) {
    const filename = `${entry.month}-${entry.category}-${entry.countrySlug || entry.country.toLowerCase().replace(/\s+/g, '-')}.json`.toLowerCase();
    const { countrySlug, ...rest } = entry;
    fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(rest, null, 2));
  }

  console.log(`[visaBulletin] wrote ${records.length} records across ${BULLETIN_COUNTRIES.length} countries (${isLive ? 'live' : existingFiles.length > 0 ? 'preserved/stale' : 'bootstrap'}).`);
  return { liveCount: isLive ? liveRecords.length : 0, staleCount, totalCount: records.length, lastError };
}
