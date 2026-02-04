/**
 * Input validation schemas using Zod
 * All API input should be validated before processing
 */

import { z } from 'zod';

// Common validators
const safeString = z.string().max(10000).trim();
const safeText = z.string().max(50000).trim();
const positiveInt = z.number().int().positive();
const rating = z.number().int().min(1).max(10);

// Run data validation
export const runSchema = z.object({
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  distance_km: z.number().positive().max(1000).optional(),
  duration_min: z.number().positive().max(1440).optional(),
  duration_sec: positiveInt.max(86400).optional(),
  avg_hr: positiveInt.max(300).optional(),
  max_hr: positiveInt.max(300).optional(),
  avg_pace_min_km: z.number().positive().max(60).optional(),
  avg_pace_str: safeString.max(20).optional(),
  calories: positiveInt.max(100000).optional(),
  run_type: safeString.max(100).optional(),
  workout_name: safeString.max(200).optional(),
  coach_notes: safeText.optional(),
  data_source: z.enum(['manual', 'strava', 'fit_file']).optional(),
});

// Training plan validation
export const planGenerationSchema = z.object({
  planType: z.enum(['Half Marathon', 'Marathon', '10K', '5K', 'Base Building', 'Custom']),
  durationWeeks: z.number().int().min(1).max(52),
  runsPerWeek: z.number().int().min(1).max(14),
  targetRace: safeString.max(200).optional(),
  notes: safeText.max(2000).optional(),
});

export const planSaveSchema = z.object({
  plan_type: safeString.max(100),
  plan_json: z.record(z.string(), z.unknown()),
  duration_weeks: z.number().int().min(1).max(52),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Plan adjustment validation
export const planAdjustmentSchema = z.object({
  adjustmentType: z.enum(['weekly_review', 'user_request', 'injury', 'performance']).optional(),
  userRequest: safeText.max(10000).optional(), // Increased to handle full conversation context
  weeklyFeedback: z.object({
    overallFeeling: rating.optional(),
    sleepQuality: rating.optional(),
    stressLevel: rating.optional(),
    injuryNotes: safeText.max(1000).optional(),
  }).optional(),
});

// Chat message validation
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: safeText.max(10000),
});

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).max(50).optional(),
  reviewPlan: z.boolean().optional(),
});

// Feedback validation
export const runFeedbackSchema = z.object({
  run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rating: rating.optional(),
  effort_level: rating.optional(),
  feeling: z.enum(['great', 'good', 'okay', 'tired', 'exhausted']).optional(),
  comment: safeText.max(2000).optional(),
});

// Weekly summary validation
export const weeklySummarySchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  overall_feeling: rating.optional(),
  sleep_quality: rating.optional(),
  stress_level: rating.optional(),
  injury_notes: safeText.max(2000).optional(),
  achievements: safeText.max(2000).optional(),
  ai_analysis: safeText.optional(),
});

// Profile validation
export const profileSchema = z.object({
  name: safeString.max(100).optional(),
  age: z.number().int().min(10).max(120).optional(),
  weight_kg: z.number().positive().max(500).optional(),
  resting_hr: positiveInt.max(200).optional(),
  max_hr: positiveInt.max(250).optional(),
  lactate_threshold_hr: positiveInt.max(250).optional(),
  current_goal: safeString.max(500).optional(),
  training_days: safeString.max(100).optional(),
  injury_history: safeText.max(2000).optional(),
  hr_zone_z1: safeString.max(20).optional(),
  hr_zone_z2: safeString.max(20).optional(),
  hr_zone_z3: safeString.max(20).optional(),
  hr_zone_z4: safeString.max(20).optional(),
  hr_zone_z5: safeString.max(20).optional(),
  hr_zone_z6: safeString.max(20).optional(),
});

// Strava sync validation
export const stravaSyncSchema = z.object({
  daysBack: z.number().int().min(1).max(365).optional(),
});

// Review analysis validation
export const reviewAnalysisSchema = z.object({
  overallFeeling: rating.optional(),
  sleepQuality: rating.optional(),
  stressLevel: rating.optional(),
  injuryNotes: safeText.max(2000).optional(),
  achievements: safeText.max(2000).optional(),
});

// Helper function to validate and return typed result or error
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMessages = result.error.issues
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .join(', ');
  return { success: false, error: `Validation error: ${errorMessages}` };
}
