import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const inputFile = process.argv[2];
if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}. Provide a valid LCA XLSX or CSV file.`);
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

function createSlugGenerator() {
  const existingSlugs = new Set();
  return function generateSlug(name) {
    let baseSlug = String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!baseSlug) baseSlug = 'employer';

    let slug = baseSlug;
    let counter = 1;
    while (existingSlugs.has(slug)) {
      counter++;
      slug = `${baseSlug}-${counter}`;
    }
    existingSlugs.add(slug);
    return slug;
  };
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
  if (/\b(IV|4)\b/.test(u) || u.includes('LEVEL IV')) return 'L4';
  if (/\b(III|3)\b/.test(u) || u.includes('LEVEL III')) return 'L3';
  if (/\b(II|2)\b/.test(u) || u.includes('LEVEL II')) return 'L2';
  if (/\b(I|1)\b/.test(u) || u.includes('LEVEL I')) return 'L1';
  return null;
}

function createStats(name) {
  return {
    originalName: name,
    totalLCAs: 0,
    approvedLCAs: 0,
    wages: [],
    titles: new Map(),
    states: new Map(),
    wageLevels: { L1: 0, L2: 0, L3: 0, L4: 0 },
  };
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

  const status = String(row.CASE_STATUS ?? '').toUpperCase();
  if (status.includes('CERTIFIED')) {
    stats.approvedLCAs++;
  }

  const wage = annualizeWage(row.WAGE_RATE_OF_PAY_FROM, row.WAGE_UNIT_OF_PAY_FROM || row.WAGE_UNIT_OF_PAY || row.WAGE_RATE_OF_PAY_UNIT);
  if (wage && wage >= 20_000 && wage <= 2_000_000) {
    stats.wages.push(wage);
  }

  addCount(stats.titles, row.SOC_TITLE || row.SOC_NAME || row.JOB_TITLE, 100);
  addCount(stats.states, String(row.WORKSITE_STATE || row.EMPLOYER_STATE || '').toUpperCase(), 50);

  const level = levelKey(row.PW_WAGE_LEVEL);
  if (level) stats.wageLevels[level]++;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells;
}

async function streamCsv(file, consume) {
  let buffer = '';
  let headers = null;
  let rows = 0;
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8' })) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const values = parseCsvLine(line);
      if (!headers) {
        headers = values.map((v) => v.trim().toUpperCase());
      } else {
        const row = {};
        headers.forEach((h, i) => {
          row[h] = values[i] ?? '';
        });
        consume(row);
        rows++;
      }
    }
  }
  if (buffer.trim() && headers) {
    const values = parseCsvLine(buffer);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    consume(row);
    rows++;
  }
  return rows;
}

function loadSharedStrings(dir) {
  const file = path.join(dir, 'xl', 'sharedStrings.xml');
  if (!fs.existsSync(file)) return [];
  const xml = fs.readFileSync(file, 'utf8');
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1])).join('')
  );
}

function extractXlsx(xlsxPath, targetDir) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const resolvedXlsx = path.resolve(xlsxPath);
  const resolvedTarget = path.resolve(targetDir);

  try {
    if (process.platform === 'win32') {
      const normXlsx = resolvedXlsx.replace(/\\/g, '/');
      const normTarget = resolvedTarget.replace(/\\/g, '/');
      try {
        execSync(`tar.exe -xf "${normXlsx}" -C "${normTarget}"`, { stdio: 'pipe' });
        return;
      } catch {}
      const psCmd = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${resolvedXlsx.replace(/'/g, "''")}', '${resolvedTarget.replace(/'/g, "''")}')`;
      execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { stdio: 'pipe' });
    } else {
      try {
        execFileSync('unzip', ['-oq', resolvedXlsx, '-d', resolvedTarget]);
      } catch {
        execSync(`tar -xf "${resolvedXlsx}" -C "${resolvedTarget}"`, { stdio: 'pipe' });
      }
    }
  } catch (err) {
    throw new Error(`Failed to extract XLSX: ${err.message}`);
  }
}

async function streamXlsx(file, consume) {
  extractXlsx(file, XLSX_DIR);
  const strings = loadSharedStrings(XLSX_DIR);
  const sheet = path.join(XLSX_DIR, 'xl', 'worksheets', 'sheet1.xml');
  if (!fs.existsSync(sheet)) throw new Error('First worksheet not found in XLSX');

  let buffer = '';
  let headers = null;
  let rows = 0;
  for await (const chunk of fs.createReadStream(sheet, { encoding: 'utf8', highWaterMark: 128 * 1024 })) {
    buffer += chunk;
    while (true) {
      const start = buffer.indexOf('<row');
      const end = buffer.indexOf('</row>', start);
      if (start < 0 || end < 0) {
        if (start > 0) buffer = buffer.slice(start);
        break;
      }
      const rowXml = buffer.slice(start, end + 6);
      buffer = buffer.slice(end + 6);
      const row = {};
      for (const cell of rowXml.matchAll(/<c\s+([^>]*?r="([A-Z]+)\d+"[^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1];
        const col = cell[2];
        const body = cell[3];
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? '';
        row[col] = decodeXml(type === 's' ? strings[Number(raw)] ?? '' : raw);
      }
      if (!headers) {
        headers = Object.fromEntries(Object.entries(row).map(([col, value]) => [col, String(value).trim().toUpperCase()]));
      } else {
        const normalized = {};
        for (const [col, value] of Object.entries(row)) {
          if (headers[col]) normalized[headers[col]] = value;
        }
        consume(normalized);
        rows++;
      }
    }
  }
  fs.rmSync(XLSX_DIR, { recursive: true, force: true });
  return rows;
}

function buildOutput(employers, file) {
  const fyMatch = file.match(/FY(\d{4})/i);
  const fiscalYear = fyMatch ? parseInt(fyMatch[1], 10) : new Date().getUTCFullYear();
  const qMatch = file.match(/(?:_|-)Q(\d)/i) || file.match(/Q(\d)/i);
  const quarter = qMatch ? parseInt(qMatch[1], 10) : 4;

  const generateSlug = createSlugGenerator();
  const sortedStats = [...employers.values()].sort((a, b) => b.totalLCAs - a.totalLCAs);

  const records = sortedStats.map((stats) => {
    const slug = generateSlug(stats.originalName);
    const approvalRate = stats.totalLCAs ? Number(((stats.approvedLCAs / stats.totalLCAs) * 100).toFixed(2)) : 0;

    let avgWage = 0;
    let medianWage = 0;
    if (stats.wages.length > 0) {
      stats.wages.sort((a, b) => a - b);
      avgWage = Math.round(stats.wages.reduce((a, b) => a + b, 0) / stats.wages.length);
      medianWage = Math.round(stats.wages[Math.floor(stats.wages.length / 2)]);
    }

    let grade = 'C';
    if (stats.totalLCAs >= 50 && approvalRate >= 95) grade = 'A';
    else if (stats.totalLCAs >= 20 && approvalRate >= 85) grade = 'B';
    else if (approvalRate >= 80) grade = 'B';

    const topTitles = [...stats.titles.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([title, count]) => ({ title, count, avgWage: 0, socCode: '' }));

    const topStates = [...stats.states.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([state, count]) => ({ state, count }));

    return {
      employerName: stats.originalName,
      slug,
      totalLCAs: stats.totalLCAs,
      approvalRate,
      avgWage,
      medianWage,
      topTitles,
      topStates,
      wageLevelDist: stats.wageLevels,
      fiscalYear,
      quarter,
      grade,
      lastUpdated: new Date().toISOString(),
    };
  });

  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(records, null, 2));
  console.log(`Wrote ${records.length} employer records to ${OUTPUT}`);
}

async function main() {
  const employers = new Map();
  const rows = inputFile.toLowerCase().endsWith('.csv')
    ? await streamCsv(inputFile, (row) => consumeRow(row, employers))
    : await streamXlsx(inputFile, (row) => consumeRow(row, employers));

  if (!rows || !employers.size) throw new Error('No valid LCA rows found');
  console.log(`Processed ${rows} rows across ${employers.size} employers`);
  buildOutput(employers, inputFile);
}

main().catch((error) => {
  try {
    fs.rmSync(XLSX_DIR, { recursive: true, force: true });
  } catch {}
  console.error(`LCA processing failed: ${error.message}`);
  process.exit(1);
});
