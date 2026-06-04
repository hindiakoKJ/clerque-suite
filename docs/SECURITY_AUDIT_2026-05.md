# Clerque Security Audit — May 2026

> Read-only static audit of the Clerque codebase. Seven parallel
> investigations across cybersecurity, multi-tenant isolation,
> infrastructure, backup/DR, ransomware prevention, internal audit /
> SOD, and testing coverage. **No code was modified.**
>
> Scope: `apps/api` (NestJS), `apps/web` (Next.js), `apps/counter`
> (Expo / RN Android), `packages/db` (Prisma), `packages/shared-types`,
> and infra config (Railway, Vercel, EAS).
>
> This document lists findings ordered by severity. The remediation
> column gives the one-line fix; the engineer assigned the work should
> open a ticket per row and read the surrounding context before
> patching.

---

## TL;DR — Top 10 ranked by risk (act on these in order)

| # | Severity | Area | Finding | One-line fix |
|---|---|---|---|---|
| 1 | **CRITICAL** | Tenant isolation | `orders.service.findOne()` is tenant-scoped but NOT branch-scoped — a Branch A cashier can read Branch B orders (PWD/SC IDs, customer TIN, payment amounts, pharmacist PRC). | Pass `effectiveBranchId(user)` into the where clause for every `:id` detail endpoint reachable by branch-scoped roles. |
| 2 | **CRITICAL** | Backups | 10-year BIR retention claim cannot be met by current infra. R2 lifecycle rolls off > 90 days; the "BIR immutable archive" code path does not exist. | Either build the BIR archive cron OR contractually transfer the obligation with quarterly forced-export receipts. |
| 3 | **CRITICAL** | Backups | No Railway-native DB backup. The single `@Cron('0 2 * * *')` is the entire backup strategy. If API is unhealthy at 2 AM, that night's snapshot is silently lost — only `logger.warn`. | Enable Railway native Postgres backups; add deadman-switch alert when uploaded < tenantCount. |
| 4 | **CRITICAL** | SOD / BIR | `JournalEntry.entryNumber` has NO unique constraint (only `@@index`). NumberingService races silently double-issue JE numbers. Direct break of BIR gapless-numbering requirement. | Add `@@unique([tenantId, entryNumber])` + backfill migration. |
| 5 | **CRITICAL** | Testing | CI never runs tests. The 31 spec files in `apps/api` are dead weight — could all be red and nobody would know. | Add `npm test` step to `.github/workflows/ci.yml`. |
| 6 | **HIGH** | Tenant isolation | Cross-tenant `branchId` injection on 13 AR/AP write paths (ar-invoices, ar-payments, ap-bills, …). A user from Tenant A can submit Tenant B's branchId → silent corruption of branch P&L and BIR sales books. | Shared `assertBranchInTenant` helper called before every `branchId: dto.branchId` write. |
| 7 | **HIGH** | Cybersecurity | Refresh-token verification uses the wrong secret. `jwt.verify(token)` in `extractRefreshSub` (auth.service.ts:944) silently uses the access-token secret. Rotating `JWT_REFRESH_SECRET` has no effect. | Pass `{ secret: process.env.JWT_REFRESH_SECRET }` to verify. |
| 8 | **HIGH** | Cybersecurity | No login throttling on `/auth/login`, `/auth/pin-login`, `/auth/forgot-password`. Per-user lockout only fires AFTER user is resolved — invalid emails unlimited, PIN spraying open from a single IP. | Add `@Throttle({ short: { ttl: 60_000, limit: 10 }})` per endpoint. |
| 9 | **HIGH** | Internal audit | AuditLog "INSERT-only" claim has NO DB enforcement (no trigger, no role grant, no RLS). Compromised DB role can rewrite history. `onDelete: Cascade` from Tenant compounds it. | `REVOKE UPDATE, DELETE ON audit_logs FROM <app_role>` + BEFORE-UPDATE/DELETE trigger. Same for `console_logs`, `login_logs`, `z_read_logs`. |
| 10 | **HIGH** | Infra | Production CORS allows `http://localhost:3000` unconditionally (main.ts:206-212). Attacker on victim's LAN can hit localhost with credentialed CORS. | Gate localhost origin behind `NODE_ENV !== 'production'`. |

---

## Cybersecurity

| # | Severity | Area | File:Line | Issue | Remediation |
|---|---|---|---|---|---|
| C1 | High | JWT verification | `apps/api/src/auth/auth.service.ts:944-951` | `extractRefreshSub` calls `this.jwt.verify(token)` with no secret override; JwtModule is registered with `JWT_ACCESS_SECRET`, yet refresh tokens are signed with `JWT_REFRESH_SECRET`. Verification silently falls back to access secret. Rotating `JWT_REFRESH_SECRET` has no effect. | Pass `{ secret: process.env.JWT_REFRESH_SECRET }` to `jwt.verify`. |
| C2 | High | Rate limiting | `apps/api/src/auth/auth.controller.ts:60-86`, `apps/api/src/app.module.ts:88-92` | No per-endpoint `@Throttle` on `/auth/login`, `/auth/pin-login`, `/auth/forgot-password`, `/auth/reset-password`. Global throttler is 600 req/min/IP. Per-user lockout fires only AFTER the user is resolved — invalid emails unlimited (enumeration timing). | Add `@Throttle({ short: { ttl: 60_000, limit: 10 }})` per endpoint. |
| C3 | High | DB credentials | `apps/api/.env:1-2`, `packages/db/.env` | `postgresql://postgres:hansnashshan123@localhost…` plaintext, dictionary-adjacent password lives on disk in workspace. Gitignored but easily leaked. | Rotate to >24-char random; verify Railway uses a separate secret; confirm `.env` never appears in container image or CI artifact. |
| C4 | Medium | Access token TTL | `apps/api/src/auth/auth.service.ts:23` | `ACCESS_EXPIRY = '8h'`. Stolen access token (XSS, cookie leak) is valid for 8h with NO server-side revocation check. Role/permission changes don't take effect until refresh. | Reduce to 15-30m; rely on refresh rotation for the shift-long UX. |
| C5 | Medium | Kiosk PIN plaintext | `apps/api/src/auth/auth.service.ts:498-505`, `schema.prisma:918` | `kioskPin` stored plaintext to support `(tenantId, kioskPin)` unique lookup. DB dump exposes every cashier PIN. 4-8 digit space + plaintext = total credential compromise. | Store bcrypt-hashed PIN + iterate-compare like supervisor PIN. |
| C6 | Medium | Audit log integrity | `schema.prisma:738-763`, `audit.service.ts` | "INSERT-only" by convention only — no DB trigger, no role grant, no hash chain. `onDelete: Cascade` from Tenant means deleting a Tenant wipes its audit log. | Add row-hash chain (`previousHash` + `rowHash`); `REVOKE UPDATE, DELETE`; consider `onDelete: Restrict`. |
| C7 | Medium | CORS allow-list | `apps/api/src/main.ts:206-212` | `ALLOWED_ORIGINS` split unfiltered; `credentials: true`. No validation against `*` or empty entries. Production also allows `localhost:3000` unconditionally. | Validate each origin against allow-pattern at boot; reject `*` when credentials enabled; gate localhost on `NODE_ENV !== 'production'`. |
| C8 | Medium | CSRF on cookie session | `apps/api/src/auth/auth.controller.ts:36-44` | `app-session` cookie set `SameSite=Lax`, `HttpOnly`. Mixed auth: Bearer for API, cookie for SSR. `Lax` permits top-level POSTs from attacker subdomains. | `SameSite=Strict`, OR enforce that mutating endpoints only honour Bearer. |
| C9 | Medium | 2FA backup codes | `apps/api/src/auth/auth.service.ts:822` | `twoFactorBackupCodes: []` cleared as plaintext array — likely stored plaintext. | Bcrypt-hash each code at generation; store only hashes. |
| C10 | Low | Session revocation | `apps/api/src/auth/strategies/jwt.strategy.ts:21-27` | Validates only `user.isActive`; does not check `UserSession.status='ACTIVE'`. Revoking sessions doesn't invalidate live access tokens (only stops refresh). | Embed session id in JWT; check session status on validate (DB hit per request — cache 30s). |
| C11 | Low | Refresh rotation | `apps/api/src/auth/auth.service.ts:688-728` | No reuse detection. If a revoked refresh token is presented, no alarm raised. | On bcrypt match against `REVOKED` session, revoke all sessions for that user + alert. |
| C12 | Low | bcrypt cost | `auth.service.ts:1113` | Supervisor PIN at cost 10 over 10K space — brute-forceable in seconds if hash leaks. | Raise to cost 12; or pepper with server secret. |
| C13 | Low | Counter token storage | `apps/counter/src/auth/AuthProvider.tsx:65-67` | JWT in SecureStore (good); user/tenant objects in AsyncStorage (unencrypted). Low-impact info leak on rooted Android. | Optional: move to SecureStore for consistency. |
| C14 | Info | Demo seed | `apps/api/src/main.ts:111-153` | `Admin1234!`, `Super1234!`, `Cashier1234!` hardcoded; seeds every boot including production if `runSeed` flag set. | Gate `runSeed` behind `NODE_ENV !== 'production'`. |

**Strengths**: Prisma everywhere (no raw SQL); `forbidNonWhitelisted` global ValidationPipe; helmet + HSTS; bcrypt rounds 12 for passwords; per-account lockout; reset tokens stored as SHA-256; supervisor PIN per-actor rate limit; typed-slug mass-session-revoke; Counter uses SecureStore.

---

## Multi-Tenant Isolation & Data Leaks

| # | Severity | File:Line | Issue | Attack vector | Remediation |
|---|---|---|---|---|---|
| T1 | **Critical** | `orders/orders.service.ts:1027-1055` | `findOne(tenantId, id)` tenant-scoped but not branch-scoped. Controller applies `effectiveBranchId` only on list, not detail. | CASHIER from Branch A gets `/orders/:id` for any Branch B order in same tenant → reads receipt, PWD/SC IDs, customer TIN/address, dispensed pharmacist PRC, payment amounts. | Pass `effectiveBranchId(user, undefined)` into findOne where clause. Audit every `:id` detail endpoint for the same pattern. |
| T2 | High | `ar/ar-invoices.service.ts:185`, `ar-payments:168`, `credit-memos:147`, `customer-advances:119`, `recurring-invoices:75,156`, `quotes:92`, `ap/ap-bills:140`, `ap-payments:132`, `vendor-credit-notes:120`, `vendor-advances:108`, `recurring-bills:64,137`, `expenses:128,175` | `branchId: dto.branchId ?? null` written without verifying branch belongs to tenant. Only 9 of 30+ services call `assertBranchBelongsToTenant`. | User in Tenant A submits Tenant B's `branchId` → cross-tenant FK on their own invoice. Reports filtered by Tenant B branch include foreign rows. Branch P&L + BIR sales books silently corrupt. | Shared `assertBranchInTenant(tenantId, branchId)` util called before every `branchId: dto.branchId` write. |
| T3 | High | `orders/orders.service.ts:253,257,278-279,289,298,303` | In `create()`, `customerId`, `shiftId`, `variantId`, `modifierGroupId/OptionId`, `discountConfigId` from payload written without tenant validation. | Crafted offline order attaches foreign tenant's customer/shift/modifier IDs onto own order → orphaned FKs surface in customer ledgers and loyalty. | Bulk `count({ where: { id: {in: ids}, tenantId }})` guards for all five FK fields before `tx.order.create`. |
| T4 | Medium | `common/filters/prisma-exception.filter.ts:239-258` | Unhandled Prisma errors echo `err.message` first line into 500 response (non-prod or <200 chars in prod). | Schema fingerprinting via constraint names and column references. | Suppress `detail` unconditionally in prod; log server-side only. |
| T5 | Medium | `products/products.controller.ts:151-160` | Product photos uploaded with `publicRead: true` to `public/products/<tenantId>/<random>.<ext>`. | Receipt-image URL discloses tenantId CUID to anyone who sees the receipt. Defense-in-depth only — CUID alone grants no access. | Use opaque per-image token; serve through API. |
| T6 | Medium | `inventory/inventory.controller.ts` | Inventory endpoints don't apply `BRANCH_SCOPED_ROLES`. | Branch-A CASHIER passes `?branchId=<branchB>` → reads Branch B's stock levels and costs. | Wrap through `effectiveBranchId(user, requested)` per controller, as orders.controller does. |
| T7 | Medium | `auth/auth.service.ts:355-385` | When email exists in 2+ tenants and no companyCode supplied, "first SUPER_ADMIN match wins" silently. | Confirmed safe (SA tokens skip tenant binding) but ambiguous semantics. | Reject when multiple SA matches; require companyCode. |
| T8 | Low | `jwt.strategy.ts:21-25` | JWT validate re-fetches only `{id, isActive}`. `tenantId / role / appAccess / customPermissions` baked at login persist for 8h. | Revoked permissions still effective in carrier JWT until expiry. | Add `tokenVersion` claim checked against `User.tokenVersion` and bumped on privilege change. |

**Strengths verified**: 377 tenantId references in schema, most tenant-scoped models well-indexed. `passwordHash` never leaked in `/users` responses. `kioskPin` gated by role. AuditLog never receives password/token strings. JWT tampering blocked by signature. Documents stream via API with tenantId guard. `productId`, order-level `branchId`, `authorizedById`, `prescriptionId` all validated.

---

## Infrastructure

| # | Severity | Where | Risk | Fix |
|---|---|---|---|---|
| I1 | Critical | `apps/api/.env` | JWT access+refresh secrets present in working tree; if `git add -f` is ever used the secrets leak. May match prod values. | Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in Railway; replace local file with dev-only random secrets. |
| I2 | High | `.github/workflows/ci.yml:82` | CI builds `Dockerfile` at repo root but no Dockerfile exists (Railway uses nixpacks). `docker-build` job on main is broken, masking real failures. | Delete docker-build job or add a real Dockerfile that matches Railway. |
| I3 | High | `.github/workflows/ci.yml:5` vs `deploy-notify.yml:14` | Branch-name mismatch — CI triggers on main/develop, deploy-notify on master. Deploys may bypass CI. | Standardize on single default branch across both workflows. |
| I4 | High | `apps/web/next.config.js` (empty) | No CSP, HSTS, image-domain allowlist, or security headers on the Next.js edge — clickjacking, mixed content, and XSS rely on browser defaults. | Add `headers()` with HSTS, X-Frame-Options DENY, CSP, Referrer-Policy; configure `images.remotePatterns`. |
| I5 | High | `apps/api/src/main.ts:206-212` | CORS hardcodes `http://localhost:3000` in production builds. | Gate localhost origin behind `NODE_ENV !== 'production'`. |
| I6 | High | (missing) | No `vercel.json`, no Cloudflare config in repo. WAF/DDoS/rate-limit/header config undocumented. | Commit `vercel.json` with security headers + Cloudflare config (Terraform or docs/CLOUDFLARE.md). |
| I7 | High | `apps/api/src/common/config/env.validation.ts:48-55` | `MAIL_FROM` defaults to `noreply@clerque.app`, `APP_URL` to `http://localhost:3000`. If Railway env not set, password-reset emails point at localhost. | Make these `.required()` when `NODE_ENV=production`. |
| I8 | Medium | `start.sh:88-93` | Every deploy runs `prisma db push` against prod — bypasses versioned migration discipline. | Disable in prod startup; rely on `migrate deploy` only. |
| I9 | Medium | `apps/api/src/main.ts:186-189` | Static `/uploads/public/**` from local disk on Railway whose FS is ephemeral. Files lost every redeploy unless `S3_BUCKET` set. | Require `S3_BUCKET` in prod env validation; remove local-disk fallback in prod. |
| I10 | Medium | `packages/db/prisma/schema.prisma:6-10` | `DATABASE_URL` lacks `sslmode=require`. Depends on Railway internal network. | Document/enforce `?sslmode=require` in env.example. |
| I11 | Medium | `.env.example:103` | `SENTRY_DSN` optional. Prod can silently run without error tracking. | Required when `NODE_ENV=production`; assert at boot. |
| I12 | Medium | `apps/counter/eas.json:34` | `./play-store-key.json` is a working-dir file → accidental commit risk. | Move to EAS secrets, reference via env. |
| I13 | Medium | (missing) | No `.github/CODEOWNERS`, no visible branch protection. Solo deploys to master with only after-the-fact webhook. | Enable branch protection + required CI checks even for solo dev. |
| I14 | Medium | `docs/DISASTER_RECOVERY.md:25-30` | DNS CNAME TTL 60s claimed but no DNS-as-code in repo. RTO of 4h depends on manual TTL nobody can audit. | Commit Cloudflare DNS export (or Terraform). |
| I15 | Low | `apps/web/next.config.js` | No `poweredByHeader: false` — leaks Next.js version. | Set `poweredByHeader: false`. |
| I16 | Low | `apps/api/src/main.ts:200` | `app.set('trust proxy', 1)` missing; `req.ip` for rate-limit keys is Railway edge IP, not client. | Add `trustProxy: 1` before helmet. |

**Env-file safety**: `.env` files in `apps/api`, `apps/web/.env.local`, `packages/db/.env` are all matched by `.gitignore` (verified via `git ls-files`). None tracked. But the local DB password `hansnashshan123` is in two `.env` files — not in git, but easily exfiltrated from a compromised workstation.

---

## Backup & Disaster Recovery

The DR doc reads as a credible plan; the underlying infra is significantly thinner than the doc implies.

| # | Severity | Finding | Evidence | Remediation |
|---|---|---|---|---|
| B1 | **Critical** | No Railway DB backup configured. Entire RPO depends on application-level cron. | `railway.json` has only `$schema`. All backup logic in `apps/api/src/backup/backup.scheduler.ts:49` (`@Cron('0 2 * * *')`). If API process is unhealthy at 02:00, snapshot silently lost — only `logger.warn`. | Enable Railway native Postgres backups; add Sentry alert when `uploaded < tenantCount`; deadman-switch monitor. |
| B2 | **Critical** | 10-year retention path does not exist. BIR §235 obligation cannot be met. | `RECOVERY_SLA.md:28` claims "30 days of nightly snapshots". `DATA_CLASSIFICATION.md:54` claims "BIR exports taken to immutable archive before rollover" — no code initiates that archive. `DOCKET.md:27` lists CC-5 (10-year archival) as still-open. | Either build BIR archive cron OR contractually transfer obligation with quarterly forced-export reminders. |
| B3 | High | No PITR. Stated 24h RPO is a floor, not a ceiling. | No WAL archiving anywhere. JS snapshot caps at `take: 50_000/200_000` per table — heavy tenants exceeding caps lose oldest rows silently. | Enable Railway PITR (Pro tier) or remove `take:` caps and stream. |
| B4 | High | No evidence of any restore drill. | `DISASTER_RECOVERY.md:118` mandates quarterly drills; no drill log, no `restore-drill*` files, no tasks entry. Restore code path (`backup.service.ts:296-462`) untested in production. | Schedule + run the first drill within 14 days; commit a `docs/drills/2026-Q2.md` log. |
| B5 | High | Object Lock is aspirational, not configured. | `backup.scheduler.ts:76` and `audit-archive.scheduler.ts:18-22` both say "when the bucket has Object Lock enabled" — no `PutObjectLockConfiguration` call anywhere. | Enable Object Lock + 30-day retention on R2 bucket; commit verification script. |
| B6 | High | Restore is operational-only; identity tables (Tenant/Branch/User/Customer/Vendor) explicitly skipped. | `backup.service.ts:173-202`. Lose a Branch row → orphaned data, no recovery path. | Include identity tables in restore scope with merge-by-id semantics. |
| B7 | Medium | Per-tenant restore exists but cross-tenant isolation untested. | `backup.service.ts:340` wipes `tenantId: tenant.id` rows in single tx — looks correct, but no test asserts neighbouring tenants are untouched. | Add restore spec with two-tenant setup, assert neighbour rows persist. |
| B8 | Medium | Document uploads (product images, receipts) backed up only as R2's own durability. | `buildPayload` (lines 156-222) captures DB only; no image bytes, no R2 cross-region replication. | Enable cross-region replication on R2 OR add periodic image-bucket snapshot to a different account. |
| B9 | Medium | Counter outbox not durable to device loss. | `apps/counter/src/offline/db.ts:13-38` SQLite on device. Mid-shift device loss → queued sales unrecoverable. | Opportunistic "outbox heartbeat" endpoint that POSTs unconfirmed payload IDs before processing. |
| B10 | Medium | Audit archive depends on S3 driver — silently skips if not set. | `audit-archive.scheduler.ts:67-71`. AuditLog rows remain mutable in Postgres; no separate immutable copy. | Fail loud (not silent skip) when `S3_BUCKET` unset in prod. |
| B11 | Low | Counter logout doesn't purge offline `sync_outbox` SQLite. | `AuthProvider.tsx:368-376` deletes SecureStore + AsyncStorage; outbox DB untouched. On shared/lost device, queued payloads (sales + customer data) persist post-logout. | Call `clearOutbox()` from sign-out path. |
| B12 | Low | `AutoBackupService` writes to ephemeral Railway disk. | `auto-backup.service.ts:40` (`backupRoot = ./backups`). Railway FS ephemeral → vanish at redeploy. Google Drive integration is a TODO (line 88). | Either complete Drive integration or remove the dead feature. |

**Bottom line**: documents claim a backup posture stronger than the code can deliver. The 10-year BIR retention gap is a regulatory exposure during Bureau examination. The first action is enabling Railway native backups + Object Lock today; the second is running the first restore drill within two weeks to validate that the restore path works at all.

---

## Ransomware Prevention

**Posture**: kill switch is real and correctly wired against tenant-admin compromise. Weak against SUPER_ADMIN compromise. Strong defense against bulk-delete attack via tenant-side accounts.

| # | Severity | Finding | Evidence | Remediation |
|---|---|---|---|---|
| R1 | High | Kill switch bypassed by SUPER_ADMIN with no break-glass. | `read-only-mode.interceptor.ts:38-59`. `/api/v1/auth/*` and `/api/v1/admin/*` always allowed; any SUPER_ADMIN bypasses entirely. | Require second-person signoff (or hardware key) for `unfreezeTenant` and for any destructive endpoint while frozen. Add Cloudflare WAF rule keyed on tenant slug. |
| R2 | High | AuditLog table not insert-only at DB level. | Schema (`schema.prisma:738`) is a normal table. `onDelete: Cascade` from Tenant. | (See SOD A1 — same fix.) |
| R3 | Medium | Interceptor fail-open on missing tenantId. | `interceptor.ts:67`: `if (!user.tenantId) return next.handle()` — malformed/legacy JWT slips past entirely. | Reject when JWT carries no tenantId instead of bypassing. |
| R4 | Medium | Documents hard-deleted via API. | `documents.service.ts:88-99` calls `prisma.document.delete` + storage delete. No soft-delete. | Add `archivedAt` to Document; soft-delete via API; hard delete only via admin tooling. |
| R5 | Medium | SUPER_ADMIN `prisma.order.deleteMany` is hard delete. | `admin.service.ts:1096,1520`. Only `isDemoTenant` check protects it. | Add second-person signoff or rate limit destructive ops to 1 per 24h per super-admin (currently 5). |

**Strengths verified**:
- `Tenant.readOnlyMode` field; set/cleared only via `POST /admin/tenants/:id/freeze`, gated by `JwtAuthGuard + SuperAdminGuard`. Compromised BUSINESS_OWNER cannot unfreeze.
- `ReadOnlyModeInterceptor` registered globally; blocks every non-GET/HEAD/OPTIONS request with HTTP 423.
- All `deleteMany` on business data live in `admin.service.ts` (SUPER_ADMIN-gated). Triple-guarded: `assertTypedSlug` + `assertDemoTenant` + `assertDestructiveOpRateLimit` (5 ops/24h).
- Pre-destructive `snapshotTenantData` JSON snapshot kept 30 days.
- `Order.deletedAt` soft-delete used in `orders.service.ts:1029`.
- Background `@Cron` jobs are code-defined, not DB-scheduled — compromised account can't add a destructive cron.
- Session revocation: `JwtStrategy.validate` re-checks `user.isActive` per request → deactivating a user invalidates access tokens within ONE request, not 15 minutes.

---

## Internal Audit & SOD Controls

| # | Severity | Finding | Evidence | Remediation |
|---|---|---|---|---|
| A1 | **Critical** | `JournalEntry.entryNumber` lacks unique constraint. | `schema.prisma:1856-1910`. Only `@@index` exists, not `@@unique([tenantId, entryNumber])`. Comment in `journal.service.ts:41` claims constraint exists but it doesn't. NumberingService races silently double-issue. Contrast `Order.orderNumber` IS uniquely constrained at line 1548. | Add `@@unique([tenantId, entryNumber])` + backfill check migration. |
| A2 | High | No DB-level INSERT-only constraint on `audit_logs`. | `schema.prisma:738-763`. App layer is the only barrier. App code never calls `auditLog.delete|update`, but any raw SQL, Prisma Studio, or rogue migration defeats the claim. Same for `console_logs`, `login_logs`, `z_read_logs`. | `REVOKE UPDATE, DELETE ON audit_logs FROM <app_role>`; or BEFORE-UPDATE/DELETE trigger raising exception. |
| A3 | High | Inventory adjustments don't require reason or supervisor PIN. | `inventory/dto/adjust-stock.dto.ts:35`: `reason?` is `@IsOptional`. `inventory.service.ts:389-525`: no PIN gate, no threshold check. Negative adjustments hit COGS via journal (496-521) with no second-person attest. | Require `reason` (enumerated codes: DAMAGE/THEFT/EXPIRY/COUNT); supervisor PIN gate for negative adjustments above tenant-configured threshold; route to maker-checker queue. |
| A4 | Medium | Audit log omits user-agent. | `LogParams` interface has `ipAddress` but no `userAgent`; callers never pass it. | Add `userAgent String?` column; populate from request header at controller layer. |
| A5 | Medium | BUSINESS_OWNER / SUPER_ADMIN can self-approve their own JEs. | `journal.service.ts:230` — `if (entry.createdBy === approverId && approverRole !== 'BUSINESS_OWNER' && approverRole !== 'SUPER_ADMIN')`. Intentional per comment but is a clean SOD failure during BIR examination. | Still allow owner approval, but force `AuditAction.SELF_APPROVAL` log row + dashboard counter; or require a second BUSINESS_OWNER if more than one exists in tenant. |
| A6 | Low | JE approval threshold uses total debit only. | `journal.service.ts:119`. Threshold check is fine for balanced entries but a malformed line set could understate. | Check `Math.max(totalDebit, totalCredit)`. |

**Strengths verified**:
- AuditService exposes only `log() / findAll() / findSodViolations() / recentLogins()` — no update or delete methods. No `auditLog.delete|update|upsert` anywhere.
- AP payment SoD: AP_ACCOUNTANT who posted the bill is blocked from disbursing it.
- Void maker-checker: `initiatedById === approverId` rejected.
- Period close enforced server-side at every JE write via `assertDateIsOpen`. System events go to FAILED on closed period (no silent skip).
- Period reopen requires written reason; preserves close metadata; increments `reopenCount`.
- Cash variance auto-posts to `1010 / 4092` (over) or `6140 / 1010` (short).
- OR sequencing atomic via single `UPDATE ... RETURNING`.
- Time-machine: trial balance + balance sheet support `asOf`.
- `kioskOnly` accounts can never get a JWT — checked at password AND PIN login paths.
- Year-end close pre-flights pending events, draft AR/AP.

---

## Testing & Coverage

| Layer | Spec count | Coverage |
|---|---|---|
| API (`apps/api`) | 31 specs | Good on accounting/AR/AP/tax. Bare on operations. |
| Web (`apps/web`) | **0** | Zero — no jest/vitest/playwright/cypress installed. |
| Counter mobile (`apps/counter`) | **0** | Zero — no jest/detox configured. |
| `packages/db`, `packages/shared-types` | **0** | None. |
| E2E (any tier) | **0** | No playwright/cypress/detox config exists. |
| Manual test docs | **0** | No smoke checklist, QA script, or release test plan in `docs/`. |

### Critical: CI does NOT run tests

`.github/workflows/ci.yml` runs only `check-types`, `lint`, and a conditional Docker build. **`jest` is never invoked** on PRs or main. The 31 specs are dead weight — they can rot silently. (`ci.yml` lines 9-84.)

### Top 10 critical test gaps (zero coverage, high regression risk)

| # | Area | Risk | Recommended test |
|---|---|---|---|
| 1 | **CI never runs tests** | Every spec can break silently; coverage is theatre. | Add `test` job running `jest` per workspace; fail build on red. |
| 2 | **Shift open/close + cash variance** | Variance miscalc, double-open, Z-Read drift → cash theft cover. | Test open-when-active-exists, variance = declared − expected, cashOut aggregation, idempotent close. |
| 3 | **Z-Read tender aggregation by method** | Wrong CASH/GCASH/CARD/QR_PH totals → BIR audit finding. | Snapshot Z-Read with mixed tenders + voids + refunds. |
| 4 | **Pre-order deposit + balance lifecycle** | Deposit double-applied, balance mis-settled, partial cancel refund wrong. | State machine: deposit → partial → balance → settle, refund paths. |
| 5 | **Fuel meter math + tank variance** | Wrong volume sold, tank reconciliation drift, fuel margin off. | Opening/closing reading delta vs sold, tank dip variance threshold. |
| 6 | **Modifier-ingredient COGS posting** | Wrong COGS, raw-material drawdown wrong, P&L wrong. | Order w/ modifier consumes BOM raw materials, GL posts modifier COGS. |
| 7 | **Wholesale price-list resolution** | Wrong price for B2B customer → revenue leak / overcharge claim. | Customer-tier → list → price fallback chain, effective-date overlap. |
| 8 | **FEFO consumption ordering** | Expired lots sold; recall liability. | Two lots, earlier expiry first; tie-break on receivedAt. |
| 9 | **Idempotency interceptor** | Duplicate orders on retry → double cash collection. | Same key returns cached response, distinct keys don't collide, TTL works. |
| 10 | **Outbox drain** | At-least-once delivery to GL/notifications. | At-least-once delivery, failed-row backoff, idempotent consumer. |

### What IS covered (sampled — real assertions)

- VAT math + PWD/SC discount (RA 9994 strip-then-discount-then-rebuild): `tax/tax.service.spec.ts` — thorough
- Multi-tenant isolation: `security/cross-tenant.security.spec.ts` — excellent (branch injection, forged authorizer, tenantId-from-body, TOCTOU shift close)
- Payroll PH tax tables, BIR 2307, accounting journal (cash events + GL)
- AR/AP advances + credit memos + recurring invoices
- Projects issuance, warehouse race, AI quota guard, tier quota guard
- Products, plans, laundry, accounting periods, recurrence helper
- Mail service, invoice PDF, auth service (basic)

### Other high-priority gaps

- DME serial tracking (pharmacy has zero specs)
- Web frontend: **zero tests** — Dexie offline cache untested
- Counter: **zero tests** — SQLite sync, Bluetooth printer, offline queue, login persistence all untested. Worst surface to leave bare (hardest hotfix loop).
- Construction, trucking, rentals, repairs, job-orders, loyalty-pro, bank-recon, expense-claims: zero specs
- Auth refresh-token rotation, MFA, lockout, session revocation: not directly tested

**Honest summary**: 31 specs cluster around accounting (where the team cared) and skip operational hot paths. Plus they don't run in CI. Two single highest-ROI fixes: (1) add `jest` to CI now; (2) add shifts + Z-Read + idempotency specs before the next BIR reporting cycle.

---

## What was NOT audited

- **Live black-box pen-test** against production endpoints — needs separate ROE agreement.
- **Manual UX security testing** (clickjacking on real pages, mobile share-target abuse) — needs device + browser fleet.
- **Dependency CVE scan** of `package-lock.json` — out of scope (use `npm audit` + Dependabot).
- **Sentry / Datadog log review** for active anomalies — needs platform access.
- **DPO records** (RA 10173 compliance audit) — separate paper-trail review.
- **Network-level inspection** (Cloudflare / Railway TLS termination, BGP) — out of scope.

---

## Recommended Action Sequence

### Week 1 — Stop-the-bleeding (Critical only)

1. **T1** — Fix `orders.findOne` branch scoping. Pass `effectiveBranchId(user)` into the where clause. ~30 min.
2. **B2** — Decide BIR 10y retention: build the archive cron, or rewrite SLA to contractually transfer.
3. **B1** — Enable Railway native Postgres backups; add deadman alert.
4. **A1** — Schema migration adding `@@unique([tenantId, entryNumber])` on JournalEntry. Backfill duplicate check first.
5. **TEST** — Add `npm test` step to CI.

### Week 2 — High-severity fixes

6. **T2** — Shared `assertBranchInTenant` helper; called from 13 AR/AP write paths.
7. **C1** — Fix refresh-token verify secret.
8. **C2** — Add login throttling.
9. **A2** — `REVOKE UPDATE, DELETE ON audit_logs`. DB migration.
10. **A3** — Required reason + supervisor PIN on inventory adjustments.
11. **B5** — Enable Object Lock on R2 bucket.
12. **I5** — Gate localhost CORS on `NODE_ENV !== 'production'`.

### Week 3-4 — Hardening + testing

13. **T3** — Tenant-validation guards on Order.create FKs.
14. **C4** — Reduce access-token TTL.
15. **C5** — Hash kioskPin.
16. **B4** — Run the first restore drill; document in `docs/drills/`.
17. **TEST 2-10** — Write the 9 critical missing specs.

### Month 2 — Defense-in-depth

18. **C8** — CSRF / SameSite hardening.
19. **R1** — Second-person signoff for SUPER_ADMIN destructive ops.
20. **A6** — Audit log hash chain.
21. **I4, I6** — Web security headers + Cloudflare config commits.
22. **I13** — Branch protection + CODEOWNERS.

---

*Audit produced 2026-05-27 by 7 parallel investigation agents (cybersecurity, tenant isolation, infra, backups, ransomware, internal audit / SOD, testing). All findings traceable to file:line; no code modified during this audit.*
