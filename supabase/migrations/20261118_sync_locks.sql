-- One activity sync per athlete at a time.
--
-- Three paths import runs: the cron, sync-on-open (debounced by
-- intervals_tokens.last_sync_at) and the dashboard's "Sync now" button (no
-- debounce). Two of them running together could each miss the other's insert:
-- one in its Garmin step writes garmin_<id> while the other, in its
-- intervals.icu step, writes icu_<id> for the same run — different filenames,
-- so the unique index does not stop it, and the fuzzy match only sees rows
-- that are already committed. The result is a doubled run: double weekly km,
-- two coach notes.
--
-- A lease, not a session lock: Vercel can kill a function mid-sync, so a lock
-- that lived until release would stay held forever. It expires on its own.

create table if not exists runcoach.sync_locks (
  user_id      text primary key,
  holder       text not null,
  locked_until timestamptz not null
);

alter table runcoach.sync_locks enable row level security;

-- Take the lease if it is free or expired. One statement, so two callers can
-- never both get true.
create or replace function runcoach.try_sync_lock(p_user_id text, p_holder text, p_ttl_seconds integer)
returns boolean
language sql
security definer
set search_path = pg_catalog, runcoach
as $$
  with taken as (
    insert into runcoach.sync_locks (user_id, holder, locked_until)
    values (p_user_id, p_holder, now() + make_interval(secs => p_ttl_seconds))
    on conflict (user_id) do update
      set holder = excluded.holder, locked_until = excluded.locked_until
      where runcoach.sync_locks.locked_until < now()
    returning 1
  )
  select exists (select 1 from taken);
$$;

-- Release only our own lease, never one a later caller took after ours expired.
create or replace function runcoach.release_sync_lock(p_user_id text, p_holder text)
returns void
language sql
security definer
set search_path = pg_catalog, runcoach
as $$
  delete from runcoach.sync_locks where user_id = p_user_id and holder = p_holder;
$$;

revoke all on function runcoach.try_sync_lock(text, text, integer) from public, anon, authenticated;
revoke all on function runcoach.release_sync_lock(text, text) from public, anon, authenticated;
grant execute on function runcoach.try_sync_lock(text, text, integer) to service_role;
grant execute on function runcoach.release_sync_lock(text, text) to service_role;
