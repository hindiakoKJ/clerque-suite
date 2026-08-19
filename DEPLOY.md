# DEPLOY.md — Clerque go-live runbook (deploy the day BEFORE the Friday go-live)

Plain-language, step-by-step. Follow top to bottom. Do not skip the
pre-flight — once the operator is on-site in Mindanao nothing can be
fixed after the fact.

Stack recap
- **API** — NestJS on **Railway** (Postgres also on Railway). Public URL
  `https://api.clerque.cc` (Railway custom domain; verified live
  2026-08-19 — `api.hnscorpph.com` is DEAD, do not use it) — health at
  `GET /api/v1/health`.
- **Web** — Next.js on **Vercel**: ONE project serving two hostnames,
  `clerque.cc` (tenant app / POS) and `console.clerque.cc` (HNS Console —
  `apps/web/middleware.ts` switches on the `console.` host prefix).
- **DB migrations** — run AUTOMATICALLY at API boot by `start.sh`
  (see §2). There is no separate "migrate" deploy step to click.

---

## 0. Before you start (10 min)

1. Make sure the three new migration folders are **committed** (they are
   currently untracked in git — Railway only deploys what is pushed):
   ```
   packages/db/prisma/migrations/20260723000000_platform_channel_attribution/
   packages/db/prisma/migrations/20260724000000_courts_vertical/
   packages/db/prisma/migrations/20260817000000_ledger_mode_locale/
   ```
   `git status --short packages/db/prisma/migrations` must print nothing.
2. `packages/db/prisma/schema.prisma` is also modified — commit it with
   the migrations in the SAME commit. Never push code that reads
   `Tenant.ledgerMode / country / currency / timezone` without the
   `20260817000000_ledger_mode_locale` migration beside it.
3. Have the Railway and Vercel dashboards open in two tabs, logged in.

---

## 1. Pre-flight — run locally, everything must be green (≈10–15 min)

From the repo root `E:/AI Projects/app-suite`:

```powershell
# shared types first (API + web import them)
cd packages/shared-types; npm run build; cd ../..

# API: types, full unit suite, production build
cd apps/api
npx tsc --noEmit -p tsconfig.json
npx jest --silent
npm run build
cd ../..

# Web: production build (this is what Vercel runs)
cd apps/web
npm run build
cd ../..
```

STOP if any of these fail. Do not deploy on a red pre-flight.

Expected: `tsc` prints nothing; jest ends with `Tests: … passed` and
`0 failed`; `nest build` writes `apps/api/dist/main.js`; `next build`
prints the route table with no errors.

---

## 2. The ORDER: migrate → API → web

### 2a. Migrate + API (one push — Railway does both)

How the API starts in production today (source of truth: `railway.toml`
at repo root, read by Railway; `railway.json` is intentionally an empty
`$schema`-only stub — see the dashboard checklist in §3):

```
[build]  buildCommand = npm install --include=dev
                        && npm run build --workspace=packages/shared-types
                        && npx prisma generate --schema=packages/db/prisma/schema.prisma
                        && npm run build --workspace=apps/api
[deploy] startCommand  = sh start.sh
         healthcheckPath = /api/v1/health   (300 s timeout, restart on_failure ×3)
```

`start.sh` (repo root) does, in this order, on EVERY boot:
1. `prisma migrate deploy` — applies any new migration folders
   (additive only; the ledger-mode migration adds 4 defaulted columns +
   1 enum — no backfill, no downtime).
2. If step 1 errors on a DB that was originally `db push`ed, it marks the
   historical migrations as applied and retries (self-healing).
3. `prisma db push` (WITHOUT `--accept-data-loss`) as an additive
   catch-up — it fails loudly and aborts the boot if a destructive change
   is pending, so a bad schema can never half-apply.
4. `exec node apps/api/dist/main` — only now does the API start.

Railway's healthcheck (`/api/v1/health`, which does `SELECT 1`) holds
traffic on the OLD instance until the new one answers 200, so the
migration has finished before any request reaches new code.

Steps:
1. `git push` the commit from §0 to the branch Railway deploys from.
2. Railway → API service → **Deployments** → watch the build log. You
   must see, in order:
   ```
   [Clerque] ── Running database migrations ────
   Applying migration `20260723000000_platform_channel_attribution`   (first time only —
   Applying migration `20260724000000_courts_vertical`                  all three, in
   Applying migration `20260817000000_ledger_mode_locale`               this order)
   [Clerque] Migrations up to date ...
   [Clerque] ── Catch-up schema sync ...
   [Clerque] ── Starting API server ────
   ```
   then the deploy flips to **Active** once the healthcheck passes.
3. Confirm in a browser: `https://api.clerque.cc/api/v1/health` →
   `{"status":"ok","db":"ok",...}`.

Manual equivalent (only if Railway's automatic step ever fails and you
need to run the migration by hand from your laptop — needs a prod
`DATABASE_URL` + `DIRECT_URL` in your shell, use Railway → Postgres →
Connect for the values):
```powershell
# from repo root
npm run db:migrate:deploy            # == prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```
Fallback start command (migrate, then boot, no db-push catch-up) if you
ever need to replace `sh start.sh` in the dashboard:
`cd apps/api && npm run start:migrate`
(`start:migrate` = `prisma migrate deploy --schema=../../packages/db/prisma/schema.prisma && node dist/main`).

### 2b. Web (after the API is Active and `/health` is ok)

1. Vercel deploys the same push automatically (one project, both
   hostnames). Wait for the deployment to show **Ready**, then load
   `https://clerque.cc/login` AND `https://console.clerque.cc/login`.
2. If Vercel is not auto-deploying, Vercel → project → Deployments →
   **Redeploy** latest.

Why this order: new web code calls new API routes (ledger mode, locale).
Old API + new web = 404s on the POS; new API + old web is harmless.

---

## 3. Dashboard settings to CONFIRM (do not assume — look)

### Railway → API service → Settings
- [ ] **Root Directory** — must be the **repo root** (blank or `/`).
      `railway.toml`, `start.sh`, and every path inside them
      (`packages/db/...`, `apps/api/dist/main`) are root-relative. If it
      says `apps/api`, the config file and start script are not found.
- [ ] **Config-as-code file** — default (it picks up `/railway.toml`).
      If a custom path is set, it must be `/railway.toml`. `railway.json`
      at root is a deliberate schema-only stub — leave it; do NOT add a
      `deploy` block to it (two config files with different `deploy`
      sections is exactly what broke deploys in April — commit d64159c).
- [ ] **Start Command** — should be empty in the UI (the toml's
      `sh start.sh` wins). If the UI has its own value it must also be
      `sh start.sh`.
- [ ] **Healthcheck path** — `/api/v1/health` (from toml).
- [ ] **Variables** (Railway → API → Variables). REQUIRED — the API
      refuses to boot without them (Joi validation in
      `apps/api/src/common/config/env.validation.ts`):
      `DATABASE_URL`, `DIRECT_URL`, `JWT_ACCESS_SECRET` (≥32 chars),
      `JWT_REFRESH_SECRET` (≥32 chars).
      MUST ALSO BE SET (they have dev defaults, so a missing value boots
      but misbehaves): `NODE_ENV=production` (gates Swagger off, demo
      seed off, localhost CORS off), `APP_URL=https://clerque.cc` (email
      links), `ALLOWED_ORIGINS=https://clerque.cc,https://console.clerque.cc`
      (main.ts also hard-codes the clerque.cc family, so this is belt and
      braces).
      Recommended: `RESEND_API_KEY`, `MAIL_FROM`, `SENTRY_DSN`,
      R2/S3 upload vars (see INFRA_SETUP.md — Railway disk is wiped on
      every deploy, so logo/product images must be on R2 before go-live).
- [ ] **Postgres backups** — Railway → Postgres → Backups: enabled.

### Vercel → the web project (serves both `clerque.cc` and `console.clerque.cc`) → Settings → Environment Variables
(If you ever split Console into its own Vercel project, set the same
variables there too.)
- [ ] `NEXT_PUBLIC_API_URL=https://api.clerque.cc/api/v1`
      (no trailing slash; must match what the browser can reach).
- [ ] `NEXT_PUBLIC_PROVIDER_PHASE=1` — set it EXPLICITLY, Production
      scope. The code defaults to `1` when unset,
      but set it so nobody flips it by accident. Phase 1 = every receipt
      prints **ACKNOWLEDGEMENT RECEIPT** (we do not yet hold BIR
      CAS/PTU; printing "OFFICIAL RECEIPT"/"SALES INVOICE" without it is
      a violation). Phase 2 is for later, after accreditation.
- [ ] `NEXT_PUBLIC_APP_URL=https://clerque.cc`.
- [ ] Env var changes need a **Redeploy** to take effect (NEXT_PUBLIC_*
      is baked in at build time).

### HNS Console (https://console.clerque.cc) — BEFORE creating the client tenant
- [ ] Sign in as the platform admin.
- [ ] **Settings → Company tab**: fill HNS Corp PH master data —
      Company name, **TIN** (format `010-986-552-000`), address,
      VAT/BIR status. Save.
- [ ] **Settings → Billing tab → "Provision HNS Corp PH tenant"**
      (button lives on the BILLING tab, not Company; it calls
      `POST /admin/platform/bootstrap-hns-corp`). Idempotent — safe to
      re-run; once provisioned the same button reads "Re-sync from
      PlatformConfig". It creates the HNS tenant once and syncs
      PlatformConfig into it. Subscription billing/receipts for the client depend on
      this, so do it FIRST, then bootstrap the coffee shop.

---

## 4. Rollback (if anything is wrong after deploy)

Code rollback — both hosts:
```powershell
git revert <bad-commit-sha>      # creates a new commit; do NOT force-push
git push
```
Railway and Vercel redeploy the revert automatically. Alternatively,
Railway → Deployments → previous deploy → **Redeploy**, and Vercel →
Deployments → previous → **Promote to Production** (instant, no build).

Database: **no down-migration is needed.** Every migration in this
release is additive (new enum + new columns with defaults). Old code
simply ignores the new columns, so reverting the code while leaving the
schema in place is safe. Do NOT run `prisma migrate reset` or
`db push --accept-data-loss` against production, ever.

---

## 5. Post-deploy smoke checklist (do this yourself, before the client does)

Use a real browser on the production URLs, not localhost.

- [ ] `https://api.clerque.cc/api/v1/health` → `"status":"ok","db":"ok"`.
- [ ] **Console login** at `https://console.clerque.cc` works.
- [ ] **Create the client tenant** (coffee shop) — Console → Tenants →
      **New Tenant** → "Create Tenant". Business name, address, TIN, tax
      status exactly as on their BIR registration.
- [ ] **Owner login** at `https://clerque.cc` with the new tenant's owner
      account. Open `/settings` — the **Ledger mode** card renders and
      shows "Full accounting" (this page reads the new
      `ledgerMode/country/currency/timezone` columns; if it 500s the
      migration did not apply → check the Railway deploy log, §2a).
- [ ] **Import products** — Settings → Imports (`/settings/imports`):
      download the Excel template from that page (the `onboarding/`
      folder only holds the client PDF pack, not templates), map the
      old-POS export onto it, upload. Delete any `SAMPLE - ` example rows
      first (the importer skips them anyway). Spot-check 3 products:
      name, price, category, stock.
- [ ] **Open a shift**, **ring one real-looking sale** (2 items, cash,
      with change) at `/pos/terminal`.
- [ ] **Receipt** — open the receipt modal / print preview and confirm the
      title reads **ACKNOWLEDGEMENT RECEIPT** (not "OFFICIAL RECEIPT",
      not "SALES INVOICE"). If it does not, Vercel's
      `NEXT_PUBLIC_PROVIDER_PHASE` is wrong — fix and redeploy before
      handing over.
- [ ] **Void** that test sale so the client's books start clean; confirm
      it now shows greyed-out with a red **VOIDED** label in `/pos/orders`
      (voided orders stay listed — that IS the audit trail) and stock is
      restored. Do NOT use Console → tenant → "Reset demo data" on the
      client tenant (it INJECTS scenario demo data into their books), and
      do NOT use "Clear all tenant data" after the import (it wipes
      products, categories, ingredients AND orders/journal). If you want
      zero trace of the test sale instead of a VOIDED row, do the
      shift/sale/void smoke test BEFORE the product import, then
      "Clear all tenant data", then import.
- [ ] **Close Shift** (POS menu → "Close Shift") — cash count, report
      generates, no error.
- [ ] Console → tenant → the closed shift and the voided order are both
      visible in the audit trail.
- [ ] Logout / login again on the POS — session refresh works
      (JWT_REFRESH_SECRET is correct).

If every box is ticked, hand over. If not, §4.
