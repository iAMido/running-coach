-- Daily AI spend per athlete (2026-11-18). Replaces the in-memory per-IP rate
-- limiter in middleware.ts, which counted per server instance, reset on every
-- deploy and did not cover the plan builder at all.
--
-- Every model call made on an athlete's behalf adds what the provider actually
-- charged (OpenRouter / NanoGPT `usage.cost`) to today's row (Israel date);
-- callOpenRouter refuses new calls once the day reaches the cap.

create table if not exists runcoach.ai_spend_daily (
  user_id    text        not null,
  day        date        not null,
  usd        numeric(10, 4) not null default 0,
  calls      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table runcoach.ai_spend_daily enable row level security;
-- No policies: only the service role (which bypasses RLS) reads or writes it.

-- One atomic increment; returns the day's new total.
create or replace function runcoach.add_ai_spend(p_user_id text, p_day date, p_usd numeric)
returns numeric
language sql
security definer
set search_path = pg_catalog, runcoach
as $$
  insert into runcoach.ai_spend_daily as s (user_id, day, usd, calls, updated_at)
  values (p_user_id, p_day, greatest(coalesce(p_usd, 0), 0), 1, now())
  on conflict (user_id, day) do update
    set usd = s.usd + excluded.usd,
        calls = s.calls + 1,
        updated_at = now()
  returning usd;
$$;

revoke all on function runcoach.add_ai_spend(text, date, numeric) from public, anon, authenticated;
grant execute on function runcoach.add_ai_spend(text, date, numeric) to service_role;
revoke all on table runcoach.ai_spend_daily from anon, authenticated;
grant select, insert, update on table runcoach.ai_spend_daily to service_role;
