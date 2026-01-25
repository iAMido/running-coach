// Database types for Supabase PostgreSQL
// These match the SQLite schema from the Python Running Coach app

export interface Run {
  id: string;
  user_id?: string;
  filename?: string;
  date: string;
  distance_km: number;
  duration_min: number;
  duration_sec?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_pace_min_km?: number;
  avg_pace_str?: string;
  calories?: number;
  run_type?: string;
  workout_name?: string;
  coach_notes?: string;
  trimp?: number;
  data_source?: string;
  pct_z1?: number;
  pct_z2?: number;
  pct_z3?: number;
  pct_z4?: number;
  pct_z5?: number;
  pct_z6?: number;
  created_at?: string;
}

export interface Lap {
  id: string;
  run_id: string;
  lap_number: number;
  distance_km?: number;
  duration_sec?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_pace_str?: string;
  created_at?: string;
}

export interface AthleteProfile {
  id: string;
  user_id: string;
  name?: string;
  age?: number;
  weight_kg?: number;
  resting_hr?: number;
  max_hr?: number;
  lactate_threshold_hr?: number;
  current_goal?: string;
  training_days?: string;
  injury_history?: string;
  hr_zone_z1?: string;
  hr_zone_z2?: string;
  hr_zone_z3?: string;
  hr_zone_z4?: string;
  hr_zone_z5?: string;
  hr_zone_z6?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TrainingPlan {
  id: string;
  user_id: string;
  plan_type: string;
  plan_json: PlanData;
  duration_weeks: number;
  status: 'active' | 'completed' | 'deleted';
  start_date?: string;
  current_week_num: number;
  created_at?: string;
  // Calculated week info (added by API)
  week_info?: WeekInfo;
  isAfterEnd?: boolean;
}

export interface WeekInfo {
  currentWeek: number;
  isBeforeStart: boolean;
  isAfterEnd: boolean;
  weekStartDate: string;
  weekEndDate: string;
  planStartDate: string;
  planEndDate: string;
  weekDateRange: string;
  daysIntoWeek: number;
  daysRemaining: number;
}

export interface PlanData {
  plan_name?: string;
  methodology?: string;
  goal?: string;
  duration_weeks?: number;
  phase_structure?: {
    base_weeks: number;
    support_weeks: number;
    specific_weeks: number;
    taper_weeks: number;
  };
  weekly_structure?: Record<string, string>;
  weeks?: PlanWeek[];
  current_week?: PlanWeek;
  raw_response?: string; // For unparseable AI responses
}

export interface PlanWeek {
  week_number: number;
  phase: string;
  focus: string;
  total_km: number;
  workouts: Record<string, Workout>;
}

export interface Workout {
  type: string;
  duration?: string;
  distance?: string;
  target_hr?: string;
  target_pace?: string;
  description?: string;
  notes?: string;
}

export interface RunFeedback {
  id: string;
  user_id: string;
  run_date: string;
  rating?: number;
  effort_level?: number;
  feeling?: string;
  comment?: string;
  created_at?: string;
}

export interface WeeklySummary {
  id: string;
  user_id: string;
  week_start: string;
  overall_feeling?: number;
  sleep_quality?: number;
  stress_level?: number;
  injury_notes?: string;
  achievements?: string;
  ai_analysis?: string;
  created_at?: string;
}

export interface WorkoutLibrary {
  id: string;
  user_id: string;
  workout_name: string;
  coach_notes?: string;
  category?: string;
  typical_distance_km?: number;
  typical_duration_min?: number;
  target_zone?: string;
  purpose?: string;
  count: number;
  created_at?: string;
}

export interface StravaToken {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  athlete_id?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Old Coach Data Types (TrainingPeaks import)
// ============================================================

export interface CoachWorkout {
  id: string;
  user_id: string;
  workout_name: string;
  workout_name_variants?: string[];
  category?: string;              // "Easy", "Tempo", "Intervals", "Long Run", "Recovery"
  sub_category?: string;          // "LT1", "LT2", "VO2max", etc.
  training_phase?: string;        // "Base", "Build", "Specific", "Taper"
  description?: string;
  typical_distance_km?: number;
  typical_duration_min?: number;
  target_zone?: string;           // "Z2", "Z3", "Z4", etc.
  target_pace?: string;           // "4:30/km", "Easy", etc.
  intensity_level?: number;       // 1-10
  coach_notes?: string;
  when_to_use?: string;
  when_to_avoid?: string;
  recovery_needed?: string;
  times_performed?: number;
  last_performed?: string;
  avg_feeling?: number;
  source?: string;                // "trainingpeaks", "manual", "garmin"
  created_at?: string;
  updated_at?: string;
}

export interface CoachPhase {
  id: string;
  user_id: string;
  phase_name: string;
  phase_order?: number;
  description?: string;
  typical_duration_weeks?: number;
  focus_areas?: string[];
  weekly_structure?: Record<string, string>;
  workout_types?: string[];
  intensity_distribution?: Record<string, number>;
  coach_notes?: string;
  key_workouts?: string[];
  avoid_in_phase?: string[];
  volume_progression?: string;
  intensity_progression?: string;
  source?: string;
  created_at?: string;
}

// Supabase Database type definition
export interface Database {
  public: {
    Tables: {
      runs: {
        Row: Run;
        Insert: Omit<Run, 'id' | 'created_at'>;
        Update: Partial<Omit<Run, 'id'>>;
      };
      laps: {
        Row: Lap;
        Insert: Omit<Lap, 'id' | 'created_at'>;
        Update: Partial<Omit<Lap, 'id'>>;
      };
      athlete_profile: {
        Row: AthleteProfile;
        Insert: Omit<AthleteProfile, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AthleteProfile, 'id'>>;
      };
      training_plans: {
        Row: TrainingPlan;
        Insert: Omit<TrainingPlan, 'id' | 'created_at'>;
        Update: Partial<Omit<TrainingPlan, 'id'>>;
      };
      run_feedback: {
        Row: RunFeedback;
        Insert: Omit<RunFeedback, 'id' | 'created_at'>;
        Update: Partial<Omit<RunFeedback, 'id'>>;
      };
      weekly_summaries: {
        Row: WeeklySummary;
        Insert: Omit<WeeklySummary, 'id' | 'created_at'>;
        Update: Partial<Omit<WeeklySummary, 'id'>>;
      };
      workout_library: {
        Row: WorkoutLibrary;
        Insert: Omit<WorkoutLibrary, 'id' | 'created_at'>;
        Update: Partial<Omit<WorkoutLibrary, 'id'>>;
      };
      strava_tokens: {
        Row: StravaToken;
        Insert: Omit<StravaToken, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<StravaToken, 'id'>>;
      };
      coach_workouts: {
        Row: CoachWorkout;
        Insert: Omit<CoachWorkout, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<CoachWorkout, 'id'>>;
      };
      coach_phases: {
        Row: CoachPhase;
        Insert: Omit<CoachPhase, 'id' | 'created_at'>;
        Update: Partial<Omit<CoachPhase, 'id'>>;
      };
    };
  };
}

// Chat message types for AI integration
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Dashboard stats type
export interface DashboardStats {
  totalRuns: number;
  totalDistanceKm: number;
  thisWeekKm: number;
  thisWeekRuns: number;
  activePlan: TrainingPlan | null;
}
