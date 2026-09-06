import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const inputFile = process.argv[2];
if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('Usage: node scripts/process-lca-cache.mjs <path-to-xlsx-or-csv>');
  process.exit(1);
}

const TMP_DIR = path.join(process.cwd(), 'tmp');
const XLSX_DIR = path.join(TMP_DIR, `lca-xlsx-${process.pid}`);
const OUTPUT = path.join(TMP_DIR, 'lca-aggregated-cache.json');
const XML_ESCAPES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value = '') {
  return String(value).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return XML_ESCAPES[lower] ?? _;
  });
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'employer';
}

function parseNumber(value) {
  const n = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function annualizeWage(value, unit) {
  const n = parseNumber(value);
  if (n === null || n <= 0) return null;
  const u = String(unit ?? '').toUpperCase();
  if (u.includes('HOUR') || u === 'HR' || (n < 500 && !u.includes('YEAR') && !u.includes('YR'))) return n * 2080;
  if (u.includes('MONTH') || u === 'MTH') return n * 12;
  if (u.includes('WEEK') || u === 'WK') return n * 52;
  return n;
}

function levelKey(value) {
  const u = String(value ?? '').toUpperCase();
  if (/\b(IV|4)\b/.test(u)) return 'L4';
  if (/\b(III|3)\b/.test(u)) return 'L3';
  if (/\b(II|2)\b/.test(u)) return 'L2';
  if (/\b(I|1)\b/.test(u)) return 'L1';
  return null;
}

function createStats(name) {
  return { originalName: name, totalLCAs: 0, approvedLCAs: 0, wageSum: 0, wageCount: 0, wageHistogram: new Map(), titles: new Map(), states: new Map(), wageLevels: { L1: 0, L2: 0, L3: 0, L4: 0 } };
}

// Fixed-width histogram: bounded memory while retaining a stable median estimate.
function addWage(stats, wage) {
  if (wage < 20_000 || wage > 2_000_000) return;
  stats.wageSum += wage;
  stats.wageCount++;
  const bucket = Math.min(399, Math.max(0, Math.floor(wage / 5_000)));
  stats.wageHistogram.set(bucket, (stats.wageHistogram.get(bucket) || 0) + 1);
}

function medianFromHistogram(stats) {
  if (!stats.wageCount) return 0;
  const target = Math.ceil(stats.wageCount / 2);
  let seen = 0;
  for (const bucket of [...stats.wageHistogram.keys()].sort((a, b) => a - b)) {
    seen += stats.wageHistogram.get(bucket);
    if (seen >= target) return bucket * 5_000 + 2_500;
  }
  return 0;
}

function addCount(map, value, limit = 100) {
  const key = String(value ?? '').trim();
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
  if (map.size > limit * 2) {
    const keep = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    map.clear();
    for (const [k, v] of keep) map.set(k, v);
  }
}

function consumeRow(row, employers) {
  const employer = row.EMPLOYER_NAME || row.EMPLOYER_BUSINESS_NAME || row.EMPLOYER_LEGAL_BUSINESS_NAME;
  const name = String(employer ?? '').trim();
  if (!name) return;
  const key = name.toUpperCase();
  if (!employers.has(key)) employers.set(key, createStats(name));
  const stats = employers.get(key);
  stats.totalLCAs++;
  if (String(row.CASE_STATUS ?? '').toUpperCase().includes('CERTIFIED')) stats.approvedLCAs++;
  addWage(stats, annualizeWage(row.WAGE_RATE_OF_PAY_FROM, row.WAGE_UNIT_OF_PAY_FROM || row.WAGE_UNIT_OF_PAY || row.WAGE_RATE_OF_PAY_UNIT));
  addCount(stats.titles, row.SOC_TITLE || row.SOC_NAME || row.JOB_TITLE, 100);
  addCount(stats.states, String(row.WORKSITE_STATE || row.EMPLOYER_STATE || '').toUpperCase(), 50);
  const level = levelKey(row.PW_WAGE_LEVEL);
  if (level) stats.wageLevels[level]++;
}

function parseCsvLine(line) {
  const cells = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

async function streamCsv(file, consume) {
  let buffer = ''; let headers = null; let rows = 0;
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8' })) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const values = parseCsvLine(line);
      if (!headers) headers = values.map(v => v.trim().toUpperCase());
      else { const row = {}; headers.forEach((h, i) => { row[h] = values[i] ?? ''; }); consume(row); rows++; }
    }
  }
  if (buffer.trim() && headers) { const values = parseCsvLine(buffer); const row = {}; headers.forEach((h, i) => { row[h] = values[i] ?? ''; }); consume(row); rows++; }
  return rows;
}

function loadSharedStrings(dir) {
  const file = path.join(dir, 'xl', 'sharedStrings.xml');
  if (!fs.existsSync(file)) return [];
  const xml = fs.readFileSync(file, 'utf8');
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1])).join(''));
}

async function streamXlsx(file, consume) {
  fs.mkdirSync(XLSX_DIR, { recursive: true });
  execFileSync('unzip', ['-oq', file, '-d', XLSX_DIR]);
  const strings = loadSharedStrings(XLSX_DIR);
  const sheet = path.join(XLSX_DIR, 'xl', 'worksheets', 'sheet1.xml');
  if (!fs.existsSync(sheet)) throw new Error('First worksheet not found in XLSX');
  let buffer = ''; let headers = null; let rows = 0;
  for await (const chunk of fs.createReadStream(sheet, { encoding: 'utf8', highWaterMark: 128 * 1024 })) {
    buffer += chunk;
    while (true) {
      const start = buffer.indexOf('<row'); const end = buffer.indexOf('</row>', start);
      if (start < 0 || end < 0) { if (start > 0) buffer = buffer.slice(start); break; }
      const rowXml = buffer.slice(start, end + 6); buffer = buffer.slice(end + 6);
      const row = {};
      for (const cell of rowXml.matchAll(/<c\s+([^>]*?r="([A-Z]+)\d+"[^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1]; const col = cell[2]; const body = cell[3];
        const type = attrs.match(/\bt="([^"]+)"/)?.[1]; const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? '';
        row[col] = decodeXml(type === 's' ? (strings[Number(raw)] ?? '') : raw);
      }
      if (!headers) headers = Object.fromEntries(Object.entries(row).map(([col, value]) => [col, String(value).trim().toUpperCase()]));
      else { const normalized = {}; for (const [col, value] of Object.entries(row)) if (headers[col]) normalized[headers[col]] = value; consume(normalized); rows++; }
    }
  }
  fs.rmSync(XLSX_DIR, { recursive: true, force: true });
  return rows;
}

function buildOutput(employers, file) {
  const fiscalYear = Number(file.match(/FY(\d{4})/i)?.[1] || new Date().getUTCFullYear());
  const quarter = Number(file.match(/(?:_|-)Q(\d)/i)?.[1] || 4);
  const slugCounts = new Map();
  const records = [...employers.values()].map(stats => {
    const base = slugify(stats.originalName); const n = (slugCounts.get(base) || 0) + 1; slugCounts.set(base, n);
    const slug = n === 1 ? base : `${base}-${n}`;
    const approvalRate = stats.totalLCAs ? Number(((stats.approvedLCAs / stats.totalLCAs) * 100).toFixed(2)) : 0;
    const grade = stats.totalLCAs >= 50 && approvalRate >= 95 ? 'A' : stats.totalLCAs >= 20 && approvalRate >= 85 ? 'B' : 'C';
    return { employerName: stats.originalName, slug, totalLCAs: stats.totalLCAs, approvalRate, avgWage: stats.wageCount ? Math.round(stats.wageSum / stats.wageCount) : 0, medianWage: Math.round(medianFromHistogram(stats)), topTitles: [...stats.titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([title, count]) => ({ title, count, avgWage: 0, socCode: '' })), topStates: [...stats.states.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([state, count]) => ({ state, count })), wageLevelDist: stats.wageLevels, fiscalYear, quarter, grade, lastUpdated: new Date().toISOString() };
  }).sort((a, b) => b.totalLCAs - a.totalLCAs);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(records));
  console.log(`Wrote ${records.length} employer records to ${OUTPUT}`);
}

try {
  const employers = new Map();
  const rows = inputFile.toLowerCase().endsWith('.csv') ? await streamCsv(inputFile, row => consumeRow(row, employers)) : await streamXlsx(inputFile, row => consumeRow(row, employers));
  if (!rows || !employers.size) throw new Error('No valid LCA rows found');
  console.log(`Processed ${rows} rows across ${employers.size} employers`);
  buildOutput(employers, inputFile);
} catch (error) {
  try { fs.rmSync(XLSX_DIR, { recursive: true, force: true }); } catch {}
  console.error(`LCA processing failed: ${error.message}`);
  process.exit(1);
}
