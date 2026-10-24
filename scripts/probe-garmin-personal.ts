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
    // No Accept header: the token comes back as text, and `Accept: application/json`
    // gets a 406 (measured 2026-10-24). Garmin's own curl example sends none.
    headers: { Authorization: `ApiKey ${apiKey}` },
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

/**
 * Per-field presence across days: `key n/expected`. Present = not null/undefined
 * and not an empty string. A zero counts as present here — whether 0 is a real
 * reading or a placeholder is for the mapper to decide, per field.
 */
function coverage(label: string, rows: Record<string, unknown>[] | undefined, expectedDays: number) {
  if (!rows || rows.length === 0) {
    console.log(`  coverage ${label}: no rows`);
    return;
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const [k, v] of Object.entries(flatten(row ?? {}))) {
      if (v !== null && v !== undefined && v !== '') counts.set(k, (counts.get(k) ?? 0) + 1);
      else if (!counts.has(k)) counts.set(k, 0);
    }
  }
  console.log(`  coverage ${label}: ${rows.length} rows / ${expectedDays} days`);
  const cells = [...counts.entries()].map(([k, n]) => `${k} ${n}`);
  for (let i = 0; i < cells.length; i += 4) console.log(`    ${cells.slice(i, i + 4).join(' · ')}`);
}

/**
 * One level of nesting flattened to `parent.child`, so a v2 daily summary's
 * `bodyBattery: {...}` is counted by the values inside it, not by the wrapper
 * existing. Arrays are left whole (present = non-empty).
 */
function flatten(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out[`${k}.${k2}`] = v2 && typeof v2 === 'object' && !Array.isArray(v2) ? '[object]' : v2;
      }
    } else {
      out[k] = Array.isArray(v) && v.length === 0 ? null : v;
    }
  }
  return out;
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
      headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
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
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      console.log(`? ${name.padEnd(22)} ${res.status} not JSON (${res.headers.get('content-type')}): ${text.slice(0, 120)}`);
      return null;
    }
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

  // ---- Coverage: how many days actually carry each field (the Step 0 go/no-go).
  const hrv = (await get('hrv_range', `/hrv-service/hrv/daily/${oldest}/${newest}`)) as
    | { hrvSummaries?: Record<string, unknown>[] }
    | null;
  coverage('HRV', hrv?.hrvSummaries, days);
  await get('hrv_today', `/hrv-service/hrv/${newest}`);

  const summaries = (await get(
    'daily_summaries',
    `/usersummary-service/v2/dailysummaries?startDate=${oldest}&endDate=${newest}`,
  )) as { data?: Record<string, unknown>[] } | null;
  coverage('daily summaries', summaries?.data, days);

  // Sleep: try a range endpoint first; otherwise one call per day (what a sync would have to do).
  const sleepRange = await get(
    'sleep_range',
    `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${oldest}&endDate=${newest}`,
  );
  if (Array.isArray(sleepRange)) coverage('sleep (range)', sleepRange as Record<string, unknown>[], days);
  const sleepDays = Math.min(days, Number(argValue('--sleep-days') ?? 30));
  const nights: Record<string, unknown>[] = [];
  let sleepFailures = 0;
  for (let i = 0; i < sleepDays; i++) {
    const date = isoDay(new Date(Date.now() - i * 86_400_000));
    const res = await fetch(`${BASE}/sleep-service/sleep/dailySleep?date=${date}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
    });
    if (!res.ok) {
      sleepFailures++;
      if (res.status === 429) {
        console.log(`  sleep per-day: 429 after ${i} calls — stopping`);
        break;
      }
      continue;
    }
    const text = await res.text();
    if (text.trim()) nights.push(JSON.parse(text));
    await new Promise((r) => setTimeout(r, 250));
  }
  fs.writeFileSync(path.join(outDir, 'sleep_per_day.json'), JSON.stringify(nights, null, 2));
  console.log(`  sleep per-day: ${nights.length} responses, ${sleepFailures} failures over ${sleepDays} days`);
  coverage('sleep (per day)', nights, sleepDays);

  // Body battery: 60 days got a 400. Find the range (or parameter names) it accepts.
  for (const span of [28, 7, 1]) {
    const from = isoDay(new Date(Date.now() - (span - 1) * 86_400_000));
    const bb = await get(
      `body_battery_${span}d`,
      `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${from}&endDate=${newest}`,
    );
    if (Array.isArray(bb)) {
      coverage(`body battery (${span}d)`, bb as Record<string, unknown>[], span);
      break;
    }
  }

  // Official Swagger (2026-10-24) lists a dedicated stress range endpoint.
  const stress = await get('stress_range', `/usersummary-service/stats/stress/daily/${oldest}/${newest}`);
  if (Array.isArray(stress)) coverage('stress', stress as Record<string, unknown>[], days);
  else if (stress && typeof stress === 'object') {
    const inner = Object.values(stress).find(Array.isArray) as Record<string, unknown>[] | undefined;
    coverage('stress', inner, days);
  }

  await get('hr_zones', `/biometric-service/heartRateZones/v2`);
  await get('user_settings', `/userprofile-service/userprofile/settings`);

  // --compare N: Garmin's values for the fields intervals.icu also stores, per day,
  // so they can be checked against runcoach.daily_wellness on the same dates.
  // Prints numbers only — your own data, shared on purpose.
  if (argv.includes('--compare')) {
    const n = Number(argValue('--compare') ?? 14) || 14;
    const hrvBy = new Map((hrv?.hrvSummaries ?? []).map((h) => [h.calendarDate as string, h]));
    const sumBy = new Map((summaries?.data ?? []).map((d) => [d.calendarDate as string, d]));
    const sleepBy = new Map(nights.map((s) => [s.calendarDate as string, s]));
    console.log(`\ncompare (last ${n} days): date | hrv lastNightAvg | hrv status | resting HR | sleep h | sleep score | sleep start→end (local)`);
    for (let i = 0; i < n; i++) {
      const date = isoDay(new Date(Date.now() - i * 86_400_000));
      const h = hrvBy.get(date);
      const d = sumBy.get(date) as { heartRate?: { restingValue?: number } } | undefined;
      const sl = sleepBy.get(date) as
        | { sleepTimeSeconds?: number; sleepScores?: { overall?: { value?: number } | number };
            sleepStartTimestampLocal?: number; sleepEndTimestampLocal?: number }
        | undefined;
      const overall = sl?.sleepScores?.overall;
      const score = typeof overall === 'object' ? overall?.value : overall;
      const hm = (ms?: number) => (typeof ms === 'number' ? new Date(ms).toISOString().slice(5, 16).replace('T', ' ') : '-');
      console.log(
        `  ${date} | ${h?.lastNightAvg ?? '-'} | ${h?.status ?? '-'} | ${d?.heartRate?.restingValue ?? '-'} | ` +
          `${typeof sl?.sleepTimeSeconds === 'number' ? (sl.sleepTimeSeconds / 3600).toFixed(2) : '-'} | ${score ?? '-'} | ` +
          `${hm(sl?.sleepStartTimestampLocal)}→${hm(sl?.sleepEndTimestampLocal)}`,
      );
    }
  }

  console.log(`\nRaw responses in ${outDir} — contains health data, do not commit.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
