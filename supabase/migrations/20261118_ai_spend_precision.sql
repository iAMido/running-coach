-- numeric(10,4) rounded a $0.000036 Haiku call to $0.0000, so small calls were
-- counted at no cost (found by the live check right after 20261118_ai_spend).
-- 20261118_ai_spend.sql now creates the column unrounded; this brings an
-- already-created table in line.
alter table runcoach.ai_spend_daily alter column usd type numeric;
