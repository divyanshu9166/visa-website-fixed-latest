import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';

const inputFile = process.argv[2];

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}. Provide a valid LCA XLSX or CSV file.`);
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
      }
    }

    if (socTitle) {
      const s = String(socTitle).trim();
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

    dataToInsert.push({
      employerName: emp.originalName,
      slug: generateSlug(emp.originalName) + '-' + Math.random().toString(36).substring(2, 7), // Ensure uniqueness
      totalLCAs: emp.totalLCAs,
      approvalRate: emp.totalLCAs > 0 ? parseFloat(((emp.approvedLCAs / emp.totalLCAs) * 100).toFixed(2)) : 0,
      avgWage: Math.round(avgWage),
      medianWage: Math.round(medianWage),
      topTitles,
      topStates,
      wageLevelDist: emp.wageLevels,
      // FY extracted from filename could be passed here, using 2026 as a placeholder for now
      fiscalYear: parseInt(inputFile.match(/FY(\d{4})/i)?.[1] || "2024", 10),
      grade: emp.totalLCAs > 100 && (emp.approvedLCAs / emp.totalLCAs) > 0.95 ? 'A' : (emp.totalLCAs > 100 && (emp.approvedLCAs / emp.totalLCAs) > 0.85 ? 'B' : 'C'),
      lastUpdated: new Date()
    });
  }

  // Sort by totalLCAs desc for convenience
  dataToInsert.sort((a, b) => b.totalLCAs - a.totalLCAs);

  const outDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const outFile = path.join(outDir, 'lca-aggregated-cache.json');
  fs.writeFileSync(outFile, JSON.stringify(dataToInsert, null, 2));
  
  console.log(`\nSuccess! Wrote ${dataToInsert.length} employer records to ${outFile}`);
  console.log(`To import to the production database, run:`);
  console.log(`node scripts/import-lca.mjs ${outFile}`);
}

main().catch(console.error);
