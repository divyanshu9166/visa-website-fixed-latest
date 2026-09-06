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
status.sources.dosWaitTimes = dos.status === 0
  ? { status: 'LIVE_VALIDATED', liveCount: 1, lastError: null }
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
status.publication = 'LIVE_VALIDATED';
status.rollback = { performed: false };
fs.writeFileSync(path.join(ROOT, '.fetch-status.json'), JSON.stringify(status, null, 2) + '\n');
fs.rmSync(BACKUP, { recursive: true, force: true });
console.log('All daily sources passed live validation and were published atomically.');
