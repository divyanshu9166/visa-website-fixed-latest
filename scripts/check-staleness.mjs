import fs from 'fs';
import path from 'path';

const CONTENT_DIRS = {
  appointmentWaitTimes: {
    path: path.join(process.cwd(), 'src', 'content', 'appointmentWaitTimes'),
    name: 'DOS Consular Appointment Wait Times',
    warningThresholdDays: 35,
    criticalThresholdDays: 45,
    sourceUrl: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html',
    refreshScript: 'node scripts/import-dos-wait-times.mjs <snapshot.json>',
  },
  visaBulletin: {
    path: path.join(process.cwd(), 'src', 'content', 'visaBulletin'),
    name: 'DOS Visa Bulletin Cutoffs',
    warningThresholdDays: 30,
    criticalThresholdDays: 35,
    sourceUrl: 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html',
    refreshScript: 'node scripts/fetch-data.mjs',
  },
  processingTimes: {
    path: path.join(process.cwd(), 'src', 'content', 'processingTimes'),
    name: 'USCIS Case Processing Times',
    warningThresholdDays: 30,
    criticalThresholdDays: 45,
    sourceUrl: 'https://egov.uscis.gov/processing-times/',
    refreshScript: 'node scripts/fetch-data.mjs',
  },
  uscisQuarterlyStats: {
    path: path.join(process.cwd(), 'src', 'content', 'uscisQuarterlyStats'),
    name: 'USCIS Quarterly Workload Statistics',
    warningThresholdDays: 90,
    criticalThresholdDays: 120,
    sourceUrl: 'https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data',
    refreshScript: 'node scripts/fetch-data.mjs',
  },
};

export function checkStaleness() {
  console.log('=== DATASET STALENESS & HEALTH MONITOR ===\n');
  const now = Date.now();
  let hasWarnings = false;
  let hasCritical = false;
  const report = [];

  for (const [key, cfg] of Object.entries(CONTENT_DIRS)) {
    if (!fs.existsSync(cfg.path)) {
      console.warn(`[WARN] Directory not found: ${cfg.path}`);
      continue;
    }

    const files = fs.readdirSync(cfg.path).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      console.warn(`[WARN] No JSON files in ${cfg.path}`);
      continue;
    }

    // Find the latest update date across all files in this collection
    let latestDate = null;
    let staleCount = 0;

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(cfg.path, file), 'utf-8'));
        const dateStr = data.lastUpdated || data.month || (data._meta && data._meta.source_updated);
        if (dateStr) {
          const d = new Date(dateStr.length === 7 ? `${dateStr}-01` : dateStr);
          if (!isNaN(d.getTime())) {
            if (!latestDate || d > latestDate) {
              latestDate = d;
            }
          }
        }
        if (data.staleSince) {
          staleCount++;
        }
      } catch (err) {
        // ignore parse error
      }
    }

    if (!latestDate) {
      report.push({
        key,
        name: cfg.name,
        status: 'UNKNOWN',
        daysAgo: null,
        message: 'Could not determine last updated date from files.',
      });
      continue;
    }

    const daysAgo = Math.floor((now - latestDate.getTime()) / (1000 * 60 * 60 * 24));
    let status = 'HEALTHY';

    if (daysAgo >= cfg.criticalThresholdDays) {
      status = 'CRITICAL (STALE)';
      hasCritical = true;
    } else if (daysAgo >= cfg.warningThresholdDays) {
      status = 'WARNING (NEARING EXPIRATION)';
      hasWarnings = true;
    }

    report.push({
      key,
      name: cfg.name,
      fileCount: files.length,
      latestDate: latestDate.toISOString().slice(0, 10),
      daysAgo,
      warningDays: cfg.warningThresholdDays,
      criticalDays: cfg.criticalThresholdDays,
      status,
      refreshScript: cfg.refreshScript,
      sourceUrl: cfg.sourceUrl,
    });
  }

  // Print formatted report table
  for (const r of report) {
    const icon = r.status.startsWith('HEALTHY') ? '✅' : r.status.startsWith('WARNING') ? '⚠️' : '🚨';
    console.log(`${icon} ${r.name}`);
    console.log(`   Latest Date:  ${r.latestDate} (${r.daysAgo} days ago)`);
    console.log(`   Status:       ${r.status}`);
    console.log(`   Thresholds:   Warn at ${r.warningDays}d | User Banner at ${r.criticalDays}d`);
    if (r.status !== 'HEALTHY') {
      console.log(`   Action:       Run \`${r.refreshScript}\``);
      console.log(`   Source:       ${r.sourceUrl}`);
    }
    console.log('');
  }

  if (hasCritical) {
    console.log('🚨 SUMMARY: Critical staleness detected. Public user warning banners are active.');
    return { exitCode: 2, report };
  } else if (hasWarnings) {
    console.log('⚠️  SUMMARY: Datasets nearing staleness. Action recommended within the next 5-10 days.');
    return { exitCode: 1, report };
  } else {
    console.log('✅ SUMMARY: All datasets are fresh and well within operational thresholds.');
    return { exitCode: 0, report };
  }
}

if (process.argv[1]?.endsWith('check-staleness.mjs')) {
  const { exitCode } = checkStaleness();
  process.exit(exitCode);
}
