/**
 * Pace conversion and formatting utilities
 */

/**
 * Convert pace from decimal minutes to MM:SS string
 * e.g., 5.5 -> "5:30"
 */
export function formatPace(paceMinKm: number): string {
  if (!paceMinKm || paceMinKm <= 0) return '--:--';

  // Round the whole pace to seconds first: rounding only the seconds part
  // turned 5.9997 into "5:60" instead of "6:00".
  const totalSec = Math.round(paceMinKm * 60);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Convert pace string (MM:SS) to decimal minutes
 * e.g., "5:30" -> 5.5
 */
export function parsePace(paceStr: string): number {
  const parts = paceStr.split(':');
  if (parts.length !== 2) return 0;

  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);

  return minutes + seconds / 60;
}

/**
 * Calculate pace from distance and duration
 */
export function calculatePace(distanceKm: number, durationMin: number): number {
  if (!distanceKm || distanceKm <= 0) return 0;
  return durationMin / distanceKm;
}

/**
 * Format duration in minutes to HH:MM:SS or MM:SS
 */
export function formatDuration(durationMin: number): string {
  if (!durationMin || durationMin <= 0) return '--:--';

  const hours = Math.floor(durationMin / 60);
  const minutes = Math.floor(durationMin % 60);
  const seconds = Math.round((durationMin % 1) * 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Convert pace to speed in km/h
 */
export function paceToSpeed(paceMinKm: number): number {
  if (!paceMinKm || paceMinKm <= 0) return 0;
  return 60 / paceMinKm;
}

/**
 * Convert speed in km/h to pace
 */
export function speedToPace(speedKmh: number): number {
  if (!speedKmh || speedKmh <= 0) return 0;
  return 60 / speedKmh;
}

/**
 * Get pace zone description
 */
export function getPaceZone(paceMinKm: number): string {
  if (paceMinKm >= 7.0) return 'Recovery';
  if (paceMinKm >= 6.3) return 'Easy';
  if (paceMinKm >= 5.8) return 'Moderate';
  if (paceMinKm >= 5.4) return 'Tempo';
  if (paceMinKm >= 5.0) return 'Threshold';
  if (paceMinKm >= 4.5) return 'Interval';
  return 'Sprint';
}
