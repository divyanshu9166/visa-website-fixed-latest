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

    let interceptedData = null;

    // Listen for any JSON data responses on the page
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('wait') && (url.endsWith('.json') || response.headers()['content-type']?.includes('json'))) {
        try {
          const json = await response.json();
          if (Array.isArray(json) || json.posts || json.data) {
            interceptedData = json;
          }
        } catch {}
      }
    });

    const response = await page.goto(DOS_GLOBAL_URL, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    console.log(`[automated-dos-wait-times] Page loaded with HTTP status: ${response?.status()}`);

    // Wait 3 seconds for client-side scripts to populate tables
    await page.waitForTimeout(3000);

    // Extract posts from DOM table if rendered
    const extractedPosts = await page.evaluate(() => {
      const posts = [];
      const tables = Array.from(document.querySelectorAll('table'));

      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll('tbody tr, tr')).slice(1);
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td, th')).map(c => c.textContent?.trim() || '');
          if (cells.length >= 4) {
            const postName = cells[0];
            const b1b2 = cells[1];
            const student = cells[2];
            const petition = cells[3];
            const crew = cells[4] || cells[3];

            if (postName && !postName.toLowerCase().includes('embassy') && !postName.toLowerCase().includes('consulate') && !postName.toLowerCase().includes('city')) {
              posts.push({
                post_name: postName,
                city: postName,
                b1_b2_next_available: b1b2,
                student_next_available: student,
                petition_next_available: petition,
                crew_transit_next_available: crew,
              });
            } else if (postName && postName.length > 2) {
              posts.push({
                post_name: postName,
                city: postName,
                b1_b2_next_available: b1b2,
                student_next_available: student,
                petition_next_available: petition,
                crew_transit_next_available: crew,
              });
            }
          }
        }
      }
      return posts;
    });

    const finalPosts = (interceptedData && (Array.isArray(interceptedData) ? interceptedData : (interceptedData.posts || interceptedData.data))) || extractedPosts;

    if (!finalPosts || finalPosts.length === 0) {
      console.warn('[automated-dos-wait-times] No posts could be extracted from page DOM. Checking if snapshot already exists...');
      if (fs.existsSync(SNAPSHOT_OUTPUT_PATH)) {
        console.log(`[automated-dos-wait-times] Using existing snapshot at ${SNAPSHOT_OUTPUT_PATH}`);
        await importDosSnapshot(SNAPSHOT_OUTPUT_PATH);
        return { success: true, source: 'cached-snapshot' };
      }
      throw new Error('Automated browser scrape returned 0 consular records.');
    }

    console.log(`[automated-dos-wait-times] Successfully extracted ${finalPosts.length} posts via browser!`);

    const snapshotPayload = {
      _meta: {
        source_updated: new Date().toISOString().slice(0, 10),
        extracted_at: new Date().toISOString(),
        total_posts: finalPosts.length,
        source: DOS_GLOBAL_URL,
      },
      posts: finalPosts,
    };

    fs.writeFileSync(SNAPSHOT_OUTPUT_PATH, JSON.stringify(snapshotPayload, null, 2));
    console.log(`[automated-dos-wait-times] Saved snapshot to ${SNAPSHOT_OUTPUT_PATH}`);

    // Ingest into content collection and PostgreSQL
    const { matchedCountries, totalConsulates } = await importDosSnapshot(SNAPSHOT_OUTPUT_PATH);
    console.log(`[automated-dos-wait-times] Ingestion complete: ${matchedCountries} countries, ${totalConsulates} consulates updated.`);

    return { success: true, matchedCountries, totalConsulates };
  } catch (err) {
    console.error('[automated-dos-wait-times] Browser scrape failed:', err.message);
    // Fallback: If snapshot exists on disk, import it
    if (fs.existsSync(SNAPSHOT_OUTPUT_PATH)) {
      console.log(`[automated-dos-wait-times] Falling back to existing snapshot at ${SNAPSHOT_OUTPUT_PATH}...`);
      await importDosSnapshot(SNAPSHOT_OUTPUT_PATH);
      return { success: true, fallback: true };
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
