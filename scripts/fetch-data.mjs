import fs from 'node:fs';
import path from 'node:path';
import { fetchProcessingTimes } from './lib/processingTimes.mjs';
import { fetchVisaBulletin } from './lib/visaBulletin.mjs';
import { fetchWaitTimes } from './lib/waitTimes.mjs';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'src', 'content');
const STATUS_FILE = path.join(ROOT, '.fetch-status.json');
const strictLive = process.env.STRICT_LIVE !== '0' && !process.argv.includes('--allow-seed');

function writeStatus(sources, error = null) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify({
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    mode: strictLive ? 'strict-live' : 'seed-allowed',
    sources,
    error,
  }, null, 2) + '\n');
}

async function main() {
  const sources = {
    processingTimes: { status: 'UNAVAILABLE', liveCount: 0, lastError: null },
    visaBulletin: { status: 'UNAVAILABLE', liveCount: 0, lastError: null },
    waitTimes: { status: 'UNAVAILABLE', liveCount: 0, lastError: null },
    uscisQuarterlyStats: {
      status: 'UNAVAILABLE', liveCount: 0,
      lastError: 'No live USCIS quarterly adapter is enabled; existing snapshot preserved.',
    },
  };

  console.log(`Starting data refresh (${strictLive ? 'strict live mode' : 'seed-allowed mode'})...`);
  try {
    await fetchProcessingTimes({ seedOnly: !strictLive, strictLive });
    sources.processingTimes = { status: 'LIVE_VALIDATED', liveCount: 1, lastError: null };

    await fetchVisaBulletin({ seedOnly: !strictLive, strictLive });
    sources.visaBulletin = { status: 'LIVE_VALIDATED', liveCount: 1, lastError: null };

    await fetchWaitTimes({ seedOnly: !strictLive, strictLive });
    sources.waitTimes = { status: 'LIVE_VALIDATED', liveCount: 1, lastError: null };

    if (strictLive) {
      throw new Error('uscisQuarterlyStats unavailable: live RSS/catalog ingestion is not implemented in this refresh path; existing snapshot preserved');
    }

    writeStatus(sources);
    console.log('Data refresh complete.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const source = message.match(/^(processingTimes|visaBulletin|waitTimes|uscisQuarterlyStats) unavailable/)?.[1];
    if (source) sources[source] = { status: 'UNAVAILABLE', liveCount: 0, lastError: message };
    writeStatus(sources, message);
    console.error(`Data refresh failed closed: ${message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  writeStatus({}, error instanceof Error ? error.message : String(error));
  console.error(error);
  process.exit(1);
});
