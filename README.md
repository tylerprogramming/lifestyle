# Lifestyle OS

Password-gated dashboard for the Lifestyle OS: movement grid, consistency ring, four pillar cards (Fitness, Content, Reading, Business), today strip and nudges. Next.js 16 (App Router, TypeScript) on Vercel. Every page load runs one live query against the `lifestyle` Supabase project; nothing is cached or baked in.

Logging still happens through the `/lifestyle` Claude Code skill. This app only reads.

## Layout

| Path | What it does |
|---|---|
| `proxy.ts` | Password gate. Redirects to `/login` unless the `ls_session` cookie is valid. |
| `app/login/` | Login form plus a server action that checks `DASHBOARD_PASSWORD` in constant time and sets a signed, httpOnly cookie that lasts 30 days. |
| `app/page.tsx` | Re-checks the session, runs the query, renders the dashboard. |
| `lib/query.ts` | The dashboard SQL, ported from `lifestyle-show/dashboard.sql`. "Today" is America/New_York. |
| `lib/render.ts` | HTML renderer, ported from `lifestyle-show/dashboard.py`. Targets are at the top of the file. |
| `lib/session.ts` | HMAC-SHA256 session cookie (Web Crypto). |
| `lib/data.ts` | `postgres` client, set up for Supabase's transaction pooler (`prepare: false`). |
| `sql/readonly-role.sql` | Creates the `dashboard_ro` Postgres role Vercel connects as. |

## Environment variables

| Name | Value |
|---|---|
| `DATABASE_URL` | Pooler connection string for `dashboard_ro` (port 6543). |
| `DASHBOARD_PASSWORD` | The password you type on `/login`. |
| `AUTH_SECRET` | Random string of 32+ characters used to sign the cookie. Generate it with `openssl rand -hex 32`. If you rotate it, every existing session is logged out. |

## Local dev

```bash
cp .env.example .env.local   # fill in the three values
npm install
npm run dev                  # http://localhost:3000
npm run lint && npm run typecheck && npm run build
```

## Deploy

1. Run `sql/readonly-role.sql` in the Supabase SQL editor, using your own password.
2. `vercel link`, then for each of the three variables: `vercel env add <NAME> production` (and `preview` if you use it).
3. Push to `main`. Vercel builds and deploys on every push.

## Scripts

Both need your Supabase project ref and transaction-pooler host (Project Settings -> Database -> Connection string). Pass them as `SUPABASE_PROJECT_REF` and `SUPABASE_POOLER_HOST`, or leave them unset once `.env.local` has a `DATABASE_URL` and they are read from it. Nothing project-specific is committed.

| Script | What it does |
|---|---|
| `scripts/set-db-url.sh` | Prompts (hidden) for the `dashboard_ro` password, writes `DATABASE_URL` to `.env.local`, tests the connection. |
| `scripts/rotate-db-password.py` | Generates a new `dashboard_ro` password locally, writes `DATABASE_URL`, and prints only a SCRAM verifier as `alter role ... password '...'` to run in Supabase. |

## Versions

Next 16.4, React 19.3, Node 24.x (Vercel default), ESLint 10. TypeScript is held at 6.0 because `typescript-eslint` (pulled in by `eslint-config-next`) does not support TS 7 yet.
