import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { importDosSnapshot } from './import-dos-wait-times.mjs';

const URL = 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html';
const SNAPSHOT = path.join(process.cwd(), 'data', 'dos_global_wait_times.json');

function normalizePost(post) {
  return {
    post_name: post.post_name || post.name || post.city || post.post || '',
    city: post.city || post.post_name || post.name || '',
    country: post.country || post.country_name || '',
    b1_b2_next_available: post.b1_b2_next_available ?? post.waitTimeB1B2 ?? post.b1b2,
    student_next_available: post.student_next_available ?? post.waitTimeStudent ?? post.student,
    petition_next_available: post.petition_next_available ?? post.waitTimePetition ?? post.petition,
    crew_transit_next_available: post.crew_transit_next_available ?? post.waitTimeCrewTransit ?? post.crewTransit ?? post.crew,
  };
}

function flatten(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['posts', 'data', 'results', 'locations', 'consulates', 'waitTimes']) if (Array.isArray(value[key])) return value[key];
  return [];
}

async function scrape() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'UTC',
      extraHTTPHeaders: { Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
    });
    const page = await context.newPage();
    const payloads = [];
    page.on('response', async response => {
      const type = response.headers()['content-type'] || '';
      if (type.includes('json')) { try { payloads.push(await response.json()); } catch {} }
    });
    const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    if (!response || response.status() >= 400) throw new Error(`DOS page returned HTTP ${response?.status() ?? 'unknown'}`);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    const domRows = await page.evaluate(() => [...document.querySelectorAll('table tr')].map(tr => [...tr.querySelectorAll('th,td')].map(td => td.textContent.trim())).filter(row => row.length >= 5));
    let posts = payloads.flatMap(flatten).map(normalizePost).filter(p => p.post_name);
    if (!posts.length && domRows.length > 1) posts = domRows.slice(1).map(cells => normalizePost({ post_name: cells[0], city: cells[0], b1_b2_next_available: cells[1], student_next_available: cells[2], petition_next_available: cells[3], crew_transit_next_available: cells[4] }));
    const unique = [...new Map(posts.filter(p => p.post_name && Object.values(p).some(v => v !== undefined && v !== '')).map(p => [p.post_name.toLowerCase(), p])).values()];
    if (unique.length < 100) throw new Error(`Only ${unique.length} DOS posts extracted; refusing to overwrite confirmed data`);
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ _meta: { source_updated: new Date().toISOString().slice(0, 10), extracted_at: new Date().toISOString(), total_posts: unique.length, source: URL }, posts: unique }, null, 2));
    return await importDosSnapshot(SNAPSHOT);
  } finally { await browser.close(); }
}

try {
  const result = await scrape();
  console.log(`[automated-dos-wait-times] Imported ${result.totalConsulates} consulates across ${result.matchedCountries} countries.`);
} catch (error) {
  console.error(`[automated-dos-wait-times] ${error.message}`);
  if (fs.existsSync(SNAPSHOT)) {
    console.warn('[automated-dos-wait-times] Existing snapshot retained; no synthetic values were generated.');
    process.exit(2);
  }
  process.exit(1);
}
