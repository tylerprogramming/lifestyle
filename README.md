# Lifestyle OS

Password-gated dashboard for the Lifestyle OS. Next.js 16 (App Router, TypeScript) on Vercel. Every page load runs one live query against the `lifestyle` Supabase project; nothing is cached or baked in.

Logging still happens through the `/lifestyle` Claude Code skill. This app only reads.

## Layout

| Path | What it does |
|---|---|
| `proxy.ts` | Password gate. Redirects to `/login` unless the `ls_session` cookie is valid. |
| `app/login/` | Login form plus a server action that checks `DASHBOARD_PASSWORD` in constant time and sets a signed, httpOnly cookie that lasts 30 days. |
| `app/page.tsx` | Today: rings, goals, plan, running, year of days. |
| `app/shell-page.tsx` | Wraps every page in the sidebar shell (auth check + live query via `lib/page-data.ts`). |
| `app/running/page.tsx` | The Running page: every run, charts, bests and the filterable log. |
| `app/goals/page.tsx`, `app/work/page.tsx` | Weekly goals in full; content, business, reading and weight. |
| `app/dashboard-behavior.tsx` | Client component that wires up the server-rendered HTML (day dialog, filters, deep links). |
| `app/api/goals/route.ts` | This week's goals as JSON for the Monday Slack card (Bearer `GOALS_TOKEN`). |
| `lib/query.ts` | The dashboard SQL. "Today" is America/New_York. Returns every run as `run_log` and per-day detail (food, lifts, plan, meals, water, weight, check-in) as `day_log`, a year back to a week ahead. |
| `lib/render.ts` | Today and Work page HTML. |
| `lib/shell.ts` | Sidebar shell and the color scheme list. |
| `lib/day-view.ts` | The day dialog: everything logged or planned on one date. |
| `lib/fitness.ts` | Run analysis (bests, weekly miles, comeback, cadence vs pace, 30-day form) and the Running page. |
| `lib/goals.ts`, `lib/goals-view.ts` | Weekly goals, computed from data logged before each Monday. |
| `lib/targets.ts` | Daily targets (calories, protein, water, weight) and the run-burn rate. Change them here. |
| `lib/behavior.ts` | DOM behavior: `[data-day]` opens that day, arrows step days, log filters, `#day=` and `?d=` deep links. |
| `lib/util.ts` | Shared date and number formatting. |
| `lib/session.ts` | HMAC-SHA256 session cookie (Web Crypto). |
| `lib/data.ts` | `postgres` client, set up for Supabase's transaction pooler (`prepare: false`). |
| `sql/readonly-role.sql` | Creates the `dashboard_ro` Postgres role Vercel connects as. |

## Environment variables

| Name | Value |
|---|---|
| `DATABASE_URL` | Pooler connection string for `dashboard_ro` (port 6543). |
| `DASHBOARD_PASSWORD` | The password you type on `/login`. |
| `AUTH_SECRET` | Random string of 32+ characters used to sign the cookie. Generate it with `openssl rand -hex 32`. If you rotate it, every existing session is logged out. |
| `GOALS_TOKEN` | Optional. Bearer token for `/api/goals`; the route returns 401 when it is unset. |

## Dashboard

A sidebar (Today, Food & plan, Running, Goals, Work & body) with your streak and a color scheme picker at the bottom: Dusk (default), Midnight, Paper or Ember, saved per browser. Each metric keeps one color everywhere: calories, protein, water, running, and so on.

**Today** has three rings (calories, protein, water; the calorie target rises by the net burn of today's run, 0.63 cal per lb per mile) with this week's goals beside them, then today's plan and meals next to running, then a GitHub-style year of days. Click any day, a recent run, or "Open today" to see just that day. `/running` has every run, charts and bests; `/goals` has each goal with its reasoning and last week's scorecard; `/work` has content, business, reading and weight.

The day dialog shows that date only: the run with its splits and how it compares to your best and previous run at that distance, lifts, the training plan, food against the day's target, the meal plan, what was logged, water, weight and check-in. Left/right arrows (or the buttons) step a day. `/#day=YYYY-MM-DD` opens a day directly; `/running?d=YYYY-MM-DD` highlights that day's run in the log.

## Local dev

```bash
cp .env.example .env.local   # fill in the three values
npm install
npm run dev                  # http://localhost:3000
npm run lint && npm run typecheck && npm run build
```

## Deploy

1. Run `sql/readonly-role.sql` in the Supabase SQL editor, using your own password.
2. `vercel link`, then for each of the variables: `vercel env add <NAME> production` (and `preview` if you use it).
3. Push to `main`. Vercel builds and deploys on every push.

## Scripts

Both need your Supabase project ref and transaction-pooler host (Project Settings -> Database -> Connection string). Pass them as `SUPABASE_PROJECT_REF` and `SUPABASE_POOLER_HOST`, or leave them unset once `.env.local` has a `DATABASE_URL` and they are read from it. Nothing project-specific is committed.

| Script | What it does |
|---|---|
| `scripts/set-db-url.sh` | Prompts (hidden) for the `dashboard_ro` password, writes `DATABASE_URL` to `.env.local`, tests the connection. |
| `scripts/rotate-db-password.py` | Generates a new `dashboard_ro` password locally, writes `DATABASE_URL`, and prints only a SCRAM verifier as `alter role ... password '...'` to run in Supabase. |

## Versions

Next 16.4, React 19.3, Node 24.x (Vercel default), ESLint 10. TypeScript is held at 6.0 because `typescript-eslint` (pulled in by `eslint-config-next`) does not support TS 7 yet.
