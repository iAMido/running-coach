-- Seed runcoach.coach_phases from the user's actual coach_workouts data.
--
-- The TrainingPeaks import populated coach_workouts (69 rows) but left
-- coach_phases empty (0 rows). The RAG retriever then returned nothing from
-- the "old-coach phases" layer, wasting ~10% of the AI's context budget and
-- depriving the coach of useful phase-level wisdom that's implicit in the
-- workout notes.
--
-- This migration synthesizes two phases (Base, Specific) from the existing
-- workouts: the 42 workouts already tagged as 'Base' for the Base phase, and
-- the 27 phase-NULL workouts (mostly threshold / tempo / race-tune) for the
-- Specific phase. focus_areas and progression hints are hand-authored from
-- the visible workout names; key_workouts and coach_notes are aggregated
-- straight from coach_workouts.
--
-- Applied via Supabase MCP on 2026-06-03.

INSERT INTO runcoach.coach_phases (
  user_id, phase_name, phase_order, description, typical_duration_weeks,
  focus_areas, workout_types, key_workouts, coach_notes,
  volume_progression, intensity_progression, source
)
SELECT
  'idomosseri@gmail.com',
  'Base',
  1,
  'Aerobic foundation phase. Builds LT1/VT1 capacity through extensive easy/threshold work, plus introductory VO2max sessions and progressive long aerobic runs. Heavy use of hill reps and strides for neuromuscular freshness.',
  8,
  ARRAY['Aerobic base', 'LT1/VT1', 'Easy volume', 'VO2 introduction', 'Hills'],
  array_agg(DISTINCT category) FILTER (WHERE category IS NOT NULL),
  (array_agg(workout_name ORDER BY COALESCE(times_performed, 0) DESC))[1:8],
  string_agg(DISTINCT coach_notes, E'\n---\n' ORDER BY coach_notes) FILTER (WHERE coach_notes IS NOT NULL AND coach_notes <> ''),
  'Progressive long runs from 45min to 90min @ Pace; weekly LT1 sessions extend duration over time.',
  'Mostly Z1-Z2 with weekly VO2 intro reps and threshold-light efforts.',
  'synthesized_from_coach_workouts'
FROM runcoach.coach_workouts
WHERE training_phase = 'Base';

INSERT INTO runcoach.coach_phases (
  user_id, phase_name, phase_order, description, typical_duration_weeks,
  focus_areas, workout_types, key_workouts, coach_notes,
  volume_progression, intensity_progression, source
)
SELECT
  'idomosseri@gmail.com',
  'Specific',
  2,
  'Race-specific phase. Threshold work, tempo runs, and race tune-up sessions. LT1 sessions paired with tempo or RP intervals; recovery sessions controlled by RPE rather than pace.',
  6,
  ARRAY['Threshold (LT2)', 'Tempo', 'Race pace', 'Recovery management'],
  array_agg(DISTINCT category) FILTER (WHERE category IS NOT NULL),
  (array_agg(workout_name ORDER BY COALESCE(times_performed, 0) DESC))[1:8],
  string_agg(DISTINCT coach_notes, E'\n---\n' ORDER BY coach_notes) FILTER (WHERE coach_notes IS NOT NULL AND coach_notes <> ''),
  'Volume gently held; tempo distance grows toward race-specific length.',
  'Threshold dose increases; long runs include in-race-pace blocks (Aerobic capacity W TEMPO, Tempo race tune).',
  'synthesized_from_coach_workouts'
FROM runcoach.coach_workouts
WHERE training_phase IS NULL;
