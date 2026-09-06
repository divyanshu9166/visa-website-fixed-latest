import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const STATUS_FILE = path.join(process.cwd(), '.fetch-status.json');
const HEALTH_FILE = path.join(process.cwd(), '.fetch-health.json');

const ENDPOINT_LABELS = {
  processingTimes: 'USCIS Processing Times (https://egov.uscis.gov/processing-times/)',
  visaBulletin: 'DOS Visa Bulletin (https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html)',
  waitTimes: 'DOS Consular Appointment Wait Times (https://travel.state.gov)',
  dosWaitTimes: 'DOS Consular Appointment Wait Times browser adapter (https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html)',
  uscisQuarterlyStats: 'USCIS Quarterly Workload Statistics (https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data)',
  dolLca: 'DOL OFLC LCA Disclosure Data (https://www.dol.gov/agencies/eta/foreign-labor/performance)',
};

function loadJson(filePath, fallback) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function checkHealth() {
  const status = loadJson(STATUS_FILE, null);
  if (!status) {
    console.log('[checkHealth] No .fetch-status.json found — skipping check.');
    return;
  }

  if (status.seedOnly) {
    console.log('[checkHealth] Seed-only run — skipping health degradation update.');
    return;
  }

  const health = loadJson(HEALTH_FILE, {
    processingTimes: { consecutiveFailures: 0, lastFailed: null, lastError: null },
    visaBulletin: { consecutiveFailures: 0, lastFailed: null, lastError: null },
    waitTimes: { consecutiveFailures: 0, lastFailed: null, lastError: null },
  });

  const alerts = [];

  for (const [key, label] of Object.entries(ENDPOINT_LABELS)) {
    const epStatus = status[key];
    if (!epStatus) continue;

    health[key] = health[key] || { consecutiveFailures: 0, lastFailed: null, lastError: null };

    if (epStatus.status === 'LIVE_VALIDATED') {
      health[key].consecutiveFailures = 0;
      health[key].lastSuccess = status.timestamp;
      health[key].lastError = null;
    } else {
      health[key].consecutiveFailures = (health[key].consecutiveFailures || 0) + 1;
      health[key].lastFailed = status.timestamp;
      health[key].lastError = epStatus.lastError || `Source status is ${epStatus.status || 'UNKNOWN'} (preservation fallback active)`;

      if (health[key].consecutiveFailures >= 3) {
        alerts.push({
          key,
          label,
          consecutiveFailures: health[key].consecutiveFailures,
          lastError: health[key].lastError,
          lastSuccess: health[key].lastSuccess,
        });
      }
    }
  }

  fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2));
  console.log('[checkHealth] Updated .fetch-health.json:', JSON.stringify(health, null, 2));

  if (alerts.length > 0) {
    console.warn(`\n⚠️  [checkHealth] ${alerts.length} endpoint(s) have failed 3 or more consecutive daily runs!`);
    const alertBody = [
      `## ⚠️ Upstream Government Endpoint Scrape Alert`,
      ``,
      `The daily data refresh automation has detected persistent scrape failures for **3+ consecutive days**. Existing confirmed records are currently being preserved on disk with staleness warning banners displayed to users, but upstream changes or network blocking require investigation.`,
      ``,
      `### Affected Endpoints`,
      ``,
      ...alerts.map((a) => `- **${a.label}**:\n  - Consecutive Failures: **${a.consecutiveFailures} days**\n  - Last Error: \`${a.lastError}\`\n  - Last Confirmed Success: \`${a.lastSuccess || 'N/A'}\``),
      ``,
      `### Recommended Action`,
      `1. Check if the upstream government website has updated its URL structure, WAF challenge, or XML/JSON schema.`,
      `2. Test the scraper locally using \`node scripts/fetch-data.mjs\`.`,
      `3. Update scraper headers or URL parser in \`scripts/lib/\` if needed.`,
      ``,
      `*Reported automatically by GitHub Actions daily data refresh on ${new Date().toISOString().slice(0, 10)}.*`,
    ].join('\n');

    console.log(alertBody);

    // If running in GitHub Actions with GH_TOKEN, create or update issue
    if (process.env.GITHUB_ACTIONS === 'true') {
      try {
        const issueTitle = `[Data Alert] Upstream Government Scrape Failure (3+ Days)`;
        // Check if an open issue with this title already exists
        const listCmd = `gh issue list --search "${issueTitle} in:title state:open" --json number --jq ".[0].number"`;
        const existingIssueNum = execSync(listCmd, { env: process.env, encoding: 'utf-8' }).trim();

        if (existingIssueNum) {
          console.log(`[checkHealth] Open issue #${existingIssueNum} already exists for this alert.`);
          const commentCmd = `gh issue comment ${existingIssueNum} --body "${alertBody.replace(/"/g, '\\"')}"`;
          execSync(commentCmd, { env: process.env, stdio: 'inherit' });
        } else {
          console.log('[checkHealth] Creating new GitHub issue for scrape alert...');
          const createCmd = `gh issue create --title "${issueTitle}" --body "${alertBody.replace(/"/g, '\\"')}"`;
          execSync(createCmd, { env: process.env, stdio: 'inherit' });
        }
      } catch (err) {
        console.warn('[checkHealth] Failed to open/update GitHub issue via gh CLI:', err.message);
      }
    }
  } else {
    console.log('[checkHealth] All endpoints within healthy thresholds (no 3+ day consecutive failures).');
  }
}

checkHealth().catch((err) => {
  console.error('[checkHealth] Error running health check:', err);
});
