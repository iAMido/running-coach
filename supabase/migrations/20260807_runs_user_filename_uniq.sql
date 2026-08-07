-- One row per (athlete, provider activity id). Applied 2026-08-07.
--
-- WHY A CONSTRAINT RATHER THAN MORE LOCKING
--
-- `upsertRun` matches on exact filename, then fuzzily, then inserts. That is
-- correct for one caller at a time and silently wrong for two: both look up a
-- brand-new activity, both find nothing, both insert. Until sync-on-open landed
-- the only callers were crons six hours apart, so it could not happen. Now the
-- app can sync while a cron is running.
--
-- The compare-and-swap in `claimAutoSync` only serialises app-open against
-- app-open. Extending it to the crons would work today and would be a
-- convention: every future caller has to remember to claim, and a stuck claim
-- becomes its own failure. This holds for callers that do not exist yet and
-- cannot be forgotten.
--
-- The insert path catches 23505 and re-reads the winner's row, so a lost race
-- degrades to "someone else already imported this" — which is exactly what
-- happened — instead of an error or a duplicate.
--
-- PARTIAL, because 2 of 680 rows have a null filename (legacy `tp_only` rows
-- with no provider id). NULLs are distinct in a unique index anyway; the
-- predicate says so on purpose, and keeps the index off rows it can never
-- constrain.
--
-- Verified immediately before creating: 680 rows, 0 duplicate (user_id,
-- filename) pairs, 2 null filenames. CONCURRENTLY so the write path is never
-- blocked; confirmed indisvalid and indisready after.

create unique index concurrently if not exists runs_user_filename_uniq
  on runcoach.runs (user_id, filename)
  where filename is not null;
