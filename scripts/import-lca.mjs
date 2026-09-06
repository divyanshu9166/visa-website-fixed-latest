import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const inputFile = process.argv[2];
if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('Usage: node scripts/import-lca.mjs <path-to-lca-aggregated-cache.json>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for LCA import');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
if (!Array.isArray(data) || data.length === 0) throw new Error('Invalid or empty LCA aggregation cache');
const prisma = new PrismaClient();
try {
  const chunkSize = 100;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await prisma.$transaction([
      ...chunk.map(record => prisma.lcaEmployer.upsert({
        where: { employerName: record.employerName },
        create: { employerName: record.employerName, slug: record.slug, totalLCAs: record.totalLCAs, approvalRate: record.approvalRate, avgWage: record.avgWage, medianWage: record.medianWage, topTitles: record.topTitles, topStates: record.topStates, wageLevelDist: record.wageLevelDist, fiscalYear: record.fiscalYear, grade: record.grade, lastUpdated: new Date(record.lastUpdated) },
        update: { slug: record.slug, totalLCAs: record.totalLCAs, approvalRate: record.approvalRate, avgWage: record.avgWage, medianWage: record.medianWage, topTitles: record.topTitles, topStates: record.topStates, wageLevelDist: record.wageLevelDist, fiscalYear: record.fiscalYear, grade: record.grade, lastUpdated: new Date(record.lastUpdated) },
      })),
      ...chunk.map(record => prisma.lcaEmployerQuarterly.upsert({
        where: { slug_fiscalYear_quarter: { slug: record.slug, fiscalYear: record.fiscalYear, quarter: record.quarter } },
        create: { slug: record.slug, employerName: record.employerName, fiscalYear: record.fiscalYear, quarter: record.quarter, totalLCAs: record.totalLCAs, approvalRate: record.approvalRate, avgWage: record.avgWage, medianWage: record.medianWage, topTitles: record.topTitles, topStates: record.topStates, wageLevelDist: record.wageLevelDist, grade: record.grade },
        update: { employerName: record.employerName, totalLCAs: record.totalLCAs, approvalRate: record.approvalRate, avgWage: record.avgWage, medianWage: record.medianWage, topTitles: record.topTitles, topStates: record.topStates, wageLevelDist: record.wageLevelDist, grade: record.grade },
      })),
    ]);
    console.log(`Imported ${Math.min(i + chunkSize, data.length)}/${data.length} employers`);
  }
} finally {
  await prisma.$disconnect();
}
