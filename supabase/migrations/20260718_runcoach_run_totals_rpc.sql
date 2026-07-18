-- Aggregate function for the dashboard stats route. The route previously
-- pulled EVERY runs row (656 and growing) just to sum distance_km in JS —
-- unbounded payload growth on every dashboard load. One RPC returns both
-- the count and the sum.
--
-- Applied via Supabase MCP on 2026-07-18.

CREATE OR REPLACE FUNCTION runcoach.run_totals(p_user_id text)
RETURNS TABLE (total_runs bigint, total_km numeric)
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, runcoach
AS $$
  SELECT COUNT(*)::bigint, COALESCE(SUM(distance_km), 0)::numeric
  FROM runcoach.runs
  WHERE user_id = p_user_id;
$$;
