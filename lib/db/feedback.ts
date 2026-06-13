import { supabase } from './supabase';
import type { RunFeedback, WeeklySummary } from './types';

// ==================== Run Feedback ====================

/**
 * Create run feedback
 */
export async function createRunFeedback(
  feedback: Omit<RunFeedback, 'id' | 'created_at'>
): Promise<RunFeedback> {
  const { data, error } = await supabase
    .from('run_feedback')
    .insert(feedback)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get feedback for a specific run date
 */
export async function getFeedbackByDate(
  userId: string,
  runDate: string
): Promise<RunFeedback | null> {
  const { data, error } = await supabase
    .from('run_feedback')
    .select('*')
    .eq('user_id', userId)
    .eq('run_date', runDate)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Get recent feedback entries
 */
export async function getRecentFeedback(
  userId: string,
  days = 14
): Promise<RunFeedback[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data, error } = await supabase
    .from('run_feedback')
    .select('*')
    .eq('user_id', userId)
    .gte('run_date', startDate.toISOString().split('T')[0])
    .order('run_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ==================== Weekly Summaries ====================

/**
 * Create or update weekly summary
 */
export async function upsertWeeklySummary(
  summary: Omit<WeeklySummary, 'id' | 'created_at'>
): Promise<WeeklySummary> {
  const { data, error } = await supabase
    .from('weekly_summaries')
    .upsert(summary, { onConflict: 'user_id,week_start' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get weekly summary for a specific week
 */
export async function getWeeklySummary(
  userId: string,
  weekStart: string
): Promise<WeeklySummary | null> {
  const { data, error } = await supabase
    .from('weekly_summaries')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Get recent weekly summaries
 */
export async function getRecentWeeklySummaries(
  userId: string,
  weeks = 8
): Promise<WeeklySummary[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - weeks * 7);

  const { data, error } = await supabase
    .from('weekly_summaries')
    .select('*')
    .eq('user_id', userId)
    .gte('week_start', startDate.toISOString().split('T')[0])
    .order('week_start', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Update AI analysis for a weekly summary
 */
export async function updateWeeklyAiAnalysis(
  summaryId: string,
  aiAnalysis: string
): Promise<WeeklySummary> {
  const { data, error } = await supabase
    .from('weekly_summaries')
    .update({ ai_analysis: aiAnalysis })
    .eq('id', summaryId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get the start of the current week (Monday)
 */
export function getCurrentWeekStart(): string {
  // Sunday-anchored to match the training plan + dashboard week range.
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek);
  return sunday.toISOString().split('T')[0];
}
