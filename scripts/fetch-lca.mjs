import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as cheerio from 'cheerio';

const DOL_URL = 'https://www.dol.gov/agencies/eta/foreign-labor/performance';
const DOWNLOAD_DIR = path.join(process.cwd(), 'tmp');

async function main() {
  console.log(`Fetching DOL Performance Page: ${DOL_URL}...`);
  const res = await fetch(DOL_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;'
    }
  });

  if (!res.ok) {
    console.error(`Failed to load DOL page: ${res.statusText}`);
    process.exit(1);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const matches = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    
    // Match LCA Disclosure Data specifically.
    // Handles typos like "LCA_Dislclosure_Data" that we saw in the test script.
    const fileMatch = href.match(/LCA_Dis[a-z]*_Data_FY(\d{4})_Q(\d)\.(xlsx|csv)/i);
    if (fileMatch) {
      const fy = parseInt(fileMatch[1], 10);
      const quarter = parseInt(fileMatch[2], 10);
      const ext = fileMatch[3].toLowerCase();
      
      let url = href;
      if (url.startsWith('/')) {
        url = `https://www.dol.gov${url.replace(/^\/+/, '/')}`;
      }
      url = url.replace('https://www.dol.gov//', 'https://www.dol.gov/');
      
      matches.push({ fy, quarter, ext, url, filename: href.split('/').pop() });
    }
  });

  matches.sort((a, b) => b.fy - a.fy || b.quarter - a.quarter);
  
  if (matches.length === 0) {
    console.error('Could not find any LCA disclosure files on the page.');
    process.exit(1);
  }

  const latest = matches[0];
  console.log(`Found latest disclosure file: FY${latest.fy} Q${latest.quarter} - ${latest.filename}`);
  console.log(`Download URL: ${latest.url}`);
  
  // Set output path in next step.
  console.log(`\nTo run the import:`);
  console.log(`1. node scripts/download.mjs ${latest.url}`);
  console.log(`2. node scripts/parse-lca.mjs ./tmp/${latest.filename}`);
}

main().catch(console.error);
