# Aurora FinSight

A personal finance web app: track income and expenses, set budgets, work towards savings goals, see where your money goes, and get explainable suggestions for saving more. Every figure is computed on the server from the signed-in user's own records — nothing is hard-coded or simulated.

**Stack:** React 19 + Vite (client) · Node.js + Express 5 (API) · SQLite for development · PostgreSQL for production · zod validation · cookie sessions · scrypt password hashing.

- [Features](#features) · [Quick start](#quick-start-development) · [Environment](#environment) · [Scripts](#scripts) · [Tests](#tests)
- [Verification status](#verification-status-read-this) · [API reference](#api-reference) · [Deployment](#production-deployment) · [Backups](#backups-and-persistence)
- [Security](#security-notes) · [Troubleshooting](#troubleshooting) · [Deviations & limitations](#deviations-from-the-brief-and-known-limitations)

---

## Features

| Area | What it does |
|---|---|
| **Accounts** | Register, sign in, sign out. scrypt-hashed passwords; HttpOnly SameSite=Lax session cookie; only a SHA-256 of the session token is stored. Genuine multi-user: every query is scoped to the signed-in user, and other users' record ids return 404. Expired sessions send you back to sign-in. |
| **Dashboard** | Total balance (**opening balance + income − expenses**), monthly income and expenses with change vs last month, savings rate, budget summary and warnings, goal progress and **next milestones**, yearly income/expense chart, spending by category, recent transactions, and a **Refresh** button that reloads from the server. Clear empty states when there is no data. |
| **Transactions** | Add / edit / delete (with confirmation). Fields: type, amount, category, description, date, **payment method**, note. Search by text; filter by type, category, **payment method**, date range, month, year, **amount range**; sort and paginate. Any past day works; **future dates are rejected by the server** using the user's own time zone. Records are permanent — nothing is archived by the calendar. |
| **Analytics** | Category breakdown with change vs previous month, daily spending chart, average daily spend, projected month total, weekday vs weekend averages, busiest day, largest expense, yearly trends and year-by-year totals, and a **category filter**. |
| **Budgets** | Overall and per-category monthly budgets (carried forward until changed). Spent, remaining, % used, **days remaining**, status (on track / nearing limit at 80% / limit reached / over budget) and a **suggested daily allowance** (shows "no spending room left" instead of a negative figure when exceeded). Browse any month. Alerts when an expense pushes a budget up a level. |
| **Savings goals** | Any number of goals with target, optional date, **category and description**, starting balance. **Add savings, withdraw/correct**, history, progress ring, milestones (25/50/75%), "save X/day" and pace projection, auto-complete, **archive and restore**, edit, delete. Over-filling or over-withdrawing is impossible (API checks *and* database triggers). |
| **SmartSave Predictor** | Transparent rules over your own spending: categories above your usual, 10% trims on flexible categories, small frequent purchases, recurring charges, weekend spikes, low savings rate, goal-impact days. Each suggestion shows the **transactions behind it**, the numbers, and the formula. A **user-defined monthly target** for flexible spending is tracked with projection and progress toward the reduction. Too little data (<10 expenses or <14 days) → it says so instead of guessing. No external AI service is used. |
| **Settings** | Dark / light / system theme (saved per user, applied across devices), display currency (INR, USD, EUR, GBP), notification preferences (budget alerts, goal progress/milestones, SmartSave), profile name, time zone, **opening balance**, category management, password change (signs out other devices), JSON export, account deletion. |
| **UI** | Responsive layout, sidebar with a working mobile hamburger drawer, SVG charts with tooltips, loading skeletons, empty/error states, toasts, keyboard-accessible dialogs, visible focus styles. |

> The brief spells it "SmartSave Predator"; the feature is named **SmartSave Predictor** in the app.

---

## Quick start (development)

Requirements: **Node.js ≥ 22.13** (the dev database uses Node's built-in `node:sqlite`).

```bash
npm install                # installs server + client workspaces
cp .env.example .env       # optional: the defaults work out of the box

npm run dev:server         # API on http://localhost:4000 (creates ./server/data/aurora.db and runs migrations)
npm run dev:client         # Vite on http://localhost:5173, proxies /api to :4000
npm run seed               # OPTIONAL: demo@aurora.test / Demo-Pass-123 with ~6 months of sample data
```

Open <http://localhost:5173>. The Vite proxy keeps the browser same-origin, so the session cookie behaves exactly as in production. The seed script is development-only: it refuses to run with `NODE_ENV=production` and only creates one clearly-labelled demo account (`npm run seed -- --reset` recreates it). Normal accounts never receive sample data.

## Environment

All configuration is via environment variables — see [`.env.example`](.env.example).

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite:./data/aurora.db` | `sqlite:<path>` or `postgres://user:pass@host:5432/db` |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | |
| `NODE_ENV` | `development` | `production` turns on `Secure` cookies, HSTS and quieter errors |
| `COOKIE_SECURE` | `true` in production | set `false` only for plain-HTTP local testing |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy / load balancer |
| `SESSION_TTL_DAYS` | `14` | sliding expiry |
| `ALLOWED_ORIGINS` | *(empty)* | extra origins accepted by the CSRF origin check (see [CORS](#cors-and-hosting-the-client-separately)) |
| `REGISTRATION_OPEN` | `true` | `false` closes sign-up |
| `SCRYPT_N` | `65536` | password-hash cost; leave at the default |

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | Server (29) and client (7) automated tests |
| `npm run build` | Production client build into `client/dist` (Vite) |
| `npm start` | Start the API; it also serves `client/dist` when present |
| `npm run migrate` | Apply database migrations without starting the server (they also run on boot) |
| `npm run seed` | Optional development demo data (never in production) |
| `npm run test:e2e` | Browser end-to-end suite (needs a running server and Playwright) |
| `scripts/verify.sh` | Tests + production build in one go |

Migrations live in `server/src/db/migrations/{sqlite,postgres}` (`001_init`, `002_extended_features`) and are tracked in `schema_migrations`.

## Tests

* **Server** (`server/test`, `node --test`, 29 tests): registration/login/logout, invalid credentials and duplicates, session persistence/expiry/invalidation, rate limiting, CSRF, security headers; financial rules; transactions (validation, no future dates in the user's time zone, search/filter/paging incl. amount range and payment method, LIKE-escaping, injection attempts); categories; budgets (carry-forward, alerts, daily allowance, month changes); goals (lifecycle, deposits, withdrawals, archive/restore, milestones, overfill protection down to the database triggers); opening balance; analytics (incl. category filter) and empty-data states; SmartSave rules, evidence records and the user target; preference persistence; **persistence across a server restart**; and **multi-user isolation** — user B gets 404 on every one of user A's transactions, categories, budgets, goals, contributions and withdrawals, sees empty dashboards/analytics/SmartSave, cannot use A's categories, and all private endpoints reject anonymous calls.
* **Client** (`client/tests`, 7 tests): exact money parsing (text → integer minor units, no floating point), formatting, date maths, chart helpers.
* **End-to-end** (`e2e/e2e.mjs`, Playwright + Chromium, 23 steps) against the *built* app and a real server/database: registration and validation, dashboard figures, refresh, future-date rejection, search and all filters, edit/delete, budgets and alerts, goals (add, withdraw, history, complete, archive, restore), analytics incl. category filter, SmartSave target, theme/currency/notification persistence across reload, opening balance, category rules, password change, data export, mobile hamburger menu with no horizontal overflow on any page, two-user isolation, re-login persistence, session expiry.

## Verification status (read this)

This project was built in a sandbox whose npm registry was blocked, so some pieces could not be exercised exactly as you will run them:

| Verified here | Not verified here — please run once on your machine |
|---|---|
| 29 server + 7 client tests pass; 23-step Chromium E2E passes against the built bundle and a real SQLite file | `npm install` (no lockfile was generated — it will create `package-lock.json`; commit it) |
| PostgreSQL migrations 001 + 002 apply cleanly on PostgreSQL 16 and their constraints/triggers behave (`server/test/pg-migration-check.sh`) | The **real `express` 5 package**: the API was run against a small Express-5-compatible stand-in written for testing. Only standard Express APIs are used, but run `npm test` after installing to confirm |
| Production-mode boot: security headers, CSRF rejection, SPA fallback, API 404s | **`vite build`**: the same sources were bundled with esbuild (`client/scripts/build-esbuild.mjs`, same `dist/` layout). Run `npm run build` to use Vite |
| | The **`pg` adapter** (`server/src/db/postgres.js`): placeholder rewriting and numeric type parsing have not run against a live PostgreSQL. After installing, run `DATABASE_URL=postgres://… npm test` against a throwaway database before relying on it |

## API reference

All endpoints are under `/api`, return JSON, and (except `health` and `auth/register|login`) require the session cookie. State-changing requests must send `X-Requested-With: aurora-finsight`. Errors look like `{ "error": { "code", "message", "fields?" } }`. Money is always integer **minor units** (paise/cents); dates are `YYYY-MM-DD`.

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness check |
| `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | Accounts and session |
| `GET /profile` · `PATCH /profile` | Name, currency, theme, time zone, opening balance, notification prefs |
| `POST /profile/password` · `DELETE /profile` · `GET /profile/export` | Change password, delete account, JSON export |
| `GET/POST /categories` · `PATCH/DELETE /categories/:id` | Categories (in-use ones cannot be deleted → 409) |
| `GET /transactions` | Query: `q type categoryId paymentMethod from to year month minAmount maxAmount sort limit offset`; returns `items`, `total`, `totals` |
| `POST /transactions` · `GET/PATCH/DELETE /transactions/:id` | CRUD; create returns budget `alerts` |
| `GET /budgets?month=` · `PUT /budgets` · `DELETE /budgets/:id` | Budget overview, set/update (overall or per category), remove |
| `GET/POST /goals` · `GET/PATCH/DELETE /goals/:id` | Goals; `PATCH {archived:true|false}` archives/restores |
| `GET /goals/:id/contributions` · `POST /goals/:id/contributions` · `POST /goals/:id/withdrawals` · `DELETE /goals/:id/contributions/:cid` | Savings history, add, withdraw, remove an entry |
| `GET /dashboard?month=` | Balance, totals, comparison, budget and goal summaries, recent transactions, year trend |
| `GET /analytics?month=&categoryId=` · `GET /analytics/trends?year=` | Month analytics (optionally one category); yearly trends |
| `GET /smartsave` · `PUT /smartsave/target` | Suggestions with evidence and the user's flexible-spending target (`{targetMinor: number|null}`) |

## Production deployment

The API serves the built client, so one process is enough.

### Option A — Docker (app + PostgreSQL)

```bash
export POSTGRES_PASSWORD='choose-a-long-random-password'
docker compose up --build
```

Put TLS in front (Caddy, nginx, or your platform's load balancer). Keep `COOKIE_SECURE=true` and `TRUST_PROXY=true` (already set in `docker-compose.yml`).

### Option B — any Node host (Render, Railway, Fly.io, a VM…)

1. Provision **managed PostgreSQL** and note its connection string.
2. Build: `npm install && npm run build`
3. Start: `npm start` with `NODE_ENV=production`, `DATABASE_URL=postgres://…`, `TRUST_PROXY=true`.
4. Health check path: `/api/health`. Serve only over HTTPS.

Migrations run on boot; the first start against an empty database creates the schema.

### Which database to use where

| Hosting | Use | Why |
|---|---|---|
| Local development | SQLite file | zero setup |
| A VM or container **with a persistent volume** | SQLite *or* PostgreSQL | the SQLite file must live on that volume |
| Serverless / ephemeral platforms (Vercel, Netlify functions, Render/Heroku free dynos without a disk, most container platforms by default) | **PostgreSQL only** | the local filesystem is wiped on redeploy or restart, so a SQLite file would silently lose every user's data, and several instances cannot share one file |

For any real multi-user online deployment use PostgreSQL.

### CORS and hosting the client separately

The default setup is **same-origin**: the API serves the client, so no CORS is needed and the SameSite=Lax cookie works. `ALLOWED_ORIGINS` only widens the CSRF origin check; the server sends no CORS headers. Hosting the client on a different domain (e.g. Vercel + a separate API) would additionally need CORS headers with credentials and `SameSite=None; Secure` cookies — not implemented. Prefer a reverse proxy that serves both under one domain.

## Backups and persistence

* **PostgreSQL:** use your provider's automated backups/point-in-time recovery, plus a periodic logical dump, e.g. `pg_dump --format=custom "$DATABASE_URL" > aurora-$(date +%F).dump`; restore with `pg_restore --clean --no-owner -d "$DATABASE_URL" aurora-….dump`. Test a restore occasionally.
* **SQLite (dev / single VM):** copy the file safely with `sqlite3 server/data/aurora.db ".backup 'backup.db'"` (or stop the server and copy `aurora.db`, `-wal` and `-shm` together). Keep it on a persistent volume.
* Per-user JSON export is available in **Settings → Your data** (`GET /api/profile/export`).
* Records are never deleted by the app except when a user deletes them (or their account).

### Moving from SQLite to PostgreSQL

The SQL is portable (`?` placeholders, ISO text dates, integer minor units, text ids) and each migration has a PostgreSQL twin. There is no automatic data copy; write a one-off script if you have data to carry over.

## Security notes

* Passwords: scrypt, per-user salt, constant-time compare, 8–128 chars with a letter and a number, common-password blacklist; unknown-email logins take the same time as wrong-password ones.
* Sessions: random 32-byte token in an HttpOnly cookie; the DB stores only its SHA-256; revoked on logout and (other devices) on password change.
* CSRF: every state-changing call needs the `X-Requested-With: aurora-finsight` header plus an Origin check.
* Authorisation: every row carries `user_id`; every query filters on it; foreign keys are composite `(id, user_id)` so a row cannot reference another user's category or goal. Other users' ids return 404.
* Input: zod `.strict()` schemas on every endpoint (unknown fields rejected), 100 kB body limit, parameterised SQL only.
* Headers: CSP (`script-src 'self'`), `X-Frame-Options: DENY`, `nosniff`, HSTS in production, `Cache-Control: no-store` on the API. Rate limiting on login, registration and the API.
* Secrets live in environment variables; `.env.example` contains placeholders only; no secret is shipped to the browser.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node:sqlite` not found / `ExperimentalWarning` | Use Node ≥ 22.13. The warning is harmless. |
| Blank page or `Cannot GET /` in production | Run `npm run build` first; the server serves `client/dist` only if it exists (override with `CLIENT_DIR`). |
| Login works but you are signed out on the next request | Plain-HTTP production test with `Secure` cookies: set `COOKIE_SECURE=false` locally, or use HTTPS. Behind a proxy also set `TRUST_PROXY=true`. |
| `403` on every POST/PUT/PATCH/DELETE | The `X-Requested-With: aurora-finsight` header is missing (custom API clients) or the request came from an origin not listed in `ALLOWED_ORIGINS`. |
| `429 Too many attempts` | Login/registration rate limit; wait for the window to pass. |
| "Transactions cannot be dated in the future" for today's date | Your profile time zone is behind your real one — set it in **Settings → Profile**. |
| Data disappeared after redeploy | You are on SQLite on an ephemeral filesystem. Use PostgreSQL or a persistent volume. |
| Port in use | Change `PORT` (and `API_URL` for the Vite proxy). |
| E2E can't launch a browser | Install Playwright's Chromium (`npx playwright install chromium`) and point `BASE_URL` at a running server. |

## Project layout

```
client/   React + Vite app (src/pages, src/components, src/lib, src/context) + tests
server/   Express API (src/routes, src/services, src/middleware, src/db, src/lib), scripts/seed.js, tests
e2e/      Playwright browser suite
scripts/  verify.sh
```

## Deviations from the brief and known limitations

Deliberate deviations (packages could not be installed in the build sandbox, so small purpose-built equivalents were written):

* **JavaScript, not TypeScript.**
* **scrypt** (Node's built-in, memory-hard KDF) instead of Argon2id/bcrypt.
* A small **history-API router** instead of React Router; **custom SVG charts** instead of Recharts; **inline SVG icons** instead of Lucide; hand-written security headers and rate limiting instead of helmet / express-rate-limit.
* Folders are `client/` and `server/` rather than `frontend/` and `backend/`; backend tests are in `server/test`, migrations in `server/src/db/migrations`.

Limitations:

* **Currency is display-only.** Changing it re-labels amounts; it does not convert them (no exchange-rate service).
* **No email features** — no email verification and no "forgot password" (there is no mail service). Passwords can be changed while signed in.
* Rate limiters are in memory (per process); use a shared store or edge limiting for several instances.
* Analytics filtering is by month and category (the trends view is by year); there is no free date-range analytics filter. Transaction history search has full date-range filtering.
* Recurring transactions, bank import/sync, multi-currency accounts and receipts are not implemented.
* SmartSave is rule-based by design (so it can explain itself); it is not a machine-learning model.
