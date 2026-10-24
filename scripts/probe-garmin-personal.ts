/**
 * Read-only probe of Garmin's official Personal API (launched 2026-10-21).
 *
 * Same purpose as the intervals.icu probe that preceded that integration
 * (`docs/intervals-icu-probe-findings.md`): measure what the API actually
 * returns for THIS athlete before writing a mapper. Every path and query
 * parameter below comes from third-party write-ups of the Swagger page, not
 * from Garmin's docs, so each probe is independent — one wrong guess costs that
 * probe, not the run.
 *
 * The Personal API has no POST/PUT/DELETE apart from the token exchange, so
 * this cannot write to Garmin even by mistake. It writes nothing to Postgres.
 * Raw responses land in --out for inspection.
 *
 * Get a key: Garmin Connect (web) -> Settings -> Personal API. It is shown
 * ONCE. Put it in .env.local as GARMIN_PERSONAL_API_KEY.
 *
 * Usage:
 *   bunx tsx scripts/probe-garmin-personal.ts --env .env.local --days 14 --out garmin-probe
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

dotenv.config({ path: path.resolve(process.cwd(), argValue('--env') ?? '.env.local') });

const BASE = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function exchangeKey(apiKey: string): Promise<string> {
  const res = await fetch(`${BASE}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${text.slice(0, 300)}`);
  // Reported as a raw ~1.1 KB token; accept a JSON wrapper too in case it is one.
  try {
    const json = JSON.parse(text);
    const token = json.access_token ?? json.accessToken ?? json.token;
    if (typeof token === 'string') return token;
  } catch {
    // not JSON — a raw token
  }
  return text.trim().replace(/^"|"$/g, '');
}

function describe(body: unknown): string {
  if (Array.isArray(body)) {
    const first = body[0];
    const keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 40).join(', ') : typeof first;
    return `array[${body.length}] first keys: ${keys}`;
  }
  if (body && typeof body === 'object') return `object keys: ${Object.keys(body).slice(0, 40).join(', ')}`;
  return typeof body;
}

async function main() {
  const apiKey = process.env.GARMIN_PERSONAL_API_KEY;
  if (!apiKey) throw new Error('GARMIN_PERSONAL_API_KEY is not set');

  const days = Number(argValue('--days') ?? 14);
  const outDir = path.resolve(process.cwd(), argValue('--out') ?? 'garmin-probe');
  fs.mkdirSync(outDir, { recursive: true });

  const newest = isoDay(new Date());
  const oldest = isoDay(new Date(Date.now() - days * 86_400_000));

  console.log(`\nGarmin Personal API probe — READ ONLY, ${oldest} .. ${newest}`);
  const token = await exchangeKey(apiKey);
  console.log(`token: ${token.length} chars`);

  async function get(name: string, pathAndQuery: string, binary = false): Promise<unknown> {
    const res = await fetch(`${BASE}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: binary ? '*/*' : 'application/json' },
    });
    if (!res.ok) {
      console.log(`✗ ${name.padEnd(22)} ${res.status} ${pathAndQuery}`);
      return null;
    }
    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(outDir, `${name}.bin`), buf);
      console.log(`✓ ${name.padEnd(22)} ${buf.length} bytes (${res.headers.get('content-type')})`);
      return buf;
    }
    const body = await res.json();
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(body, null, 2));
    console.log(`✓ ${name.padEnd(22)} ${describe(body)}`);
    return body;
  }

  const activities = (await get(
    'activities',
    `/activitylist-service/activities/search/activities?startDate=${oldest}&endDate=${newest}&start=0&limit=50`,
  )) as Array<Record<string, unknown>> | null;

  const run = activities?.find((a) => {
    const type = (a.activityType as { typeKey?: string } | undefined)?.typeKey ?? '';
    return type.includes('running');
  });
  if (run) {
    const id = run.activityId;
    console.log(`  latest run: ${id} ${run.activityName} ${run.startTimeLocal}`);
    // The summary fields the mapper would need — undefined means "not on the summary".
    for (const k of [
      'startTimeGMT', 'distance', 'duration', 'movingDuration', 'averageHR', 'maxHR',
      'elevationGain', 'elevationLoss', 'avgGradeAdjustedSpeed', 'averageRunningCadenceInStepsPerMinute',
      'hrTimeInZone_1', 'trainingEffectLabel', 'aerobicTrainingEffect', 'vO2MaxValue',
    ]) console.log(`    ${k.padEnd(38)} ${JSON.stringify(run[k])}`);
    await get('activity_detail', `/activity-service/activity/${id}`);
    await get('activity_workouts', `/activity-service/activity/${id}/workouts`);
    // Original upload is a zip holding the FIT. Laps and the HR stream would come from here.
    await get('activity_fit', `/download-service/files/activity/${id}`, true);
  } else {
    console.log('  no running activity in window — widen --days');
  }

  await get('hrv_range', `/hrv-service/hrv/daily/${oldest}/${newest}`);
  await get('hrv_today', `/hrv-service/hrv/${newest}`);
  await get('sleep_daily', `/sleep-service/sleep/dailySleep?date=${newest}`);
  await get('body_battery', `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${oldest}&endDate=${newest}`);
  await get('daily_summaries', `/usersummary-service/v2/dailysummaries?startDate=${oldest}&endDate=${newest}`);
  await get('hr_zones', `/heartRateZones/v2`);
  await get('user_settings', `/userprofile-service/userprofile/settings`);

  console.log(`\nRaw responses in ${outDir} — contains health data, do not commit.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
