/**
 * Telemetry logger for AI coach calls. One row per request into
 * runcoach.coach_calls; weekly health audit aggregates from here.
 */

import { supabase } from '@/lib/db/supabase';
import type { CoachCallRow } from './types';

export async function logCoachCall(row: CoachCallRow): Promise<string | null> {
  const { data, error } = await supabase
    .from('coach_calls')
    .insert(row)
    .select('id')
    .single();

  if (error || !data) {
    // Telemetry must never break the request — log to console only.
    console.warn('coach_calls insert failed:', error?.message);
    return null;
  }
  return data.id;
}
