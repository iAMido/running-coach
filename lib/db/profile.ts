import { supabase } from './supabase';
import type { AthleteProfile } from './types';

/**
 * Get athlete profile for a user
 */
export async function getAthleteProfile(userId: string): Promise<AthleteProfile | null> {
  const { data, error } = await supabase
    .from('athlete_profile')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Create or update athlete profile
 */
export async function upsertAthleteProfile(
  userId: string,
  profile: Partial<Omit<AthleteProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<AthleteProfile> {
  const { data, error } = await supabase
    .from('athlete_profile')
    .upsert(
      {
        user_id: userId,
        ...profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update HR zones
 */
export async function updateHrZones(
  userId: string,
  zones: {
    hr_zone_z1?: string;
    hr_zone_z2?: string;
    hr_zone_z3?: string;
    hr_zone_z4?: string;
    hr_zone_z5?: string;
    hr_zone_z6?: string;
  }
): Promise<AthleteProfile> {
  return upsertAthleteProfile(userId, zones);
}

/**
 * Get default profile values
 */
export function getDefaultProfile(): Partial<AthleteProfile> {
  return {
    name: '',
    age: 30,
    weight_kg: 70,
    resting_hr: 60,
    max_hr: 185,
    lactate_threshold_hr: 165,
    current_goal: 'General fitness',
    // Deliberately empty. A seeded 'Mon, Wed, Fri' is indistinguishable from a
    // deliberate answer once it is in the row, and every plan built on it
    // inherits the guess — which is what happened here for months. An empty
    // value makes the prompt say the days are unset and ask.
    training_days: '',
    hr_zone_z1: '0-120',
    hr_zone_z2: '120-140',
    hr_zone_z3: '140-155',
    hr_zone_z4: '155-170',
    hr_zone_z5: '170-185',
    hr_zone_z6: '185+',
  };
}
