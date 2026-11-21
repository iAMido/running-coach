/**
 * Garmin Connect tokens, encrypted at rest (lib/intervals/crypto.ts), and the
 * record of workouts the app created there. See
 * supabase/migrations/20261121_garmin_connect.sql.
 */

import { supabase } from '@/lib/db/supabase';
import { decryptSecret, encryptSecret } from '@/lib/intervals/crypto';
import {
  GarminConnectClient,
  type GarminConsumer,
  type GarminOAuth1,
  type GarminOAuth2,
} from '@/lib/garmin-connect/client';

interface TokenRow {
  user_id: string;
  oauth1: string;
  consumer: string;
  oauth2: string | null;
  oauth2_expires_at: string | null;
  auto_push: boolean;
  last_success_at: string | null;
  last_error: string | null;
}

export async function saveGarminConnectLogin(
  userId: string,
  oauth1: GarminOAuth1,
  consumer: GarminConsumer,
  oauth2?: GarminOAuth2 | null,
): Promise<void> {
  const { error } = await supabase.from('garmin_connect_tokens').upsert({
    user_id: userId,
    oauth1: encryptSecret(JSON.stringify(oauth1)),
    consumer: encryptSecret(JSON.stringify(consumer)),
    oauth2: oauth2 ? encryptSecret(JSON.stringify(oauth2)) : null,
    oauth2_expires_at: oauth2 ? new Date(oauth2.expires_at_ms).toISOString() : null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(`Could not save the Garmin Connect sign-in: ${error.message}`);
}

export async function getGarminConnectRow(userId: string): Promise<TokenRow | null> {
  const { data, error } = await supabase.from('garmin_connect_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TokenRow | null) ?? null;
}

/** A client for the athlete, caching fresh OAuth2 tokens. Null when not connected. */
export async function garminConnectClientFor(userId: string): Promise<GarminConnectClient | null> {
  const row = await getGarminConnectRow(userId);
  if (!row) return null;
  const oauth2 = row.oauth2 ? (JSON.parse(decryptSecret(row.oauth2)) as GarminOAuth2) : null;
  return new GarminConnectClient({
    consumer: JSON.parse(decryptSecret(row.consumer)) as GarminConsumer,
    oauth1: JSON.parse(decryptSecret(row.oauth1)) as GarminOAuth1,
    oauth2,
    onOAuth2: async (t) => {
      await supabase.from('garmin_connect_tokens').update({
        oauth2: encryptSecret(JSON.stringify(t)),
        oauth2_expires_at: new Date(t.expires_at_ms).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
    },
  });
}

export async function recordGarminConnectResult(userId: string, error: string | null): Promise<void> {
  await supabase.from('garmin_connect_tokens').update(
    error ? { last_error: error.slice(0, 500), updated_at: new Date().toISOString() }
      : { last_error: null, last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ).eq('user_id', userId);
}
