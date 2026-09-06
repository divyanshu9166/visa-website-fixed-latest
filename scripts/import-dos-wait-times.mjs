import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { WAIT_TIME_COUNTRIES } from './lib/formsConfig.mjs';

const OUT_DIR = path.join(process.cwd(), 'src', 'content', 'appointmentWaitTimes');

function parseDays(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const str = String(val).trim().toLowerCase();
  if (str === 'same day' || str === '0 days' || str === '0') return 0;
  if (str === 'n/a' || str === 'unavailable' || str === 'closed' || str === 'na') return null;
  if (str.includes('calendar day')) {
    const m = str.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  if (str.includes('month')) {
    const m = str.match(/([\d.]+)/);
    return m ? Math.round(parseFloat(m[1]) * 30.4) : null;
  }
  if (str.includes('week')) {
    const m = str.match(/([\d.]+)/);
    return m ? Math.round(parseFloat(m[1]) * 7) : null;
  }
  const m = str.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function normalizePostName(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/['']/g, "'")
    .replace(/^u\.?s\.?\s*(embassy|consulate|mission|consulate\s+general)\s*/i, '')
    .replace(/\s+/g, ' ');
}

export async function importDosSnapshot(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`DOS snapshot file not found at: ${filePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const posts = Array.isArray(raw) ? raw : (raw.posts || raw.data || []);
  const sourceUpdated = raw._meta?.source_updated || raw.sourceUpdated || new Date().toISOString().slice(0, 10);

  console.log(`[import-dos-wait-times] Processing ${posts.length} posts from snapshot (source date: ${sourceUpdated})...`);

  // Index snapshot posts by normalized name and city
  const postLookup = new Map();
  for (const p of posts) {
    const postName = p.post_name || p.name || p.city || p.post || '';
    const city = p.city || postName;
    const country = p.country || '';

    // Explicit 5-field DOS metrics:
    // 1. Next Available B1/B2 (what new applicants actually face)
    const b1b2Next = p.b1_b2_next_available ?? p.b1b2_next_available ?? p.waitTimeB1B2 ?? p.b1_b2;
    // 2. Student (F/M/J)
    const studentNext = p.student_next_available ?? p.fmj_next_available ?? p.waitTimeStudent ?? p.student;
    // 3. Petition-based (H, L, O, P, Q)
    const petitionNext = p.petition_next_available ?? p.h_l_o_p_q_next_available ?? p.waitTimePetition ?? p.petition;
    // 4. Crew & Transit (C, D, C1/D)
    const crewTransitNext = p.crew_transit_next_available ?? p.c_d_next_available ?? p.waitTimeCrewTransit ?? p.crew;
    // 5. Average Wait (interview-to-decision, optional/informational)
    const b1b2Avg = p.b1_b2_average_wait ?? p.b1b2_average_wait;

    const parsedData = {
      postName: postName || city,
      city,
      country,
      waitTimeB1B2: parseDays(b1b2Next),
      waitTimeStudent: parseDays(studentNext),
      waitTimePetition: parseDays(petitionNext),
      waitTimeCrewTransit: parseDays(crewTransitNext),
      waitTimeOther: parseDays(petitionNext) ?? parseDays(crewTransitNext),
      b1b2AverageWait: parseDays(b1b2Avg),
      hasEmergencyAppointments: parseDays(b1b2Next) ? parseDays(b1b2Next) > 120 : false,
      notes: parseDays(b1b2Next) && parseDays(b1b2Next) > 200
        ? 'High demand post — emergency/expedite appointment requests are common; check embassy site for criteria.'
        : '',
    };

    if (postName) postLookup.set(normalizePostName(postName), parsedData);
    if (city) postLookup.set(normalizePostName(city), parsedData);
  }

  let matchedCountries = 0;
  let totalConsulates = 0;
  const currentPeriod = sourceUpdated.slice(0, 7);

  // Check staleness against 45-day window
  const sourceDate = new Date(sourceUpdated);
  const ageDays = (Date.now() - sourceDate.getTime()) / (1000 * 60 * 60 * 24);
  const staleSince = ageDays > 45 ? sourceDate.toISOString() : undefined;

  const dbRecordsToArchive = [];

  for (const country of WAIT_TIME_COUNTRIES) {
    const outPath = path.join(OUT_DIR, `${country.slug}.json`);
    const previousRecord = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf-8')) : null;

    const consulates = [];

    for (const consulateName of country.consulates) {
      const normalized = normalizePostName(consulateName);
      let match = postLookup.get(normalized);
      if (!match) {
        for (const [key, val] of postLookup.entries()) {
          if (key.includes(normalized) || normalized.includes(key)) {
            match = val;
            break;
          }
        }
      }

      const prevConsulate = previousRecord?.consulates?.find(c => c.name === consulateName);
      // Strictly discard synthetic seed history if transitioning from seed
      const isPreviousSeed = !previousRecord || previousRecord.dataSource === 'seed';
      const history = (isPreviousSeed || !prevConsulate?.history) ? [] : [...prevConsulate.history];

      if (match) {
        totalConsulates++;
        const waitB1B2 = match.waitTimeB1B2;

        // Append or update current real snapshot period (organic accumulation only)
        const existingHistIdx = history.findIndex(h => h.period === currentPeriod);
        if (existingHistIdx >= 0) {
          history[existingHistIdx] = { period: currentPeriod, waitTimeB1B2: waitB1B2 };
        } else {
          history.push({ period: currentPeriod, waitTimeB1B2: waitB1B2 });
        }

        // Cap at 24 historical points as real months accumulate
        if (history.length > 24) history.splice(0, history.length - 24);

        consulates.push({
          name: consulateName,
          waitTimeB1B2: match.waitTimeB1B2,
          waitTimeStudent: match.waitTimeStudent,
          waitTimeOther: match.waitTimeOther,
          waitTimePetition: match.waitTimePetition,
          waitTimeCrewTransit: match.waitTimeCrewTransit,
          hasEmergencyAppointments: match.hasEmergencyAppointments,
          notes: match.notes,
          history,
        });

        // Stage for PostgreSQL archive
        dbRecordsToArchive.push({
          domain: 'WAIT_TIME',
          entityKey: `${country.slug}-${consulateName.toLowerCase().replace(/\s+/g, '-')}`,
          period: currentPeriod,
          metrics: {
            country: country.name,
            consulate: consulateName,
            waitTimeB1B2: match.waitTimeB1B2,
            waitTimeStudent: match.waitTimeStudent,
            waitTimePetition: match.waitTimePetition,
            waitTimeCrewTransit: match.waitTimeCrewTransit,
            sourceUpdated,
          },
        });
      } else if (prevConsulate) {
        // Retain previous consulate data if missing in snapshot
        consulates.push(prevConsulate);
      }
    }

    if (consulates.length > 0) {
      matchedCountries++;
      const record = {
        country: country.name,
        slug: country.slug,
        countryCode: country.countryCode,
        lastUpdated: sourceUpdated,
        dataSource: 'dos-attended-snapshot',
        sourceUrl: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/global-visa-wait-times.html',
        ...(staleSince ? { staleSince } : {}),
        consulates,
      };

      fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
    }
  }

  console.log(`[import-dos-wait-times] Successfully updated ${matchedCountries} countries (${totalConsulates} consulates) with live DOS snapshot data.`);

  // Archive to PostgreSQL if DATABASE_URL is configured
  if (process.env.DATABASE_URL && dbRecordsToArchive.length > 0) {
    try {
      const prisma = new PrismaClient();
      console.log(`[import-dos-wait-times] Archiving ${dbRecordsToArchive.length} consulate records to PostgreSQL...`);
      for (const rec of dbRecordsToArchive) {
        await prisma.governmentDataArchive.upsert({
          where: {
            domain_entityKey_period: {
              domain: rec.domain,
              entityKey: rec.entityKey,
              period: rec.period,
            },
          },
          update: {
            metrics: rec.metrics,
            fetchedAt: new Date(),
          },
          create: {
            domain: rec.domain,
            entityKey: rec.entityKey,
            period: rec.period,
            metrics: rec.metrics,
          },
        });
      }
      console.log(`[import-dos-wait-times] PostgreSQL archival complete.`);
      await prisma.$disconnect();
    } catch (dbErr) {
      console.warn(`[import-dos-wait-times] PostgreSQL archival skipped (${dbErr.message}).`);
    }
  }

  return { matchedCountries, totalConsulates };
}

// CLI execution
const args = process.argv.slice(2);
const fileArg = args.find(a => a.startsWith('--file='))?.split('=')[1] || args[0] || 'data/dos_global_wait_times.json';

if (fileArg && fs.existsSync(fileArg)) {
  importDosSnapshot(fileArg).catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });
} else if (process.argv[1]?.endsWith('import-dos-wait-times.mjs')) {
  console.log(`Usage: node scripts/import-dos-wait-times.mjs <path-to-dos-snapshot.json>`);
  console.log(`Or: node scripts/import-dos-wait-times.mjs --file=<path-to-dos-snapshot.json>`);
}
