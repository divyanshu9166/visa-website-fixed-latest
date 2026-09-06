import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';

const DOL_OFLC_URL = 'https://www.dol.gov/agencies/eta/foreign-labor/performance';
const TMP_DIR = path.join(process.cwd(), 'tmp');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

async function fetchPageHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPageHtml(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function downloadFile(url, destPath) {
  console.log(`[stream-lca-pipeline] Downloading disclosure file from ${url}...`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

export async function runLcaPipeline(options = {}) {
  console.log('=== DOL LCA STREAMING DATA PIPELINE ===\n');

  let targetFilePath = options.filePath || process.argv.slice(2).find(a => a.startsWith('--file='))?.split('=')[1] || process.argv[2];

  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    console.log('[stream-lca-pipeline] No local file specified. Searching for latest official DOL OFLC disclosure dataset...');
    try {
      const html = await fetchPageHtml(DOL_OFLC_URL);
      // Search for LCA / H-1B Disclosure Data links (xlsx or csv)
      const lcaMatch = html.match(/href="([^"]*LCA_Disclosure_Data[^"]*\.(?:xlsx|csv))"/i) ||
                       html.match(/href="([^"]*(?:H-1B|LCA)[^"]*Disclosure_Data[^"]*\.(?:xlsx|csv))"/i);

      if (lcaMatch) {
        let downloadUrl = lcaMatch[1];
        if (!downloadUrl.startsWith('http')) {
          downloadUrl = `https://www.dol.gov${downloadUrl.startsWith('/') ? '' : '/'}${downloadUrl}`;
        }
        const ext = path.extname(downloadUrl).split('?')[0] || '.xlsx';
        const destFile = path.join(TMP_DIR, `LCA_Disclosure_Data_Latest${ext}`);
        targetFilePath = await downloadFile(downloadUrl, destFile);
        console.log(`[stream-lca-pipeline] Downloaded latest disclosure dataset to ${targetFilePath}`);
      }
    } catch (err) {
      console.warn(`[stream-lca-pipeline] Remote automated download warning: ${err.message}`);
    }
  }

  // Check fallback in tmp/ or data/
  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    const fallbackCandidates = [
      path.join(process.cwd(), 'data', 'LCA_Disclosure_Data.xlsx'),
      path.join(process.cwd(), 'data', 'LCA_Disclosure_Data.csv'),
      path.join(TMP_DIR, 'lca-aggregated-cache.json'),
    ];
    for (const cand of fallbackCandidates) {
      if (fs.existsSync(cand)) {
        targetFilePath = cand;
        console.log(`[stream-lca-pipeline] Using local fallback dataset at ${targetFilePath}`);
        break;
      }
    }
  }

  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    console.warn('[stream-lca-pipeline] No LCA raw dataset available to process. If database is already populated, skipping.');
    return { success: false, reason: 'NO_RAW_DATA' };
  }

  // Step 1: If raw spreadsheet, run streaming aggregation
  const aggregatedCachePath = path.join(TMP_DIR, 'lca-aggregated-cache.json');
  if (targetFilePath.endsWith('.xlsx') || targetFilePath.endsWith('.csv')) {
    console.log(`\n[Step 1/2] Processing ${targetFilePath} with O(1) memory XML/CSV stream parser...`);
    execSync(`node scripts/process-lca-cache.mjs "${targetFilePath}"`, { stdio: 'inherit' });
  } else if (targetFilePath.endsWith('.json')) {
    console.log(`\n[Step 1/2] Using existing aggregated cache at ${targetFilePath}`);
    if (targetFilePath !== aggregatedCachePath) {
      fs.copyFileSync(targetFilePath, aggregatedCachePath);
    }
  }

  // Step 2: Ingest into PostgreSQL if DATABASE_URL is present
  if (fs.existsSync(aggregatedCachePath)) {
    console.log(`\n[Step 2/2] Importing aggregated employers into database...`);
    if (process.env.DATABASE_URL) {
      execSync(`node scripts/import-lca.mjs "${aggregatedCachePath}"`, { stdio: 'inherit' });
    } else {
      console.log('[stream-lca-pipeline] DATABASE_URL not set in environment; skipping PostgreSQL upsert.');
    }
  }

  console.log('\n✅ [stream-lca-pipeline] DOL LCA pipeline completed successfully.');
  return { success: true };
}

if (process.argv[1]?.endsWith('stream-lca-pipeline.mjs')) {
  runLcaPipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Pipeline error:', err);
      process.exit(1);
    });
}
