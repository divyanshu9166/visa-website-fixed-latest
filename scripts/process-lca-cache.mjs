import fs from 'fs';
import path from 'path';
<<<<<<< HEAD
import { execSync } from 'child_process';
=======
import * as xlsx from 'xlsx';
>>>>>>> divyanshu/master

const inputFile = process.argv[2];

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}. Provide a valid LCA XLSX or CSV file.`);
<<<<<<< HEAD
  console.error('Usage: node scripts/process-lca-cache.mjs <path-to-xlsx-or-csv>');
  process.exit(1);
}

function unescapeXml(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
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

async function extractXlsx(xlsxPath, targetDir) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const resolvedXlsx = path.resolve(xlsxPath);
  const resolvedTarget = path.resolve(targetDir);

  console.log(`Extracting ${resolvedXlsx} to ${resolvedTarget}...`);
  try {
    // Try tar.exe with forward slashes (standard on Windows 10/11)
    const normXlsx = resolvedXlsx.replace(/\\/g, '/');
    const normTarget = resolvedTarget.replace(/\\/g, '/');
    execSync(`tar.exe -xf "${normXlsx}" -C "${normTarget}"`, { stdio: 'pipe' });
  } catch (err) {
    // PowerShell .NET extraction
    if (process.platform === 'win32') {
      const psCmd = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${resolvedXlsx.replace(/'/g, "''")}', '${resolvedTarget.replace(/'/g, "''")}')`;
      execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { stdio: 'inherit' });
    } else {
      throw err;
    }
  }
}

async function parseSharedStrings(ssPath) {
  console.log('Loading shared strings index...');
  if (!fs.existsSync(ssPath)) {
    console.log('No sharedStrings.xml found (inline strings used).');
    return [];
  }
  const ssContent = fs.readFileSync(ssPath, 'utf8');
  const strings = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(ssContent)) !== null) {
    const si = match[1];
    const tMatches = si.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g);
    if (tMatches) {
      const text = tMatches.map(t => {
        const inner = t.replace(/^<t(?:\s+[^>]*)?>/, '').replace(/<\/t>$/, '');
        return unescapeXml(inner);
      }).join('');
      strings.push(text);
    } else {
      strings.push('');
    }
  }
  console.log(`Loaded ${strings.length} shared strings.`);
  return strings;
}

async function processXlsxStream(extractedDir, onRow) {
  const ssPath = path.join(extractedDir, 'xl', 'sharedStrings.xml');
  const sheetPath = path.join(extractedDir, 'xl', 'worksheets', 'sheet1.xml');

  if (!fs.existsSync(sheetPath)) {
    throw new Error(`sheet1.xml not found in ${extractedDir}`);
  }

  const strings = await parseSharedStrings(ssPath);
  console.log(`Streaming rows from ${sheetPath}...`);

  const readStream = fs.createReadStream(sheetPath, {
    encoding: 'utf8',
    highWaterMark: 128 * 1024
  });

  let buffer = '';
  let rowCount = 0;
  let headerMap = {};

  for await (const chunk of readStream) {
    buffer += chunk;
    let rowStart = buffer.indexOf('<row ');
    while (rowStart !== -1) {
      const rowEnd = buffer.indexOf('</row>', rowStart);
      if (rowEnd === -1) {
        buffer = buffer.substring(rowStart);
        break;
      }

      const rowXml = buffer.substring(rowStart, rowEnd + 6);
      buffer = buffer.substring(rowEnd + 6);
      rowCount++;

      const cellMatches = rowXml.match(/<c\s+r="([A-Z]+)\d+"(?:[^>]*\st="([a-z]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g);
      if (cellMatches) {
        const cells = {};
        for (const c of cellMatches) {
          const colMatch = c.match(/r="([A-Z]+)\d+"/);
          const typeMatch = c.match(/t="([a-z]+)"/);
          const valMatch = c.match(/<v>([\s\S]*?)<\/v>/);

          if (!colMatch) continue;
          const col = colMatch[1];
          const type = typeMatch ? typeMatch[1] : null;
          let val = valMatch ? valMatch[1] : '';

          if (type === 's') {
            const idx = parseInt(val, 10);
            val = strings[idx] !== undefined ? strings[idx] : '';
          } else if (val) {
            val = unescapeXml(val);
          }
          cells[col] = val;
        }

        if (rowCount === 1) {
          headerMap = {};
          for (const [col, val] of Object.entries(cells)) {
            headerMap[col] = String(val || '').trim().toUpperCase();
          }
          console.log(`Identified ${Object.keys(headerMap).length} columns in header row.`);
        } else {
          const rowObj = {};
          for (const [col, val] of Object.entries(cells)) {
            const headerName = headerMap[col];
            if (headerName) rowObj[headerName] = val;
          }
          onRow(rowObj, rowCount - 1);
        }
      }

      if (rowCount % 100000 === 0) {
        console.log(`Processed ${rowCount} rows...`);
      }

      rowStart = buffer.indexOf('<row ');
    }
  }

  console.log(`Completed parsing all ${rowCount - 1} data rows.`);
}

async function processCsvStream(csvPath, onRow) {
  console.log(`Streaming CSV from ${csvPath}...`);
  const data = fs.readFileSync(csvPath, 'utf-8');
  const lines = data.split(/\r?\n/);
  if (lines.length === 0) return;

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]).map(h => String(h || '').trim().toUpperCase());
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const rowObj = {};
    headers.forEach((h, idx) => { rowObj[h] = values[idx] || ''; });
    onRow(rowObj, i);
    if (i % 100000 === 0) {
      console.log(`Processed ${i} rows...`);
    }
  }
}

async function main() {
  console.log(`=== Processing LCA Dataset: ${inputFile} ===`);

  const employers = new Map();
  let lineCount = 0;

  const handleRow = (row) => {
    lineCount++;
    const employerName = row['EMPLOYER_NAME'] || row['EMPLOYER_BUSINESS_NAME'] || row['EMPLOYER_LEGAL_BUSINESS_NAME'];
    const caseStatus = row['CASE_STATUS'];
    const wageStr = row['WAGE_RATE_OF_PAY_FROM'];
    const wageUnit = row['WAGE_UNIT_OF_PAY_FROM'] || row['WAGE_UNIT_OF_PAY'] || row['WAGE_RATE_OF_PAY_UNIT'];
    const socTitle = row['SOC_TITLE'] || row['SOC_NAME'] || row['JOB_TITLE'];
    const state = row['WORKSITE_STATE'] || row['EMPLOYER_STATE'];
    const wageLevel = row['PW_WAGE_LEVEL'];

    if (!employerName) return;
    const trimmedName = String(employerName).trim();
    if (!trimmedName) return;

    const empNameUpper = trimmedName.toUpperCase();
    if (!employers.has(empNameUpper)) {
      employers.set(empNameUpper, {
        originalName: trimmedName,
=======
  process.exit(1);
}

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  console.log(`Loading LCA data from ${inputFile}...`);
  // For huge files, xlsx.readFile might blow up heap. 
  // Let's use it for now, and see if it handles a subset or needs a streaming reader internally length.
  
  // To avoid running out of memory on GitHub Actions for a 250MB XLSX file, 
  // in production we should stream this. But let's build the aggregation logic first.
  
  let rows = [];
  
  if (inputFile.endsWith('.csv')) {
      // (This path isn't typical for the quarterly run, but kept for legacy compat)
      const data = fs.readFileSync(inputFile, 'utf-8');
      rows = data.split('\n').map(l => l.split(',')); 
      // Very basic local CSV stub
  } else {
      console.log('Parsing XLSX file (this may take a while and consume memory)...');
      // Adding cellDates and dense mode to reduce memory footprint
      const workbook = xlsx.readFile(inputFile, { cellDates: true, dense: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // Convert sheet to JSON array of arrays
      rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  }

  if (rows.length === 0) {
      console.error('No rows found.');
      process.exit(1);
  }

  const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
  const employers = new Map();
  let lineCount = 0;

  console.log('Aggregating statistics...');

  for (let i = 1; i < rows.length; i++) {
    const rowArray = rows[i];
    if (!rowArray || rowArray.length === 0) continue;

    lineCount++;
    if (lineCount % 10000 === 0) {
      console.log(`Processed ${lineCount} rows...`);
    }

    const row = {};
    headers.forEach((h, idx) => { row[h] = rowArray[idx]; });

    const employerName = row['EMPLOYER_NAME'] || row['EMPLOYER_BUSINESS_NAME'];
    const caseStatus = row['CASE_STATUS'];
    const wageStr = row['WAGE_RATE_OF_PAY_FROM'];
    const socTitle = row['SOC_TITLE'] || row['SOC_NAME'];
    const state = row['WORKSITE_STATE'];
    const wageLevel = row['PW_WAGE_LEVEL'];

    if (!employerName) continue;

    const empNameUpper = String(employerName).trim().toUpperCase();
    if (!employers.has(empNameUpper)) {
      employers.set(empNameUpper, {
        originalName: String(employerName).trim(),
>>>>>>> divyanshu/master
        totalLCAs: 0,
        approvedLCAs: 0,
        wages: [],
        titles: {},
        states: {},
        wageLevels: { L1: 0, L2: 0, L3: 0, L4: 0 }
      });
    }

    const emp = employers.get(empNameUpper);
    emp.totalLCAs++;

    if (caseStatus && String(caseStatus).toUpperCase().includes('CERTIFIED')) {
      emp.approvedLCAs++;
    }

<<<<<<< HEAD
    if (wageStr !== undefined && wageStr !== null && wageStr !== '') {
      let wage = 0;
      if (typeof wageStr === 'number') {
        wage = wageStr;
      } else {
        wage = parseFloat(String(wageStr).replace(/[^0-9.]/g, ''));
      }

      if (!isNaN(wage) && wage > 0) {
        const unit = String(wageUnit || '').trim().toUpperCase();
        if (unit.includes('HR') || unit.includes('HOUR') || (wage < 500 && !unit.includes('YR') && !unit.includes('YEAR'))) {
          wage = wage * 2080;
        } else if (unit.includes('MTH') || unit.includes('MONTH')) {
          wage = wage * 12;
        } else if (unit.includes('WK') || unit.includes('WEEK')) {
          wage = wage * 52;
        }

        if (wage >= 20000 && wage <= 2000000) {
          emp.wages.push(wage);
        }
=======
    if (wageStr) {
      // In XLSX, wage is often already a number. If it's a string, clean it.
      let wage = 0;
      if (typeof wageStr === 'number') {
          wage = wageStr;
      } else {
          wage = parseFloat(String(wageStr).replace(/[^0-9.]/g, ''));
      }
      
      if (!isNaN(wage) && wage > 0) {
        emp.wages.push(wage);
>>>>>>> divyanshu/master
      }
    }

    if (socTitle) {
      const s = String(socTitle).trim();
<<<<<<< HEAD
      if (s) {
        emp.titles[s] = (emp.titles[s] || 0) + 1;
      }
    }

    if (state) {
      const s = String(state).trim().toUpperCase();
      if (s && s.length === 2) {
        emp.states[s] = (emp.states[s] || 0) + 1;
      }
    }

    if (wageLevel) {
      const l = String(wageLevel).trim().toUpperCase();
      if (l.includes('IV') || l === 'LEVEL IV' || l === '4') emp.wageLevels.L4++;
      else if (l.includes('III') || l === 'LEVEL III' || l === '3') emp.wageLevels.L3++;
      else if (l.includes('II') || l === 'LEVEL II' || l === '2') emp.wageLevels.L2++;
      else if (l.includes('I') || l === 'LEVEL I' || l === '1') emp.wageLevels.L1++;
    }
  };

  const extractedDir = path.join(process.cwd(), 'tmp', 'lca_extracted_worker');

  if (inputFile.endsWith('.csv')) {
    await processCsvStream(inputFile, handleRow);
  } else {
    await extractXlsx(inputFile, extractedDir);
    await processXlsxStream(extractedDir, handleRow);
    // Cleanup temporary extracted directory
    try {
      fs.rmSync(extractedDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log(`Aggregation complete: ${lineCount} rows processed across ${employers.size} unique employers.`);

  // Extract Fiscal Year and Quarter from filename (e.g. FY2026_Q3)
  const fyMatch = inputFile.match(/FY(\d{4})/i);
  const fiscalYear = fyMatch ? parseInt(fyMatch[1], 10) : new Date().getFullYear();
  const qMatch = inputFile.match(/_Q(\d)/i) || inputFile.match(/Q(\d)/i);
  const quarter = qMatch ? parseInt(qMatch[1], 10) : 4;

  console.log(`Targeting Fiscal Year: ${fiscalYear}, Quarter: Q${quarter}`);

  // Deterministic slug generator
  const sortedKeys = Array.from(employers.keys()).sort();
  const generateSlug = createSlugGenerator();

  const dataToInsert = [];
  for (const key of sortedKeys) {
    const emp = employers.get(key);
=======
      emp.titles[s] = (emp.titles[s] || 0) + 1;
    }

    if (state) {
      const s = String(state).trim();
      emp.states[s] = (emp.states[s] || 0) + 1;
    }

    if (wageLevel) {
      let l = String(wageLevel).trim().toUpperCase();
      if (l.includes('I') && !l.includes('II')) emp.wageLevels.L1++;
      if (l.includes('II') && !l.includes('III')) emp.wageLevels.L2++;
      if (l.includes('III')) emp.wageLevels.L3++;
      if (l.includes('IV')) emp.wageLevels.L4++;
    }
  }

  console.log(`Aggregation complete. Found ${employers.size} unique employers.`);

  // Transform and dump to JSON
  const dataToInsert = [];
  for (const [_, emp] of employers) {
>>>>>>> divyanshu/master
    emp.wages.sort((a, b) => a - b);
    let avgWage = 0;
    let medianWage = 0;
    if (emp.wages.length > 0) {
      avgWage = emp.wages.reduce((a, b) => a + b, 0) / emp.wages.length;
      medianWage = emp.wages[Math.floor(emp.wages.length / 2)];
    }

    const topTitles = Object.entries(emp.titles)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([title, count]) => ({ title, count, avgWage: 0, socCode: '' }));

    const topStates = Object.entries(emp.states)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([state, count]) => ({ state, count }));

<<<<<<< HEAD
    const approvalRate = emp.totalLCAs > 0
      ? parseFloat(((emp.approvedLCAs / emp.totalLCAs) * 100).toFixed(2))
      : 0;

    let grade = 'C';
    if (emp.totalLCAs >= 50 && approvalRate >= 95) grade = 'A';
    else if (emp.totalLCAs >= 20 && approvalRate >= 85) grade = 'B';
    else if (approvalRate >= 80) grade = 'B';

    dataToInsert.push({
      employerName: emp.originalName,
      slug: generateSlug(emp.originalName),
      totalLCAs: emp.totalLCAs,
      approvalRate,
=======
    dataToInsert.push({
      employerName: emp.originalName,
      slug: generateSlug(emp.originalName) + '-' + Math.random().toString(36).substring(2, 7), // Ensure uniqueness
      totalLCAs: emp.totalLCAs,
      approvalRate: emp.totalLCAs > 0 ? parseFloat(((emp.approvedLCAs / emp.totalLCAs) * 100).toFixed(2)) : 0,
>>>>>>> divyanshu/master
      avgWage: Math.round(avgWage),
      medianWage: Math.round(medianWage),
      topTitles,
      topStates,
      wageLevelDist: emp.wageLevels,
<<<<<<< HEAD
      fiscalYear,
      quarter,
      grade,
      lastUpdated: new Date().toISOString()
    });
  }

  // Sort final cache by totalLCAs descending
=======
      // FY extracted from filename could be passed here, using 2026 as a placeholder for now
      fiscalYear: parseInt(inputFile.match(/FY(\d{4})/i)?.[1] || "2024", 10),
      grade: emp.totalLCAs > 100 && (emp.approvedLCAs / emp.totalLCAs) > 0.95 ? 'A' : (emp.totalLCAs > 100 && (emp.approvedLCAs / emp.totalLCAs) > 0.85 ? 'B' : 'C'),
      lastUpdated: new Date()
    });
  }

  // Sort by totalLCAs desc for convenience
>>>>>>> divyanshu/master
  dataToInsert.sort((a, b) => b.totalLCAs - a.totalLCAs);

  const outDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
<<<<<<< HEAD

  const outFile = path.join(outDir, 'lca-aggregated-cache.json');
  fs.writeFileSync(outFile, JSON.stringify(dataToInsert, null, 2));

  console.log(`\nSuccess! Wrote ${dataToInsert.length} employer records to ${outFile}`);
  console.log(`Top 5 Employers in FY${fiscalYear} Q${quarter}:`);
  dataToInsert.slice(0, 5).forEach((e, idx) => {
    console.log(`  ${idx + 1}. ${e.employerName}: ${e.totalLCAs.toLocaleString()} LCAs (${e.approvalRate}% approved, Median: $${e.medianWage.toLocaleString()})`);
  });
}

main().catch(err => {
  console.error('Process error:', err);
  process.exit(1);
});
=======
  
  const outFile = path.join(outDir, 'lca-aggregated-cache.json');
  fs.writeFileSync(outFile, JSON.stringify(dataToInsert, null, 2));
  
  console.log(`\nSuccess! Wrote ${dataToInsert.length} employer records to ${outFile}`);
  console.log(`To import to the production database, run:`);
  console.log(`node scripts/import-lca.mjs ${outFile}`);
}

main().catch(console.error);
>>>>>>> divyanshu/master
