import { PrismaClient } from '@prisma/client';
import fs from 'fs';

if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
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

const prisma = new PrismaClient();

async function main() {
  const lcaEmployerCount = await prisma.lcaEmployer.count();
  const lcaEmployerQuarterlyCount = await prisma.lcaEmployerQuarterly.count();

  const quarters = await prisma.lcaEmployerQuarterly.groupBy({
    by: ['fiscalYear', 'quarter'],
    _count: {
      _all: true
    }
  });

  const topQuarterly = await prisma.lcaEmployerQuarterly.findMany({
    where: {
      fiscalYear: 2026,
      quarter: 3
    },
    orderBy: {
      totalLCAs: 'desc'
    },
    take: 5
  });

  console.log('--- DATABASE VERIFICATION REPORT ---');
  console.log(`LcaEmployer total rows: ${lcaEmployerCount}`);
  console.log(`LcaEmployerQuarterly total rows: ${lcaEmployerQuarterlyCount}`);
  console.log('Quarters present in LcaEmployerQuarterly:', JSON.stringify(quarters, null, 2));
  console.log('Top 5 Employers in FY2026 Q3:');
  topQuarterly.forEach((emp, i) => {
    console.log(`  ${i + 1}. ${emp.employerName} (slug: ${emp.slug}): ${emp.totalLCAs} LCAs, ${emp.approvalRate}% approved, Median: $${emp.medianWage}`);
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
