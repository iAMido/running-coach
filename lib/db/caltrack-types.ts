export interface CaltrackMeal {
  id: string;
  user_id: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  eaten_at: string;
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  total_fiber_g: number;
  photo_path: string | null;
  photo_url?: string | null;
  notes: string | null;
  status: string;
  item_names?: string[];
}

export interface CoachReport {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  report_text: string;
  created_at: string;
}

export interface MealTemplate {
  id: string;
  user_id: string;
  name: string;
  total_calories: number | null;
  total_protein_g: number | null;
  total_carbs_g: number | null;
  total_fat_g: number | null;
  created_at: string;
  items: MealTemplateItem[];
}

export interface MealTemplateItem {
  id: string;
  template_id: string;
  ingredient_name: string;
  fdc_id: number | null;
  weight_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface CaltrackMealItem {
  id: string;
  meal_id: string;
  ingredient_name: string;
  fdc_id: number | null;
  weight_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface CaltrackDailySummary {
  id: string;
  user_id: string;
  date: string;
  total_calories_in: number;
  total_calories_out: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  total_fiber_g: number;
  total_water_ml: number;
  target_calories: number;
  net_calories: number;
}

export interface CaltrackWeightLog {
  id: string;
  user_id: string;
  weight_kg: number;
  measured_at: string;
}

export interface CaltrackRun {
  id: string;
  user_id: string;
  distance_km: number;
  duration_minutes: number;
  avg_pace_sec_per_km: number | null;
  avg_heart_rate: number | null;
  calories_burned: number;
  source: string;
  run_date: string;
}

export interface CaltrackUserProfile {
  id: string;
  current_weight_kg: number;
  target_weight_kg: number;
  height_cm: number;
  age: number;
  sex: string;
  bmr: number;
  tdee: number;
  target_daily_calories: number;
  activity_factor: number;
}

export interface OverviewStats {
  todayCalories: number;
  todayTarget: number;
  todayProtein: number;
  todayCarbs: number;
  todayFat: number;
  todayFiber: number;
  todayWater: number;
  currentWeight: number;
  targetWeight: number;
  weekAvgCalories: number;
  totalMeals: number;
  streakDays: number;
}

export interface CalorieTrendPoint {
  date: string;
  calories_in: number;
  calories_out: number;
  net: number;
  target: number;
}

export interface MacroBreakdown {
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}
