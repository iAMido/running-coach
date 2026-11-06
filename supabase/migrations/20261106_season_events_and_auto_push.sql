-- Training races and events (2026-11-06).
--
-- Belong to the ATHLETE, not to a season row: a season revision is a new
-- macro_plans row, and races must survive it. Coach-suggested slots carry the
-- season that suggested them and are replaced when the season is revised
-- (unless the athlete has filled them with a real race).
create table if not exists runcoach.season_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  -- 'coach' = a slot the season head coach suggested; 'athlete' = added by him.
  source text not null default 'athlete' check (source in ('coach', 'athlete')),
  -- suggested = an unfilled coach slot; planned = a real event on the calendar;
  -- done = it happened (run matched); skipped = he did not do it.
  status text not null default 'planned' check (status in ('suggested', 'planned', 'done', 'skipped')),
  priority text not null default 'C' check (priority in ('A', 'B', 'C')),
  name text,
  event_date date,
  -- A coach slot is a window, not a date: "a race somewhere in these weeks".
  window_start date,
  window_end date,
  distance_km numeric,
  elevation_gain_m integer,
  purpose text,
  url text,
  notes text,
  macro_plan_id uuid references runcoach.macro_plans(id) on delete set null,
  run_id uuid references runcoach.runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'suggested' or event_date is not null)
);
create index if not exists season_events_user_date on runcoach.season_events (user_id, event_date);
alter table runcoach.season_events enable row level security;

-- Auto-sync of plan weeks to the watch. On by default for a connected account.
alter table runcoach.intervals_tokens add column if not exists auto_push boolean not null default true;

-- What was last pushed for each plan week, so auto-sync re-pushes only when
-- the week actually changed (a push deletes and recreates its events).
create table if not exists runcoach.watch_pushes (
  user_id text not null,
  plan_id uuid not null references runcoach.training_plans(id) on delete cascade,
  week_number integer not null,
  content_hash text not null,
  pushed_at timestamptz not null default now(),
  created integer not null default 0,
  errors jsonb,
  trigger text,
  primary key (user_id, plan_id, week_number)
);
alter table runcoach.watch_pushes enable row level security;
