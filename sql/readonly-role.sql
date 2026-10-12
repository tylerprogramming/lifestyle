-- Read-only role for the Vercel dashboard. Applied to the "lifestyle" project
-- on 2026-10-12 as migration `create_dashboard_ro_role`. Kept here as the record
-- and for rebuilding the role elsewhere.
--
-- The role is created WITHOUT a password, so it can't log in until the owner
-- sets one in the Supabase SQL editor:
--   alter role dashboard_ro password '<your password>';
--
-- Vercel then connects through the transaction pooler (port 6543):
--   postgres://dashboard_ro.<project-ref>:<password>@<pooler-host>:6543/postgres
-- Copy <pooler-host> from Project Settings -> Database -> Connection string.

create role dashboard_ro with login nosuperuser nocreatedb nocreaterole noinherit noreplication;

grant usage on schema public to dashboard_ro;

-- Only the tables DASHBOARD_SQL reads.
grant select on
  public.activity_log,
  public.cardio_log,
  public.strength_entries,
  public.reading_log,
  public.daily_checkin,
  public.weight_log,
  public.youtube_daily,
  public.business_weekly,
  public.water_log,
  public.caffeine_log
to dashboard_ro;

-- weight_log has RLS on with no policy; bypassrls lets the dashboard read it.
-- Safe because the role has SELECT-only grants on these 10 tables.
alter role dashboard_ro bypassrls;

-- Every session for this role is read-only and bounded.
alter role dashboard_ro set default_transaction_read_only = on;
alter role dashboard_ro set statement_timeout = '10s';
