import fs from 'fs';
import path from 'path';
import { fetchProcessingTimes } from './lib/processingTimes.mjs';
import { fetchVisaBulletin } from './lib/visaBulletin.mjs';
import { fetchWaitTimes } from './lib/waitTimes.mjs';
import { fetchUSCISQuarterlyStats } from './lib/uscisQuarterlyStats.mjs';

// Load .env if present and DATABASE_URL is not yet in environment
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {}
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

// Define paths
const CONTENT_DIR = path.join(process.cwd(), 'src', 'content');
const USCIS_STATS_DIR = path.join(CONTENT_DIR, 'uscisQuarterlyStats');

[USCIS_STATS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * SCD Type 2 Persistent Archival: Persists daily scraped snapshots into PostgreSQL
 * GovernmentDataArchive ledger so long-term history is never lost when JSON collections
 * maintain their fast 24-month rolling window for SSG builds.
 */
async function archiveHistoricalSnapshots() {
  if (!process.env.DATABASE_URL) {
    console.log('  [archive] No DATABASE_URL provided — skipping PostgreSQL SCD Type 2 archival.');
    return;
  }

  let PrismaClient;
  try {
    const prismaModule = await import('@prisma/client');
    PrismaClient = prismaModule.PrismaClient;
  } catch (err) {
    console.log('  [archive] @prisma/client not available — skipping PostgreSQL archival.');
    return;
  }

  const prisma = new PrismaClient();
  let archivedCount = 0;

  try {
    console.log('  [archive] Starting SCD Type 2 snapshot archival to PostgreSQL...');

    // 1. Processing Times
    const ptDir = path.join(CONTENT_DIR, 'processingTimes');
    if (fs.existsSync(ptDir)) {
      const files = fs.readdirSync(ptDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(ptDir, file), 'utf-8'));
          const period = (raw.lastUpdated || new Date().toISOString().slice(0, 7)).slice(0, 7);
          const entityKey = raw.formType ? `${raw.formType}-${raw.visaSlug || file.replace('.json', '')}` : file.replace('.json', '');
          await prisma.governmentDataArchive.upsert({
            where: {
              domain_entityKey_period: {
                domain: 'PROCESSING_TIME',
                entityKey,
                period,
              },
            },
            create: {
              domain: 'PROCESSING_TIME',
              entityKey,
              period,
              metrics: raw,
            },
            update: {
              metrics: raw,
              fetchedAt: new Date(),
            },
          });
          archivedCount++;
        } catch {}
      }
    }

    // 2. USCIS Quarterly Stats
    if (fs.existsSync(USCIS_STATS_DIR)) {
      const files = fs.readdirSync(USCIS_STATS_DIR).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(USCIS_STATS_DIR, file), 'utf-8'));
          const period = `FY${raw.fiscalYear}-Q${raw.quarter}`;
          const entityKey = raw.formType || file.replace('.json', '');
          await prisma.governmentDataArchive.upsert({
            where: {
              domain_entityKey_period: {
                domain: 'USCIS_STATS',
                entityKey,
                period,
              },
            },
            create: {
              domain: 'USCIS_STATS',
              entityKey,
              period,
              metrics: raw,
            },
            update: {
              metrics: raw,
              fetchedAt: new Date(),
            },
          });
          archivedCount++;
        } catch {}
      }
    }

    // 3. Appointment Wait Times
    const wtDir = path.join(CONTENT_DIR, 'appointmentWaitTimes');
    if (fs.existsSync(wtDir)) {
      const files = fs.readdirSync(wtDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(wtDir, file), 'utf-8'));
          const period = (raw.lastUpdated || new Date().toISOString().slice(0, 7)).slice(0, 7);
          const entityKey = raw.slug || raw.country?.toLowerCase() || file.replace('.json', '');
          await prisma.governmentDataArchive.upsert({
            where: {
              domain_entityKey_period: {
                domain: 'WAIT_TIME',
                entityKey,
                period,
              },
            },
            create: {
              domain: 'WAIT_TIME',
              entityKey,
              period,
              metrics: raw,
            },
            update: {
              metrics: raw,
              fetchedAt: new Date(),
            },
          });
          archivedCount++;
        } catch {}
      }
    }

    // 4. Visa Bulletin
    const vbDir = path.join(CONTENT_DIR, 'visaBulletin');
    if (fs.existsSync(vbDir)) {
      const files = fs.readdirSync(vbDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(vbDir, file), 'utf-8'));
          const period = raw.month || new Date().toISOString().slice(0, 7);
          const entityKey = `${raw.category || 'unknown'}-${raw.country || 'unknown'}`.toLowerCase().replace(/\s+/g, '-');
          await prisma.governmentDataArchive.upsert({
            where: {
              domain_entityKey_period: {
                domain: 'VISA_BULLETIN',
                entityKey,
                period,
              },
            },
            create: {
              domain: 'VISA_BULLETIN',
              entityKey,
              period,
              metrics: raw,
            },
            update: {
              metrics: raw,
              fetchedAt: new Date(),
            },
          });
          archivedCount++;
        } catch {}
      }
    }

    console.log(`  [archive] Successfully archived ${archivedCount} snapshots to PostgreSQL.`);
  } catch (err) {
    console.warn(`  [archive] PostgreSQL archival encountered an issue (${err.message}) — proceeding.`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

// `--seed-only` (or env SEED_ONLY=1) skips all live network calls and writes
// deterministic placeholder data. Useful in sandboxed/CI-less environments or for
// local development where you don't want to hammer government endpoints.
const SEED_ONLY = process.argv.includes('--seed-only') || process.env.SEED_ONLY === '1';

async function main() {
  console.log(`Starting data refresh${SEED_ONLY ? ' (seed-only mode)' : ''}...\n`);

  const ptResult = await fetchProcessingTimes({ seedOnly: SEED_ONLY });
  const vbResult = await fetchVisaBulletin({ seedOnly: SEED_ONLY });
  const wtResult = await fetchWaitTimes({ seedOnly: SEED_ONLY });
  const uqResult = await fetchUSCISQuarterlyStats({ seedOnly: SEED_ONLY });
  await archiveHistoricalSnapshots();

  const statusReport = {
    timestamp: new Date().toISOString(),
    seedOnly: SEED_ONLY,
    processingTimes: ptResult,
    visaBulletin: vbResult,
    waitTimes: wtResult,
    uscisQuarterlyStats: uqResult,
  };

  fs.writeFileSync(path.join(process.cwd(), '.fetch-status.json'), JSON.stringify(statusReport, null, 2));

  console.log('\nData refresh complete!');
  if (SEED_ONLY) {
    console.log('NOTE: ran in --seed-only mode. Re-run without that flag on a machine with normal');
    console.log('internet access (your laptop, or GitHub Actions) to pull live USCIS/State Dept data.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
