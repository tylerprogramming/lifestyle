-- Read-only role for the Vercel dashboard. Run once in the Supabase SQL editor
-- for the "lifestyle" project. Replace the placeholder password in the editor
-- itself; never commit or paste the real one anywhere else.
--
-- Vercel then connects through the transaction pooler (port 6543):
--   postgres://dashboard_ro.<project-ref>:<password>@<pooler-host>:6543/postgres
-- Copy <project-ref> and <pooler-host> from Project Settings -> Database -> Connection string.

create role dashboard_ro with login password 'REPLACE_ME' nosuperuser nocreatedb nocreaterole noinherit;

grant usage on schema public to dashboard_ro;

-- Only the tables DASHBOARD_SQL reads.
grant select on
  activity_log,
  cardio_log,
  strength_entries,
  reading_log,
  daily_checkin,
  weight_log,
  youtube_daily,
  business_weekly,
  water_log,
  caffeine_log
to dashboard_ro;

-- RLS: if these tables have row level security enabled, the role needs either a
-- select policy or bypassrls. bypassrls is read-only here because the role has
-- no write grants.
alter role dashboard_ro bypassrls;

-- Belt and braces: every session for this role is read-only and bounded.
alter role dashboard_ro set default_transaction_read_only = on;
alter role dashboard_ro set statement_timeout = '10s';
