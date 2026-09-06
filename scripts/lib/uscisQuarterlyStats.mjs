import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';
import { fetchWithBypass } from './fetchClient.mjs';

const OUT_DIR = path.join(process.cwd(), 'src', 'content', 'uscisQuarterlyStats');
const LANDING_PAGE_URL = 'https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data';

// Map of canonical form types to names and descriptions
const FORM_METADATA = {
  'I-129': { name: 'Petition for a Nonimmigrant Worker', category: 'Employment Based' },
  'I-140': { name: 'Immigrant Petition for Alien Worker', category: 'Employment Based' },
  'I-485': { name: 'Application to Register Permanent Residence or Adjust Status', category: 'Adjustment of Status' },
  'N-400': { name: 'Application for Naturalization', category: 'Naturalization' },
  'I-130': { name: 'Petition for Alien Relative', category: 'Family Based' },
  'I-765': { name: 'Application for Employment Authorization', category: 'Employment' },
  'I-131': { name: 'Application for Travel Documents, Parole Documents, and Arrival/Departure Records', category: 'Travel/Parole' },
  'I-90': { name: 'Application to Replace Permanent Resident Card', category: 'Permanent Residence' },
  'I-526': { name: 'Immigrant Petition by Standalone Investor', category: 'Investment Based' },
  'I-829': { name: 'Petition by Investor to Remove Conditions on Permanent Resident Status', category: 'Investment Based' },
  'I-751': { name: 'Petition to Remove Conditions on Residence', category: 'Family Based' },
  'I-539': { name: 'Application To Extend/Change Nonimmigrant Status', category: 'Nonimmigrant' },
  'I-129F': { name: 'Petition for Alien Fiancé(e)', category: 'Family Based' },
};

function safeWriteFileSync(filePath, content, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      const waitMs = 50 * Math.pow(2, i);
      const start = Date.now();
      while (Date.now() - start < waitMs) {}
    }
  }
}

/**
 * Discover the latest quarterly "All Forms" report URL from USCIS open data page.
 */
async function discoverLatestReportUrl() {
  const html = await fetchWithBypass(LANDING_PAGE_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    renderJs: false,
    timeout: 30000
  });

  const $ = cheerio.load(html);

  let targetHref = null;
  let targetTitle = null;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (
      href &&
      (href.includes('quarterly_all_forms') || href.includes('all_forms')) &&
      (href.endsWith('.xlsx') || href.endsWith('.csv') || href.includes('.xlsx?') || href.includes('.csv?'))
    ) {
      targetHref = href;
      targetTitle = text;
      return false; // take first/latest match
    }
  });

  if (!targetHref) {
    throw new Error('Could not find matching "quarterly_all_forms" dataset link on USCIS open data landing page.');
  }

  const fullUrl = targetHref.startsWith('http') ? targetHref : `https://www.uscis.gov${targetHref.startsWith('/') ? '' : '/'}${targetHref}`;

  // Parse Fiscal Year and Quarter dynamically from filename, URL, or title
  // e.g. quarterly_all_forms_fy2026_q2_v1.xlsx -> fy: 2026, q: 2
  const match = fullUrl.match(/fy(\d{4})_q(\d)/i) || fullUrl.match(/fy(\d{2})_q(\d)/i) || targetTitle?.match(/Fiscal Year (\d{4}), Quarter (\d)/i);
  if (!match) {
    throw new Error(`Dynamic quarterly auto-detect failed: Could not extract Fiscal Year and Quarter from discovered URL "${fullUrl}" or title "${targetTitle}".`);
  }

  let y = parseInt(match[1], 10);
  if (y < 100) y += 2000;
  const fiscalYear = y;
  const quarter = parseInt(match[2], 10);

  return { url: fullUrl, title: targetTitle, fiscalYear, quarter };
}

/**
 * Fetch and parse official USCIS quarterly open data spreadsheet.
 */
export async function fetchUSCISQuarterlyStats({ seedOnly = false } = {}) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let liveCount = 0;
  let staleCount = 0;
  let seedCount = 0;
  let lastError = null;

  if (!seedOnly) {
    try {
      console.log('  [uscisQuarterlyStats] Discovering latest official quarterly report on uscis.gov...');
      const discovery = await discoverLatestReportUrl();
      console.log(`  [uscisQuarterlyStats] Discovered: ${discovery.title || discovery.url} (FY${discovery.fiscalYear} Q${discovery.quarter})`);

      const res = await fetch(discovery.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to download spreadsheet: HTTP ${res.status} (${res.statusText})`);
      }

      const buffer = await res.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      if (!rows || rows.length < 5) {
        throw new Error('Spreadsheet parsing canary failed: sheet is empty or has invalid header layout.');
      }

      // Group rows by base form type (e.g. "I-485", "I-140", "I-129", "N-400", "I-130", etc.)
      const parsedForms = new Map();

      for (const r of rows) {
        if (!r || !r[0] || typeof r[0] !== 'string') continue;
        const rawFormNum = r[0].trim();
        // Match forms like I-129, I-140, I-485, N-400, I-130, I-765, etc. (cleaning footnote numbers like I-5269 -> I-526)
        const match = rawFormNum.match(/^([IN]-\d{2,4}[A-Z]?)/i);
        if (!match) continue;

        const baseForm = match[1].toUpperCase();
        const formTitle = (r[1] ? String(r[1]).trim() : '') || FORM_METADATA[baseForm]?.name || baseForm;
        const receipts = typeof r[2] === 'number' ? r[2] : parseInt(r[2], 10) || 0;
        const approved = typeof r[3] === 'number' ? r[3] : parseInt(r[3], 10) || 0;
        const denied = typeof r[4] === 'number' ? r[4] : parseInt(r[4], 10) || 0;
        const completions = typeof r[5] === 'number' ? r[5] : parseInt(r[5], 10) || (approved + denied);
        const pending = typeof r[6] === 'number' ? r[6] : parseInt(r[6], 10) || 0;
        const procTimeVal = r[7];
        const processingTimeMonths = typeof procTimeVal === 'number' ? procTimeVal : (parseFloat(procTimeVal) || null);

        if (!parsedForms.has(baseForm)) {
          parsedForms.set(baseForm, {
            formType: baseForm,
            formName: FORM_METADATA[baseForm]?.name || formTitle,
            category: FORM_METADATA[baseForm]?.category || 'General',
            fiscalYear: discovery.fiscalYear,
            quarter: discovery.quarter,
            receipts: 0,
            approved: 0,
            denied: 0,
            completions: 0,
            pending: 0,
            processingTimeMonths: null,
            subtypes: [],
          });
        }

        const entry = parsedForms.get(baseForm);
        entry.receipts += receipts;
        entry.approved += approved;
        entry.denied += denied;
        entry.completions += completions;
        entry.pending += pending;
        if (processingTimeMonths !== null && (entry.processingTimeMonths === null || processingTimeMonths > 0)) {
          entry.processingTimeMonths = processingTimeMonths;
        }

        entry.subtypes.push({
          subtypeName: formTitle,
          receipts,
          approved,
          denied,
          completions,
          pending,
          processingTimeMonths,
        });
      }

      // Write verified records to disk for all canonical forms
      for (const [formType, data] of parsedForms.entries()) {
        const filename = `${formType}-FY${discovery.fiscalYear}-Q${discovery.quarter}.json`.toLowerCase();
        const outPath = path.join(OUT_DIR, filename);

        const record = {
          formType: data.formType,
          formName: data.formName,
          category: data.category,
          fiscalYear: data.fiscalYear,
          quarter: data.quarter,
          receipts: data.receipts,
          approved: data.approved,
          denied: data.denied,
          completions: data.completions,
          pending: data.pending,
          processingTimeMonths: data.processingTimeMonths,
          approvalRate: data.completions > 0 ? +((data.approved / data.completions) * 100).toFixed(1) : null,
          denialRate: data.completions > 0 ? +((data.denied / data.completions) * 100).toFixed(1) : null,
          subtypes: data.subtypes,
          dataSource: `official-uscis-quarterly-report-fy${discovery.fiscalYear}-q${discovery.quarter}`,
          reportUrl: discovery.url,
          sourceUrl: LANDING_PAGE_URL,
          lastUpdated: new Date().toISOString(),
        };

        safeWriteFileSync(outPath, JSON.stringify(record, null, 2));
        liveCount++;
      }
    } catch (err) {
      lastError = err.message || String(err);
      console.warn(`  [uscisQuarterlyStats] Live fetch failed (${lastError}). Preserving existing curated data.`);
    }
  }

  // Preserve existing records or seed if missing
  const existingFiles = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json')) : [];

  if (liveCount === 0) {
    if (existingFiles.length > 0) {
      staleCount = existingFiles.length;
      for (const file of existingFiles) {
        const filePath = path.join(OUT_DIR, file);
        try {
          const prev = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (!prev.staleSince) {
            prev.staleSince = new Date().toISOString();
            safeWriteFileSync(filePath, JSON.stringify(prev, null, 2));
          }
        } catch {}
      }
    } else {
      // Deterministic bootstrap only if directory is completely empty
      const bootstrapForms = ['I-129', 'I-140', 'I-485', 'N-400'];
      for (const formType of bootstrapForms) {
        const filename = `${formType}-FY2026-Q2.json`.toLowerCase();
        const outPath = path.join(OUT_DIR, filename);
        const record = {
          formType,
          formName: FORM_METADATA[formType]?.name || formType,
          category: FORM_METADATA[formType]?.category || 'General',
          fiscalYear: 2026,
          quarter: 2,
          receipts: 100000,
          approved: 90000,
          denied: 10000,
          completions: 100000,
          pending: 250000,
          processingTimeMonths: 6.0,
          dataSource: 'seed',
          sourceUrl: LANDING_PAGE_URL,
          lastUpdated: new Date().toISOString(),
          staleSince: new Date().toISOString(),
        };
        safeWriteFileSync(outPath, JSON.stringify(record, null, 2));
        seedCount++;
      }
    }
  }

  console.log(`[uscisQuarterlyStats] finished (${liveCount} live parsed, ${staleCount} preserved/stale, ${seedCount} bootstrap).`);
  return { liveCount, staleCount, seedCount, lastError };
}
