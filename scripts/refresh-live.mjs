import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(ROOT, '.refresh-backup', RUN_ID);
const paths = [
  'src/content/processingTimes',
  'src/content/visaBulletin',
  'src/content/appointmentWaitTimes',
  'src/content/uscisQuarterlyStats',
  'data/dos_global_wait_times.json',
];

function copyIfPresent(relative, destinationRoot) {
  const source = path.join(ROOT, relative);
  if (!fs.existsSync(source)) return;
  const target = path.join(destinationRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}
function restore(relative) {
  const source = path.join(BACKUP, relative);
  const target = path.join(ROOT, relative);
  if (!fs.existsSync(source)) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}
function run(command, args) {
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, STRICT_LIVE: '1' } });
}
function loadStatus() {
  const file = path.join(ROOT, '.fetch-status.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { schemaVersion: 2, timestamp: new Date().toISOString(), sources: {} }; }
}

fs.mkdirSync(BACKUP, { recursive: true });
for (const relative of paths) copyIfPresent(relative, BACKUP);

const government = run(process.execPath, ['scripts/fetch-data.mjs']);
const dos = run(process.execPath, ['scripts/automated-dos-wait-times.mjs']);
const status = loadStatus();
status.schemaVersion = 2;
status.timestamp = new Date().toISOString();
status.sources = status.sources || {};

// Read dos snapshot to determine if it was a live extraction or preserved snapshot
let dosLive = false;
try {
  if (fs.existsSync(path.join(ROOT, 'data/dos_global_wait_times.json'))) {
    const rawDos = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/dos_global_wait_times.json'), 'utf8'));
    const extractedAt = rawDos._meta?.extracted_at ? new Date(rawDos._meta.extracted_at).getTime() : 0;
    // Considered live if extracted within the last 15 minutes
    if (Date.now() - extractedAt < 15 * 60 * 1000) {
      dosLive = true;
    }
  }
} catch {}

status.sources.dosWaitTimes = dos.status === 0
  ? { status: dosLive ? 'LIVE_VALIDATED' : 'PRESERVED', liveCount: dosLive ? 1 : 0, lastError: null }
  : { status: 'UNAVAILABLE', liveCount: 0, lastError: `DOS browser refresh exited with code ${dos.status}` };
status.sources.dolLca = { status: 'UNAVAILABLE', liveCount: 0, lastError: 'Quarterly LCA workflow is separate from the daily refresh.' };

if (government.status !== 0 || dos.status !== 0) {
  for (const relative of paths) restore(relative);
  fs.rmSync(BACKUP, { recursive: true, force: true });
  status.publication = 'PRESERVED_LAST_VALIDATED_SNAPSHOT';
  status.rollback = { performed: true, backupId: RUN_ID };
  fs.writeFileSync(path.join(ROOT, '.fetch-status.json'), JSON.stringify(status, null, 2) + '\n');
  console.error('Live refresh failed closed; prior validated snapshots restored.');
  process.exit(1);
}

const allDailyLive = Boolean(
  status.sources?.processingTimes?.liveCount > 0 &&
  status.sources?.visaBulletin?.liveCount > 0 &&
  status.sources?.uscisQuarterlyStats?.liveCount > 0 &&
  (status.sources?.waitTimes?.liveCount > 0 || status.sources?.dosWaitTimes?.liveCount > 0)
);

status.publication = allDailyLive ? 'LIVE_VALIDATED' : 'PRESERVED_LAST_VALIDATED_SNAPSHOT';
status.rollback = { performed: false };
fs.writeFileSync(path.join(ROOT, '.fetch-status.json'), JSON.stringify(status, null, 2) + '\n');
fs.rmSync(BACKUP, { recursive: true, force: true });

if (allDailyLive) {
  console.log('All daily sources passed live validation and were published atomically.');
} else {
  console.log('Daily refresh completed with preserved validated snapshots for sources that were blocked or unchanged.');
}
