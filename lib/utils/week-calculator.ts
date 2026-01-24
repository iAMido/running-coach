/**
 * Utility functions for calculating training plan week based on date
 * Week starts on Sunday
 */

/**
 * Get the Sunday that starts the week containing the given date
 * @param date - The date to find the Sunday for
 * @returns Date object set to the Sunday of that week (00:00:00)
 */
export function getSundayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calculate the current week number of a training plan
 * @param startDate - The start date of the plan (string or Date)
 * @param durationWeeks - Total weeks in the plan
 * @param referenceDate - Optional date to calculate from (defaults to now)
 * @returns Object with currentWeek, isBeforeStart, isAfterEnd, weekStartDate, weekEndDate
 */
export function calculateCurrentWeek(
  startDate: string | Date,
  durationWeeks: number,
  referenceDate: Date = new Date()
): {
  currentWeek: number;
  isBeforeStart: boolean;
  isAfterEnd: boolean;
  weekStartDate: Date;
  weekEndDate: Date;
  planStartDate: Date;
  planEndDate: Date;
  daysIntoWeek: number;
  daysRemaining: number;
} {
  // Parse start date
  const planStart = new Date(startDate);
  planStart.setHours(0, 0, 0, 0);

  // Get the Sunday of the week containing the start date (Week 1 starts here)
  const week1Start = getSundayOfWeek(planStart);

  // Get today's date at midnight
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  // Calculate the Sunday of the current week
  const currentWeekStart = getSundayOfWeek(today);

  // Calculate plan end date (last day of the last week - Saturday)
  const planEndDate = new Date(week1Start);
  planEndDate.setDate(planEndDate.getDate() + (durationWeeks * 7) - 1);

  // Calculate weeks difference
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.floor((currentWeekStart.getTime() - week1Start.getTime()) / msPerDay);
  const weeksDiff = Math.floor(daysDiff / 7);

  // Calculate raw week number (1-indexed)
  let currentWeek = weeksDiff + 1;

  // Check if before start or after end
  const isBeforeStart = today < week1Start;
  const isAfterEnd = currentWeek > durationWeeks;

  // Clamp week number to valid range
  if (isBeforeStart) {
    currentWeek = 1;
  } else if (isAfterEnd) {
    currentWeek = durationWeeks;
  }

  // Calculate current week's start and end dates
  const weekStartDate = new Date(week1Start);
  weekStartDate.setDate(weekStartDate.getDate() + (currentWeek - 1) * 7);

  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  // Calculate days into the current week (0 = Sunday, 6 = Saturday)
  const daysIntoWeek = today.getDay();

  // Calculate days remaining in the plan
  const daysRemaining = Math.max(0, Math.ceil((planEndDate.getTime() - today.getTime()) / msPerDay));

  return {
    currentWeek,
    isBeforeStart,
    isAfterEnd,
    weekStartDate,
    weekEndDate,
    planStartDate: planStart,
    planEndDate,
    daysIntoWeek,
    daysRemaining,
  };
}

/**
 * Format a date range for display
 * @param start - Start date
 * @param end - End date
 * @returns Formatted string like "Jan 19 - Jan 25, 2026"
 */
export function formatWeekDateRange(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startStr} - ${endStr}`;
}

/**
 * Get today's day name
 * @param date - Optional date (defaults to today)
 * @returns Day name like "Sunday", "Monday", etc.
 */
export function getTodayDayName(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * Check if a workout day matches today
 * @param workoutDay - Day name from the plan (e.g., "Sunday", "Monday")
 * @param referenceDate - Optional date to compare against
 * @returns true if the workout day is today
 */
export function isWorkoutToday(workoutDay: string, referenceDate: Date = new Date()): boolean {
  const today = getTodayDayName(referenceDate);
  return workoutDay.toLowerCase() === today.toLowerCase();
}

/**
 * Day order starting from Sunday (index 0)
 */
const DAY_ORDER: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Sort workout entries by day of week (Sunday first)
 * @param workouts - Object with day names as keys
 * @returns Sorted array of [day, workout] entries
 */
export function sortWorkoutsByDay<T>(workouts: Record<string, T>): [string, T][] {
  return Object.entries(workouts).sort(([dayA], [dayB]) => {
    const orderA = DAY_ORDER[dayA.toLowerCase()] ?? 7;
    const orderB = DAY_ORDER[dayB.toLowerCase()] ?? 7;
    return orderA - orderB;
  });
}
