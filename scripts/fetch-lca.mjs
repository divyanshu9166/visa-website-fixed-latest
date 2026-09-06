import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const DOL_URL = 'https://www.dol.gov/agencies/eta/foreign-labor/performance';
const MANIFEST_PATH = path.join(process.cwd(), 'src', 'content', 'lca-manifest.json');

const response = await fetch(DOL_URL, { headers: { 'User-Agent': 'EasyVisaCheck data-refresh/1.0', Accept: 'text/html,application/xhtml+xml' } });
if (!response.ok) throw new Error(`DOL performance page returned HTTP ${response.status}`);
const $ = cheerio.load(await response.text());
const matches = [];
$('a[href]').each((_, el) => {
  const href = $(el).attr('href') || '';
  const match = href.match(/LCA_(?:Dis[a-z]*_Data|Programs)_FY(\d{4})(?:[_-]Q(\d))?\.(xlsx|csv)(?:\?[^#]*)?$/i);
  if (!match) return;
  const url = new URL(href, DOL_URL).toString();
  matches.push({ fy: Number(match[1]), quarter: Number(match[2] || 4), ext: match[3].toLowerCase(), url, filename: path.basename(new URL(url).pathname) });
});
if (!matches.length) throw new Error('No LCA disclosure files found on the DOL performance page');
matches.sort((a, b) => b.fy - a.fy || b.quarter - a.quarter || (a.ext === 'xlsx' ? -1 : 1));
const latest = matches[0];
let manifest = { latestImportedFiscalYear: 0, latestImportedQuarter: 0 };
if (fs.existsSync(MANIFEST_PATH)) {
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { console.warn('Ignoring invalid LCA manifest'); }
}
const force = process.argv.includes('--force');
const isNew = force || latest.fy > Number(manifest.latestImportedFiscalYear || 0) || (latest.fy === Number(manifest.latestImportedFiscalYear || 0) && latest.quarter > Number(manifest.latestImportedQuarter || 0));
console.log(`Discovered latest DOL file: FY${latest.fy} Q${latest.quarter} ${latest.filename}`);
console.log(`Status: ${isNew ? 'NEW_QUARTER_AVAILABLE' : 'UP_TO_DATE'}`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_new_data=${isNew}\ndownload_url=${latest.url}\nfile_name=${latest.filename}\nfy=${latest.fy}\nquarter=${latest.quarter}\n`);
}
