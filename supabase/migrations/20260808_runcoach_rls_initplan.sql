-- Fix 31 `auth_rls_initplan` performance warnings in the runcoach schema.
--
-- auth.role() / auth.uid() called directly in an RLS expression are
-- re-evaluated once per row. Wrapping each call in a scalar subquery lets the
-- planner hoist it into an InitPlan that runs once per query.
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Pure rewrite: every predicate keeps identical semantics, the same roles
-- (public), and the same PERMISSIVE/command. ALTER POLICY is used rather than
-- DROP + CREATE so no policy is ever momentarily absent — with RLS enabled, a
-- missing policy is deny-all, and a DROP/CREATE window could reject live
-- queries.
--
-- The UPDATE policies below have no explicit WITH CHECK, so Postgres reuses
-- USING for the check. Altering USING alone preserves that.
--
-- Verified after applying: 0 policies with an unwrapped auth call; all 31
-- warnings cleared; runcoach.runs still returns 0 rows to anon and to
-- authenticated, and all 680 to service_role.

-- ---------------------------------------------------------------
-- Shape A: auth.role() = 'service_role'   (21 policies)
-- ---------------------------------------------------------------

-- USING-only (SELECT / UPDATE / DELETE)
alter policy athlete_profile_select_own  on runcoach.athlete_profile  using ((select auth.role()) = 'service_role'::text);
alter policy athlete_profile_update_own  on runcoach.athlete_profile  using ((select auth.role()) = 'service_role'::text);
alter policy run_feedback_select_own     on runcoach.run_feedback     using ((select auth.role()) = 'service_role'::text);
alter policy run_feedback_update_own     on runcoach.run_feedback     using ((select auth.role()) = 'service_role'::text);
alter policy runs_select_own             on runcoach.runs             using ((select auth.role()) = 'service_role'::text);
alter policy runs_update_own             on runcoach.runs             using ((select auth.role()) = 'service_role'::text);
alter policy runs_delete_own             on runcoach.runs             using ((select auth.role()) = 'service_role'::text);
alter policy strava_tokens_select_own    on runcoach.strava_tokens    using ((select auth.role()) = 'service_role'::text);
alter policy strava_tokens_update_own    on runcoach.strava_tokens    using ((select auth.role()) = 'service_role'::text);
alter policy strava_tokens_delete_own    on runcoach.strava_tokens    using ((select auth.role()) = 'service_role'::text);
alter policy training_plans_select_own   on runcoach.training_plans   using ((select auth.role()) = 'service_role'::text);
alter policy training_plans_update_own   on runcoach.training_plans   using ((select auth.role()) = 'service_role'::text);
alter policy training_plans_delete_own   on runcoach.training_plans   using ((select auth.role()) = 'service_role'::text);
alter policy weekly_summaries_select_own on runcoach.weekly_summaries using ((select auth.role()) = 'service_role'::text);
alter policy weekly_summaries_update_own on runcoach.weekly_summaries using ((select auth.role()) = 'service_role'::text);

-- WITH CHECK-only (INSERT)
alter policy athlete_profile_insert_own  on runcoach.athlete_profile  with check ((select auth.role()) = 'service_role'::text);
alter policy run_feedback_insert_own     on runcoach.run_feedback     with check ((select auth.role()) = 'service_role'::text);
alter policy runs_insert_own             on runcoach.runs             with check ((select auth.role()) = 'service_role'::text);
alter policy strava_tokens_insert_own    on runcoach.strava_tokens    with check ((select auth.role()) = 'service_role'::text);
alter policy training_plans_insert_own   on runcoach.training_plans   with check ((select auth.role()) = 'service_role'::text);
alter policy weekly_summaries_insert_own on runcoach.weekly_summaries with check ((select auth.role()) = 'service_role'::text);

-- ---------------------------------------------------------------
-- Shape B: (auth.uid())::text = user_id   (10 policies)
-- ---------------------------------------------------------------

-- USING-only
alter policy "Users can view own phases"     on runcoach.coach_phases   using (((select auth.uid()))::text = user_id);
alter policy "Users can update own phases"   on runcoach.coach_phases   using (((select auth.uid()))::text = user_id);
alter policy "Users can delete own phases"   on runcoach.coach_phases   using (((select auth.uid()))::text = user_id);
alter policy "Users can view own workouts"   on runcoach.coach_workouts using (((select auth.uid()))::text = user_id);
alter policy "Users can update own workouts" on runcoach.coach_workouts using (((select auth.uid()))::text = user_id);
alter policy "Users can delete own workouts" on runcoach.coach_workouts using (((select auth.uid()))::text = user_id);
alter policy "Users can read own reports"    on runcoach.coach_reports  using (user_id = ((select auth.uid()))::text);

alter policy "Users can read own laps via runs" on runcoach.laps using (
  run_id in (
    select runs.id from runcoach.runs
    where runs.user_id = ((select auth.uid()))::text
  )
);

-- WITH CHECK-only (INSERT)
alter policy "Users can insert own phases"   on runcoach.coach_phases   with check (((select auth.uid()))::text = user_id);
alter policy "Users can insert own workouts" on runcoach.coach_workouts with check (((select auth.uid()))::text = user_id);
