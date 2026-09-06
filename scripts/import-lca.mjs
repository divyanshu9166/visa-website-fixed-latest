import fs from 'fs';
<<<<<<< HEAD
import { PrismaClient } from '@prisma/client';

// Load .env if present and DATABASE_URL is not yet in environment
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch {}
} else if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
  try {
    const envContent = fs.readFileSync('.env', 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = (match[2] || '').trim().replace(/^["'](.*)["']$/, '$1');
      }
    }
  } catch {}
}

=======
import path from 'path';
import { PrismaClient } from '@prisma/client';

>>>>>>> divyanshu/master
const inputFile = process.argv[2];

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}. Provide the aggregated JSON file.`);
<<<<<<< HEAD
  console.error('Usage: node scripts/import-lca.mjs <path-to-lca-aggregated-cache.json>');
=======
>>>>>>> divyanshu/master
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(`Loading pre-aggregated LCA data from ${inputFile}...`);
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

  if (!Array.isArray(data) || data.length === 0) {
<<<<<<< HEAD
    console.error('Invalid or empty JSON data array.');
    process.exit(1);
  }

  console.log(`Found ${data.length} employer records. Starting Prisma upsert import...`);

  const chunkSize = 100;
  const totalChunks = Math.ceil(data.length / chunkSize);

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize) + 1;

    await prisma.$transaction([
      ...chunk.map(record =>
        prisma.lcaEmployer.upsert({
          where: { employerName: record.employerName },
          create: {
            employerName: record.employerName,
            slug: record.slug,
            totalLCAs: record.totalLCAs,
            approvalRate: record.approvalRate,
            avgWage: record.avgWage,
            medianWage: record.medianWage,
            topTitles: record.topTitles,
            topStates: record.topStates,
            wageLevelDist: record.wageLevelDist,
            fiscalYear: record.fiscalYear,
            grade: record.grade,
            lastUpdated: record.lastUpdated ? new Date(record.lastUpdated) : new Date()
          },
          update: {
            slug: record.slug,
            totalLCAs: record.totalLCAs,
            approvalRate: record.approvalRate,
            avgWage: record.avgWage,
            medianWage: record.medianWage,
            topTitles: record.topTitles,
            topStates: record.topStates,
            wageLevelDist: record.wageLevelDist,
            fiscalYear: record.fiscalYear,
            grade: record.grade,
            lastUpdated: record.lastUpdated ? new Date(record.lastUpdated) : new Date()
          }
        })
      ),
      ...chunk.map(record =>
        prisma.lcaEmployerQuarterly.upsert({
          where: {
            slug_fiscalYear_quarter: {
              slug: record.slug,
              fiscalYear: record.fiscalYear,
              quarter: record.quarter || 4
            }
          },
          create: {
            slug: record.slug,
            employerName: record.employerName,
            fiscalYear: record.fiscalYear,
            quarter: record.quarter || 4,
            totalLCAs: record.totalLCAs,
            approvalRate: record.approvalRate,
            avgWage: record.avgWage,
            medianWage: record.medianWage,
            topTitles: record.topTitles,
            topStates: record.topStates,
            wageLevelDist: record.wageLevelDist,
            grade: record.grade,
            importedAt: record.lastUpdated ? new Date(record.lastUpdated) : new Date()
          },
          update: {
            employerName: record.employerName,
            totalLCAs: record.totalLCAs,
            approvalRate: record.approvalRate,
            avgWage: record.avgWage,
            medianWage: record.medianWage,
            topTitles: record.topTitles,
            topStates: record.topStates,
            wageLevelDist: record.wageLevelDist,
            grade: record.grade,
            importedAt: record.lastUpdated ? new Date(record.lastUpdated) : new Date()
          }
        })
      )
    ]);

    if (chunkIndex % 10 === 0 || chunkIndex === totalChunks) {
      console.log(`Processed chunk ${chunkIndex} of ${totalChunks} (${Math.min(i + chunkSize, data.length)} / ${data.length} employers)`);
    }
  }

  console.log('Production database import complete! All records upserted successfully.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Import error:', e);
  await prisma.$disconnect();
=======
    console.error('Invalid or empty JSON data.');
    process.exit(1);
  }

  console.log(`Found ${data.length} employer records. Starting Prisma import...`);

  const chunkSize = 1000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await prisma.lcaEmployer.createMany({
      data: chunk,
      skipDuplicates: true
    });
    console.log(`Inserted chunk ${Math.floor(i/chunkSize) + 1} of ${Math.ceil(data.length/chunkSize)}`);
  }

  console.log('Production database import complete!');
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
>>>>>>> divyanshu/master
  process.exit(1);
});
