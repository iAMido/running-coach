import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { getActivePlanView, getDashboardStats, getRecentRuns } from '@/lib/coach/dashboard-data';
import { CoachDashboard, type DashboardInitial } from '@/components/coach/dashboard';
import type { DashboardStats, Run, TrainingPlan } from '@/lib/db/types';

/**
 * The coach dashboard (2026-11-18). The page used to be a client component
 * that asked for its data only after the JS loaded and the session check
 * finished: three requests (stats, runs, plan) starting a full round trip
 * late. Now the server starts the same three loads when the request arrives
 * and hands the result to the client as a promise, so the page still renders
 * at once (skeleton, then data) and nothing blocks on it.
 */
export const dynamic = 'force-dynamic';

async function loadInitial(): Promise<DashboardInitial | null> {
  try {
    const auth = await getAuthenticatedUser();
    if (!auth.authenticated || !auth.userId) return null;
    const [stats, runs, plan] = await Promise.all([
      getDashboardStats(auth.userId),
      getRecentRuns(auth.userId, 14, 10),
      getActivePlanView(auth.userId),
    ]);
    // The same JSON shape the API routes send (dates as strings).
    return JSON.parse(JSON.stringify({ stats, runs, plan })) as {
      stats: DashboardStats; runs: Run[]; plan: TrainingPlan | null;
    };
  } catch (error) {
    console.error('dashboard preload failed; the page will fetch instead:', error);
    return null;
  }
}

export default function CoachDashboardPage() {
  return <CoachDashboard initial={loadInitial()} />;
}
