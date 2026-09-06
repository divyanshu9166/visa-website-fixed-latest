import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

const DOL_URL = 'https://www.dol.gov/agencies/eta/foreign-labor/performance';
const MANIFEST_PATH = path.join(process.cwd(), 'src', 'content', 'lca-manifest.json');

async function main() {
  const isForce = process.argv.includes('--force');
  console.log(`Fetching DOL Performance Page: ${DOL_URL}...`);
  const res = await fetch(DOL_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;'
    }
  });

  if (!res.ok) {
    console.error(`Failed to load DOL page: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const matches = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // Matches patterns like:
    // LCA_Disclosure_Data_FY2026_Q3.xlsx
    // LCA_Dislclosure_Data_FY2024_Q1.xlsx (typo handling)
    // LCA_Programs_FY2024_Q4.xlsx
    const fileMatch = href.match(/LCA_(?:Dis[a-z]*_Data|Programs)_FY(\d{4})(?:_Q(\d))?\.(xlsx|csv)/i);
    if (fileMatch) {
      const fy = parseInt(fileMatch[1], 10);
      const quarter = fileMatch[2] ? parseInt(fileMatch[2], 10) : 4; // annual defaults to Q4 weight
      const ext = fileMatch[3].toLowerCase();

      let url = href;
      if (url.startsWith('/')) {
        url = `https://www.dol.gov${url.replace(/^\/+/, '/')}`;
      }
      url = url.replace('https://www.dol.gov//', 'https://www.dol.gov/');

      const filename = href.split('/').pop().split('?')[0];
      matches.push({ fy, quarter, ext, url, filename });
    }
  });

  // Sort descending by Fiscal Year, then Quarter, preferring xlsx over csv
  matches.sort((a, b) => {
    if (b.fy !== a.fy) return b.fy - a.fy;
    if (b.quarter !== a.quarter) return b.quarter - a.quarter;
    if (a.ext === 'xlsx' && b.ext !== 'xlsx') return -1;
    if (b.ext === 'xlsx' && a.ext !== 'xlsx') return 1;
    return 0;
  });

  if (matches.length === 0) {
    console.error('Could not find any LCA disclosure files on the DOL performance page.');
    process.exit(1);
  }

  const latest = matches[0];
  console.log(`Discovered latest DOL file: FY${latest.fy} Q${latest.quarter} (${latest.filename})`);
  console.log(`Download URL: ${latest.url}`);

  let manifest = { latestImportedFiscalYear: 0, latestImportedQuarter: 0 };
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    } catch (e) {
      console.warn('Could not parse manifest, assuming fresh state.');
    }
  }

  console.log(`Current imported state: FY${manifest.latestImportedFiscalYear} Q${manifest.latestImportedQuarter}`);

  const isNew = isForce ||
    (latest.fy > manifest.latestImportedFiscalYear) ||
    (latest.fy === manifest.latestImportedFiscalYear && latest.quarter > manifest.latestImportedQuarter);

  console.log(`Status: ${isNew ? 'NEW_QUARTER_AVAILABLE' : 'UP_TO_DATE (No new quarter)'}`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_new_data=${isNew}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `download_url=${latest.url}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `file_name=${latest.filename}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `fy=${latest.fy}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `quarter=${latest.quarter}\n`);
  }
}

main().catch(err => {
  console.error('Discovery error:', err.message || err);
  process.exit(1);
});
