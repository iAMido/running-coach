import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { classifyRun } from '@/lib/utils/run-classifier';
import { calculateTrimp } from '@/lib/utils/trimp';
import { formatPace, calculatePace } from '@/lib/utils/pace';
import FitParser from 'fit-file-parser';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;

  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    let uploadedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const file of files) {
      try {
        // Check file extension
        if (!file.name.toLowerCase().endsWith('.fit')) {
          errors.push(`${file.name}: Not a FIT file`);
          continue;
        }

        // Check if already uploaded (by filename)
        const filename = `fit_${file.name}`;
        const { data: existing } = await supabase
          .from('runs')
          .select('id')
          .eq('user_id', userId)
          .eq('filename', filename)
          .single();

        if (existing) {
          skippedCount++;
          continue;
        }

        // Parse FIT file
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const fitParser = new FitParser({
          force: true,
          speedUnit: 'km/h',
          lengthUnit: 'km',
          elapsedRecordField: true,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsedData = await new Promise<FitData>((resolve, reject) => {
          fitParser.parse(buffer, (error: any, data: any) => {
            if (error) reject(new Error(String(error)));
            else resolve(data as FitData);
          });
        });

        // Extract session data (main activity summary)
        const sessions = parsedData.sessions || [];
        if (sessions.length === 0) {
          errors.push(`${file.name}: No session data found`);
          continue;
        }

        const session = sessions[0];

        // Only process running activities
        const sport = session.sport?.toLowerCase() || '';
        if (sport !== 'running' && sport !== 'run') {
          errors.push(`${file.name}: Not a running activity (${sport})`);
          continue;
        }

        // Extract run data
        const distanceKm = (session.total_distance || 0) / 1000;
        const durationSec = session.total_timer_time || session.total_elapsed_time || 0;
        const durationMin = durationSec / 60;
        const avgHr = session.avg_heart_rate || null;
        const maxHr = session.max_heart_rate || null;
        const calories = session.total_calories || null;
        const startTime = session.start_time || session.timestamp;

        if (distanceKm < 0.1 || durationMin < 1) {
          errors.push(`${file.name}: Activity too short`);
          continue;
        }

        const avgPaceMinKm = calculatePace(distanceKm, durationMin);
        const runType = classifyRun({
          distanceKm,
          avgHr: avgHr ?? undefined,
          maxHr: maxHr ?? undefined,
          durationMin,
        });
        const trimp = avgHr ? calculateTrimp({ durationMin, avgHr }) : null;

        // Extract HR zone percentages from laps if available
        let pctZ1 = null, pctZ2 = null, pctZ3 = null, pctZ4 = null, pctZ5 = null, pctZ6 = null;

        if (parsedData.hrv && Array.isArray(parsedData.hrv)) {
          // HR zone data might be in different places depending on device
        }

        // Insert run
        const { error: insertError } = await supabase
          .from('runs')
          .insert({
            user_id: userId,
            filename,
            date: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
            distance_km: Math.round(distanceKm * 100) / 100,
            duration_min: Math.round(durationMin * 100) / 100,
            duration_sec: Math.round(durationSec),
            avg_hr: avgHr,
            max_hr: maxHr,
            avg_pace_min_km: avgPaceMinKm,
            avg_pace_str: formatPace(avgPaceMinKm),
            calories,
            run_type: runType,
            workout_name: file.name.replace('.fit', '').replace('.FIT', ''),
            trimp,
            data_source: 'fit_upload',
            pct_z1: pctZ1,
            pct_z2: pctZ2,
            pct_z3: pctZ3,
            pct_z4: pctZ4,
            pct_z5: pctZ5,
            pct_z6: pctZ6,
          });

        if (insertError) {
          errors.push(`${file.name}: ${insertError.message}`);
        } else {
          uploadedCount++;
        }
      } catch (fileError) {
        errors.push(`${file.name}: ${fileError instanceof Error ? fileError.message : 'Parse error'}`);
      }
    }

    return NextResponse.json({
      success: true,
      uploaded: uploadedCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error uploading FIT files:', error);
    return NextResponse.json({ error: 'Failed to upload files' }, { status: 500 });
  }
}

// Type definitions for FIT parser
interface FitSession {
  sport?: string;
  total_distance?: number;
  total_timer_time?: number;
  total_elapsed_time?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  total_calories?: number;
  start_time?: Date | string;
  timestamp?: Date | string;
}

interface FitData {
  sessions?: FitSession[];
  hrv?: unknown[];
}
