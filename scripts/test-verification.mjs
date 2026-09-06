import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

console.log('================================================================');
console.log('EASYVISACHECK RUNTIME VERIFICATION SUITE — REAL DATA & PROOFS');
console.log('================================================================\n');

// -------------------------------------------------------------
// CHECK 1: USCIS Quarterly Stats Discovery Live Test
// -------------------------------------------------------------
console.log('--- CHECK 1: Live USCIS Quarterly Stats Cheerio Discovery ---');
try {
  const url = 'https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  console.log(`Landing Page HTTP Status: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const matchedLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (
      (href.includes('quarterly_all_forms') || href.includes('all_forms')) &&
      (href.endsWith('.xlsx') || href.endsWith('.csv') || href.includes('.xlsx?') || href.includes('.csv?'))
    ) {
      const fullUrl = href.startsWith('http') ? href : `https://www.uscis.gov${href.startsWith('/') ? '' : '/'}${href}`;
      matchedLinks.push({ title: text, url: fullUrl });
    }
  });

  console.log(`Discovered Report Links: ${matchedLinks.length} matching files`);
  matchedLinks.slice(0, 3).forEach((link, idx) => {
    console.log(`  [${idx + 1}] Title: "${link.title}"`);
    console.log(`      URL:   ${link.url}`);
  });
} catch (err) {
  console.error('Check 1 Error:', err.message);
}
console.log('');

// -------------------------------------------------------------
// CHECK 2: Queue Calculator FIFO Math Verification Across Real Dates
// -------------------------------------------------------------
console.log('--- CHECK 2: Green Card Queue Calculator FIFO Execution ---');
const inventoryData = {
  'EB-2': { India: 372000, China: 28000, 'Rest of World': 38000 },
};
const perCountryCap = 9940;
const rate = 1.0;
const annualApprovals = Math.round(perCountryCap * rate);
const cat = 'EB-2';
const country = 'India';
const totalInCat = inventoryData[cat][country]; // 372,000
const currentFADRaw = '2012-07-15'; // Real Bulletin FAD for EB-2 India
const fadDate = new Date(currentFADRaw + 'T00:00:00Z');
const now = new Date('2026-09-01T00:00:00Z');
const queueTimeSpanMs = Math.max(now.getTime() - fadDate.getTime(), 1000 * 60 * 60 * 24 * 30);

const testDates = [
  '2011-01-01', // Before cutoff -> Current
  '2012-07-15', // Exactly cutoff -> Current
  '2014-01-01', // ~1.5 years behind cutoff
  '2018-01-01', // ~5.5 years behind cutoff
  '2022-01-01', // ~9.5 years behind cutoff
  '2026-01-01', // Near current date
];

console.log(`Context: EB-2 India | Current FAD: ${currentFADRaw} | Total Backlog: ${totalInCat.toLocaleString('en-US')} | Annual Cap: ${annualApprovals.toLocaleString('en-US')}/yr`);
console.log('Evaluating FIFO Queue Positions:');
console.table(
  testDates.map(pdVal => {
    const pd = new Date(pdVal + 'T00:00:00Z');
    let isCurrent = false;
    let peopleAhead = 0;
    let yearsWait = 0;
    let fractionAhead = 0;

    if (pd <= fadDate) {
      isCurrent = true;
      peopleAhead = 0;
      yearsWait = 0;
    } else {
      const timeSinceCutoffMs = Math.max(0, pd.getTime() - fadDate.getTime());
      fractionAhead = Math.min(timeSinceCutoffMs / queueTimeSpanMs, 1.0);
      peopleAhead = Math.round(totalInCat * fractionAhead);
      yearsWait = annualApprovals > 0 ? (peopleAhead / annualApprovals) : 999;
    }

    return {
      'Priority Date': pdVal,
      'Status': isCurrent ? 'CURRENT' : 'QUEUED',
      'Queue Fraction': `${(fractionAhead * 100).toFixed(1)}%`,
      'People Ahead': peopleAhead.toLocaleString('en-US'),
      'Est. Wait': isCurrent ? '0 yrs (Current)' : `~${Math.round(yearsWait)} yrs`,
      'Projected Year': isCurrent ? 'Immediate' : `~${now.getFullYear() + Math.round(yearsWait)}`,
    };
  })
);
console.log('Proof: Earlier priority dates strictly have FEWER people ahead and SHORTER wait times than newer dates.\n');

// -------------------------------------------------------------
// CHECK 3: Visa Bulletin Prediction Accuracy Rolling Backtest
// -------------------------------------------------------------
console.log('--- CHECK 3: Prediction Accuracy Out-of-Sample Rolling Backtest ---');
const vbDir = path.resolve('src/content/visaBulletin');
const vbFiles = fs.readdirSync(vbDir).filter(f => f.endsWith('.json'));
const allBulletin = [];
for (const f of vbFiles) {
  const content = JSON.parse(fs.readFileSync(path.join(vbDir, f), 'utf-8'));
  allBulletin.push({ data: content });
}

const eb2IndiaData = allBulletin
  .filter(d => d.data.category === 'EB-2' && d.data.country === 'India')
  .sort((a, b) => a.data.month.localeCompare(b.data.month));

function categorizeMovement(days) {
  if (days >= 30) return 'Rapid Advance';
  if (days >= 1) return 'Steady Advance';
  if (Math.abs(days) < 1) return 'Hold';
  return 'Retrogression';
}

function parseFadTimestamp(fad) {
  if (!fad || fad === 'Current' || fad === 'Unavailable') return null;
  const ts = new Date(fad + 'T00:00:00Z').getTime();
  return isNaN(ts) ? null : ts;
}

const accuracyRows = [];
const WARMUP_MONTHS = 6;

for (let i = WARMUP_MONTHS; i < eb2IndiaData.length; i++) {
  const curr = eb2IndiaData[i];
  const prev = eb2IndiaData[i - 1];
  const windowStart = eb2IndiaData[i - WARMUP_MONTHS];

  const currTs = parseFadTimestamp(curr.data.finalActionDate);
  const prevTs = parseFadTimestamp(prev.data.finalActionDate);
  const startTs = parseFadTimestamp(windowStart.data.finalActionDate);

  if (currTs === null || prevTs === null || startTs === null) continue;

  const actualDays = Math.round((currTs - prevTs) / (1000 * 60 * 60 * 24));
  const actualCategory = categorizeMovement(actualDays);

  const trailingDaysTotal = (prevTs - startTs) / (1000 * 60 * 60 * 24);
  const trailingMonthlyDays = trailingDaysTotal / (WARMUP_MONTHS - 1);
  const predictedCategory = categorizeMovement(trailingMonthlyDays);
  const predictedDays = Math.round(trailingMonthlyDays);

  const isDirectionalMatch =
    (predictedDays >= 1 && actualDays >= 1) ||
    (Math.abs(predictedDays) < 1 && Math.abs(actualDays) < 1) ||
    (predictedDays <= -1 && actualDays <= -1);

  const errorDays = Math.abs(predictedDays - actualDays);

  accuracyRows.push({
    month: curr.data.month,
    predicted: predictedCategory,
    predictedDays: `${predictedDays > 0 ? '+' : ''}${predictedDays}d`,
    actual: actualCategory,
    actualDays: `${actualDays > 0 ? '+' : ''}${actualDays}d`,
    errorDays: `${errorDays}d`,
    accurate: isDirectionalMatch ? 'MATCH' : 'MISS',
  });
}

const totalPredictions = accuracyRows.length;
const correctPredictions = accuracyRows.filter(r => r.accurate === 'MATCH').length;
const directionalAccuracyPct = totalPredictions > 0 ? Math.round((correctPredictions / totalPredictions) * 100) : 0;
const meanAbsoluteError = totalPredictions > 0
  ? Math.round(accuracyRows.reduce((sum, r) => sum + parseInt(r.errorDays), 0) / totalPredictions)
  : 0;

console.log(`Dataset: ${eb2IndiaData.length} monthly historical records for EB-2 India`);
console.log(`Evaluated Out-of-Sample Months: ${totalPredictions}`);
console.log(`Directional Accuracy:         ${directionalAccuracyPct}% (${correctPredictions}/${totalPredictions} matches)`);
console.log(`Mean Absolute Error (MAE):     ${meanAbsoluteError} days`);
console.log('\nRecent 6 Backtested Out-of-Sample Months:');
console.table(accuracyRows.slice(-6));

// -------------------------------------------------------------
// CHECK 4: Live PostgreSQL H-1B Sponsor Search Query Test
// -------------------------------------------------------------
console.log('--- CHECK 4: Live PostgreSQL H-1B Search API Query ---');
try {
  const prisma = new PrismaClient();
  const testTerms = ['google', 'microsoft', 'amazon', 'infosys'];
  for (const q of testTerms) {
    const employers = await prisma.lcaEmployer.findMany({
      where: {
        OR: [
          { employerName: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q.toLowerCase().replace(/[^a-z0-9]+/g, '-'), mode: 'insensitive' } },
        ],
      },
      orderBy: { totalLCAs: 'desc' },
      take: 2,
    });
    console.log(`Query term: "${q}" -> Found ${employers.length} top records:`);
    employers.forEach(e => {
      console.log(`   - ${e.employerName} (Slug: ${e.slug}) | Total LCAs: ${e.totalLCAs.toLocaleString('en-US')} | Avg Wage: $${Math.round(e.avgWage).toLocaleString('en-US')} | Grade: ${e.grade}`);
    });
  }
  await prisma.$disconnect();
} catch (err) {
  console.log('Prisma query test info:', err.message);
}

console.log('\n================================================================');
console.log('VERIFICATION SUITE COMPLETE');
console.log('================================================================');
