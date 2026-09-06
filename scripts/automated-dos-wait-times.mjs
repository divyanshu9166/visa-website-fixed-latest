import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { importDosSnapshot } from './import-dos-wait-times.mjs';

const DOS_GLOBAL_URL = 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html';
const SNAPSHOT_OUTPUT_PATH = path.join(process.cwd(), 'data', 'dos_global_wait_times.json');

// Ensure data directory exists
const dataDir = path.dirname(SNAPSHOT_OUTPUT_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

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
  for (const key of ['posts', 'data', 'results', 'locations', 'consulates', 'waitTimes']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

export async function scrapeDosWaitTimesWithBrowser() {
  console.log('[automated-dos-wait-times] Launching headless browser for unattended DOS scrape...');

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Add init script to mask automation
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();
    console.log(`[automated-dos-wait-times] Navigating to ${DOS_GLOBAL_URL}...`);

    const payloads = [];

    // Listen for any JSON data responses on the page
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('wait') && (url.endsWith('.json') || response.headers()['content-type']?.includes('json'))) {
        try {
          const json = await response.json();
          payloads.push(json);
        } catch {}
      }
    });

    const response = await page.goto(DOS_GLOBAL_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });

    console.log(`[automated-dos-wait-times] Page loaded with HTTP status: ${response?.status()}`);

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Extract posts from DOM table if rendered
    const domRows = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const rows = [];
      for (const table of tables) {
        const trs = Array.from(table.querySelectorAll('tbody tr, tr')).slice(1);
        for (const tr of trs) {
          const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.textContent?.trim() || '');
          if (cells.length >= 4) {
            rows.push(cells);
          }
        }
      }
      return rows;
    });

    let posts = payloads.flatMap(flatten).map(normalizePost).filter(p => p.post_name);
    if (!posts.length && domRows.length > 0) {
      posts = domRows.map(cells => normalizePost({
        post_name: cells[0],
        city: cells[0],
        b1_b2_next_available: cells[1],
        student_next_available: cells[2],
        petition_next_available: cells[3],
        crew_transit_next_available: cells[4] || cells[3],
      }));
    }

    const unique = [...new Map(posts.filter(p => p.post_name && Object.values(p).some(v => v !== undefined && v !== '')).map(p => [p.post_name.toLowerCase(), p])).values()];

    if (unique.length === 0) {
      console.warn('[automated-dos-wait-times] No posts could be extracted from page DOM. Checking if snapshot already exists...');
      if (fs.existsSync(SNAPSHOT_OUTPUT_PATH)) {
        console.log(`[automated-dos-wait-times] Using existing snapshot at ${SNAPSHOT_OUTPUT_PATH}`);
        const result = await importDosSnapshot(SNAPSHOT_OUTPUT_PATH);
        return { success: true, source: 'cached-snapshot', ...result };
      }
      throw new Error('Automated browser scrape returned 0 consular records.');
    }

    console.log(`[automated-dos-wait-times] Successfully extracted ${unique.length} posts via browser!`);

    const snapshotPayload = {
      _meta: {
        source_updated: new Date().toISOString().slice(0, 10),
        extracted_at: new Date().toISOString(),
        total_posts: unique.length,
        source: DOS_GLOBAL_URL,
      },
      posts: unique,
    };

    fs.writeFileSync(SNAPSHOT_OUTPUT_PATH, JSON.stringify(snapshotPayload, null, 2));
    console.log(`[automated-dos-wait-times] Saved snapshot to ${SNAPSHOT_OUTPUT_PATH}`);

    // Ingest into content collection and PostgreSQL
    const { matchedCountries, totalConsulates } = await importDosSnapshot(SNAPSHOT_OUTPUT_PATH);
    console.log(`[automated-dos-wait-times] Ingestion complete: ${matchedCountries} countries, ${totalConsulates} consulates updated.`);

    return { success: true, matchedCountries, totalConsulates };
  } catch (err) {
    console.error('[automated-dos-wait-times] Browser scrape failed:', err.message);
    if (fs.existsSync(SNAPSHOT_OUTPUT_PATH)) {
      console.log(`[automated-dos-wait-times] Falling back to existing snapshot at ${SNAPSHOT_OUTPUT_PATH}...`);
      const result = await importDosSnapshot(SNAPSHOT_OUTPUT_PATH);
      return { success: true, fallback: true, ...result };
    }
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// CLI execution
if (process.argv[1]?.endsWith('automated-dos-wait-times.mjs')) {
  scrapeDosWaitTimesWithBrowser()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal automated scrape error:', err);
      process.exit(1);
    });
}
