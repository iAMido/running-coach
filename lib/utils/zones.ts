/**
 * HR-zone helpers.
 *
 * Parses the athlete's "low-high" zone strings from athlete_profile and
 * buckets a heart-rate time series into Z1..Z6 percentages so we can store
 * pct_z1..pct_z6 on the runs row. Today the Strava sync stores avg HR but
 * never computes the zone distribution; that's why every Strava-synced run
 * shows up to the AI with no zone breakdown.
 */

import type { AthleteProfile } from '@/lib/db/types';

export interface ZoneBands {
  z1: { low: number; high: number };
  z2: { low: number; high: number };
  z3: { low: number; high: number };
  z4: { low: number; high: number };
  z5: { low: number; high: number };
  z6: { low: number; high: number };
}

const FALLBACK_BANDS: ZoneBands = {
  z1: { low: 0, high: 120 },
  z2: { low: 120, high: 138 },
  z3: { low: 138, high: 150 },
  z4: { low: 150, high: 162 },
  z5: { low: 162, high: 175 },
  z6: { low: 175, high: 250 },
};

function parseRange(s: string | undefined | null, fallback: { low: number; high: number }) {
  if (!s) return fallback;
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return { low: parseInt(m[1], 10), high: parseInt(m[2], 10) };
  const open = s.match(/(\d+)\s*\+/);
  if (open) return { low: parseInt(open[1], 10), high: parseInt(open[1], 10) + 50 };
  return fallback;
}

export function parseZonesFromProfile(profile: AthleteProfile | null | undefined): ZoneBands {
  if (!profile) return FALLBACK_BANDS;
  return {
    z1: parseRange(profile.hr_zone_z1, FALLBACK_BANDS.z1),
    z2: parseRange(profile.hr_zone_z2, FALLBACK_BANDS.z2),
    z3: parseRange(profile.hr_zone_z3, FALLBACK_BANDS.z3),
    z4: parseRange(profile.hr_zone_z4, FALLBACK_BANDS.z4),
    z5: parseRange(profile.hr_zone_z5, FALLBACK_BANDS.z5),
    z6: parseRange(profile.hr_zone_z6, FALLBACK_BANDS.z6),
  };
}

/**
 * Given a parallel HR series + time series (seconds), return percentage time
 * in each zone. Strava returns these as separate streams from
 * /activities/{id}/streams?keys=heartrate,time.
 *
 * Strategy: for each sample, attribute the time-delta from the previous
 * sample to the zone the current HR is in. Robust to irregular sampling.
 */
export function computeZonePercentsFromStream(
  hr: number[],
  time: number[] | null,
  bands: ZoneBands,
): { pct_z1: number; pct_z2: number; pct_z3: number; pct_z4: number; pct_z5: number; pct_z6: number } {
  if (!hr || hr.length === 0) {
    return { pct_z1: 0, pct_z2: 0, pct_z3: 0, pct_z4: 0, pct_z5: 0, pct_z6: 0 };
  }

  const buckets = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0 };

  for (let i = 0; i < hr.length; i++) {
    const bpm = hr[i];
    if (!bpm || bpm < 30) continue;
    const dt = time && i > 0 ? Math.max(0, time[i] - time[i - 1]) : 1;
    const z = zoneFor(bpm, bands);
    buckets[z] += dt;
  }

  const total = buckets.z1 + buckets.z2 + buckets.z3 + buckets.z4 + buckets.z5 + buckets.z6;
  if (total === 0) {
    return { pct_z1: 0, pct_z2: 0, pct_z3: 0, pct_z4: 0, pct_z5: 0, pct_z6: 0 };
  }

  const pct = (v: number) => Math.round((v / total) * 1000) / 10; // one decimal
  return {
    pct_z1: pct(buckets.z1),
    pct_z2: pct(buckets.z2),
    pct_z3: pct(buckets.z3),
    pct_z4: pct(buckets.z4),
    pct_z5: pct(buckets.z5),
    pct_z6: pct(buckets.z6),
  };
}

function zoneFor(bpm: number, b: ZoneBands): 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | 'z6' {
  if (bpm < b.z2.low) return 'z1';
  if (bpm < b.z3.low) return 'z2';
  if (bpm < b.z4.low) return 'z3';
  if (bpm < b.z5.low) return 'z4';
  if (bpm < b.z6.low) return 'z5';
  return 'z6';
}
