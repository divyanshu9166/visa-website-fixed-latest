import fs from 'node:fs';
import path from 'node:path';
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

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'src', 'content');
const STATUS_FILE = path.join(ROOT, '.fetch-status.json');
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

const SEED_ONLY = process.argv.includes('--seed-only') || process.env.SEED_ONLY === '1';

async function main() {
  console.log(`Starting data refresh (${SEED_ONLY ? 'seed-only mode' : 'live mode with proxy fallback'})...`);

  const ptResult = await fetchProcessingTimes({ seedOnly: SEED_ONLY });
  const vbResult = await fetchVisaBulletin({ seedOnly: SEED_ONLY });
  const wtResult = await fetchWaitTimes({ seedOnly: SEED_ONLY });
  const uqResult = await fetchUSCISQuarterlyStats({ seedOnly: SEED_ONLY });

  await archiveHistoricalSnapshots();

  const statusReport = {
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    seedOnly: SEED_ONLY,
    sources: {
      processingTimes: {
        status: ptResult?.liveCount > 0 ? 'LIVE_VALIDATED' : 'PRESERVED',
        liveCount: ptResult?.liveCount || 0,
        staleCount: ptResult?.staleCount || 0,
        lastError: ptResult?.lastError || null,
      },
      visaBulletin: {
        status: vbResult?.liveCount > 0 ? 'LIVE_VALIDATED' : 'PRESERVED',
        liveCount: vbResult?.liveCount || 0,
        staleCount: vbResult?.staleCount || 0,
        lastError: vbResult?.lastError || null,
      },
      waitTimes: {
        status: wtResult?.liveCount > 0 ? 'LIVE_VALIDATED' : 'PRESERVED',
        liveCount: wtResult?.liveCount || 0,
        staleCount: wtResult?.staleCount || 0,
        lastError: wtResult?.lastError || null,
      },
      uscisQuarterlyStats: {
        status: uqResult?.liveCount > 0 ? 'LIVE_VALIDATED' : 'PRESERVED',
        liveCount: uqResult?.liveCount || 0,
        staleCount: uqResult?.staleCount || 0,
        lastError: uqResult?.lastError || null,
      },
    },
  };

  fs.writeFileSync(STATUS_FILE, JSON.stringify(statusReport, null, 2) + '\n');
  console.log('Data refresh complete. Fetch status written to .fetch-status.json');
}

main().catch((error) => {
  const errReport = {
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    seedOnly: SEED_ONLY,
    error: error instanceof Error ? error.message : String(error),
    sources: {},
  };
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(errReport, null, 2) + '\n');
  } catch {}
  console.error('Fatal fetch error:', error);
  process.exit(1);
});
