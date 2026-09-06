import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STATUS_FILE = path.join(ROOT, '.fetch-status.json');
const HEALTH = {
  processingTimes: ['USCIS Case Processing Times', 45],
  visaBulletin: ['DOS Visa Bulletin Cutoffs', 35],
  waitTimes: ['DOS Consular Appointment Wait Times', 45],
  uscisQuarterlyStats: ['USCIS Quarterly Workload Statistics', 120],
  dosWaitTimes: ['DOS Consular Appointment Wait Times (browser adapter)', 45],
  dolLca: ['DOL OFLC LCA Disclosure Data', 120],
};

function loadStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); }
  catch { return null; }
}
function daysSince(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor((Date.now() - time) / 86400000) : null;
}

export function checkStaleness() {
  console.log('=== LIVE DATASET EVIDENCE & STALENESS MONITOR ===\n');
  const status = loadStatus();
  if (!status?.sources) {
    console.error('❌ No .fetch-status.json evidence manifest exists. Live freshness is unproven.');
    return { exitCode: 2, report: [] };
  }

  let exitCode = 0;
  const report = [];
  for (const [key, [name, criticalDays]] of Object.entries(HEALTH)) {
    const source = status.sources[key];
    if (!source) {
      console.log(`❌ ${name}\n   Status:       UNKNOWN (no evidence record)\n`);
      exitCode = Math.max(exitCode, 2);
      report.push({ key, name, status: 'UNKNOWN' });
      continue;
    }
    const liveSuccess = source.lastLiveSuccess || (source.status === 'LIVE_VALIDATED' ? status.timestamp : null);
    const age = daysSince(liveSuccess);
    const live = source.status === 'LIVE_VALIDATED' && age !== null && age <= criticalDays;
    if (!live) exitCode = Math.max(exitCode, source.status === 'UNAVAILABLE' ? 2 : 1);
    const icon = live ? '✅' : '🚨';
    console.log(`${icon} ${name}`);
    console.log(`   Status:       ${source.status}`);
    console.log(`   Last live success: ${liveSuccess || 'NEVER'}`);
    console.log(`   Last attempt:     ${status.timestamp || 'UNKNOWN'}`);
    console.log(`   Error:        ${source.lastError || 'none'}`);
    console.log(`   Freshness:    ${live ? 'PROVEN LIVE' : 'NOT PROVEN LIVE'}\n`);
    report.push({ key, name, source, age, live });
  }

  if (exitCode === 0) console.log('✅ SUMMARY: every tracked source has a recent LIVE_VALIDATED result.');
  else console.error('🚨 SUMMARY: one or more sources are unavailable, stale, or lack live proof.');
  return { exitCode, report };
}

if (process.argv[1]?.endsWith('check-staleness.mjs')) process.exit(checkStaleness().exitCode);
