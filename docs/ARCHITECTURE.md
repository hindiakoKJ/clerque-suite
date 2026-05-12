---
title: Clerque Architecture Overview
audience: new joiner / engineer ramping up
status: active
last-reviewed: 2026-05-12
audit-finding: D7-05
---

# Architecture Overview

A grounded tour of the Clerque codebase for someone who has never opened it
before. Read this end-to-end on day one. Pair it with `arch_decisions.md`
when you want to know *why* a thing is shaped the way it is.

## Monorepo layout

```
app-suite/
├── apps/
│   ├── api/          NestJS backend, port 3001
│   ├── web/          Next.js 16 frontend (App Router), port 3000
│   └── landing/      HNScorpPH marketing site — separate session, do not touch
├── packages/
│   ├── db/           Prisma schema + generated client
│   └── shared-types/ TypeScript types + helpers shared between api/web
└── docs/             Governance, runbooks, this file
```

Turborepo wires the build graph. `pnpm` (or `npm` in some workspaces) is
the package manager.

## Stack choices

| Layer | Tool | Why |
|---|---|---|
| DB | PostgreSQL + Prisma | Strong typing end-to-end. Migrations are source-controlled. |
| API | NestJS | Modular DI, decorator-based RBAC fits multi-tenant cleanly. |
| Web | Next.js 16 (App Router) + Tailwind + shadcn/ui | Server components for cheap layout, client components for POS. |
| Auth | JWT (8h) + per-device refresh-token rotation | Stateless API, kicks compromised devices fast. |
| MFA | `otplib` (TOTP) | RFC-6238, works with Google Authenticator, Authy, 1Password. |
| Excel | `exceljs` | BIR Books of Account exports. |
| PDF | `pdfkit` | Receipts, invoices, BIR forms. |
| AI | `@anthropic-ai/sdk` | Bookkeeper assist + onboarding helpers. |
| Icons | `lucide-react` | Consistent line-icon set across all three apps. |
| Email | Resend SDK | Transactional + password reset. |
| Storage | Cloudflare R2 | Off-box backups + document attachments. |

## The three top-level products

Clerque ships three vertically-scoped apps from one codebase:

1. **Counter** (POS) — register, shifts, cash management, offline mode
   (Dexie/IndexedDB), modifier groups, promotions. Route: `/pos/*`.
2. **Ledger** — chart of accounts (186, PFRS/PAS 12), journal entries,
   AP, AR, settlements, period locks, BIR exports. Route: `/ledger/*`.
3. **Payroll** — time entries (clock-in/out via kiosk), attendance,
   timesheets. Salary computation engine is deferred. Route: `/payroll/*`.

Backend is **one** NestJS API. There is no microservice split. Module
visibility is gated at the JWT level (see "Entitlements" below).

## Multi-tenancy

Every domain row carries `tenantId`. There are no shared tables and no
"global" data leaking across tenants. Scoping is enforced at the **service
layer**: every Prisma query you write must include `tenantId` in the
`where` clause. There are no database-level RLS policies — the service
layer is the source of truth.

The current user's `tenantId` is on `req.user` (populated by the JWT
guard). A typical service method looks like:

```ts
async listOrders(user: AuthUser) {
  return this.prisma.order.findMany({
    where: { tenantId: user.tenantId },   // <-- never optional
    orderBy: { createdAt: 'desc' },
  });
}
```

Forgetting `tenantId` is the #1 review red flag. Code review should
reject any new query that lacks it.

## Module entitlements

The `Tenant` row has three booleans: `modulePos`, `moduleLedger`,
`modulePayroll`. These are **baked into the JWT at issuance**. Guards on
controllers read the JWT claim — they do not re-query the DB on every
request.

If a tenant upgrades or downgrades, force a logout / token refresh so the
new entitlements take effect.

## Auth flow

1. `POST /auth/login` with email + password.
2. Server validates bcrypt hash, issues a **JWT (8 hours)** and a
   **refresh token** scoped to the device fingerprint.
3. Client uses the JWT on every request. When it expires, it presents the
   refresh token at `POST /auth/refresh`; the server **rotates** the
   refresh token (one-use only) and issues a new JWT + refresh.
4. **MFA**: if the user has TOTP enrolled, login returns a `mfaRequired`
   flag and the JWT is withheld until `POST /auth/mfa/verify` succeeds.
5. **Kiosk PIN**: a separate 4-8 digit PIN used only for clock-in / clock-out
   on a shared tablet. Cannot be used to log into the web app.
6. **Supervisor PIN**: a manager-level PIN used to authorise voids and
   over-threshold discounts at the POS. Bcrypt-hashed; rotate quarterly.

## AccountingEvent processor

The accounting pipeline is **event-driven, not trigger-driven** (no DB
triggers — decision in `arch_decisions.md`).

- POS / AR / AP services write rows into `AccountingEvent` with status
  `PENDING`.
- A `@Cron('* * * * *')` job (every minute) in NestJS picks up `PENDING`
  events, generates the matching `JournalEntry` + `JournalLine` rows
  inside a transaction, and marks the event `POSTED`.
- Failures move events to `FAILED` with the error captured. A retry loop
  is on the roadmap; today it's manual re-trigger.

When volume justifies it, the cron is replaced by BullMQ — same contract,
queue-backed.

## Backup pipeline

- Nightly cron at 02:00 UTC dumps every tenant's data to JSON.
- JSON file is uploaded to Cloudflare R2 (Object-Lock retention coming).
- Optional webhook fires after upload — tenants can wire their own cold
  copy.
- See `docs/RECOVERY_SLA.md` for the public SLA, `docs/DISASTER_RECOVERY.md`
  for the engineering side.

## Key invariants (the rules you cannot break)

- **SOD is enforced at the service layer**, not by database constraints.
  Every AP/AR/payment service must check `createdById !== currentUserId`
  before allowing approval.
- **No DB triggers.** Use `@nestjs/schedule` or BullMQ. Triggers are
  untestable and impossible to mock.
- **`BusinessType` is the primary feature gate.** F&B sees modifier groups;
  Construction sees decimal UoM; Service sees neither. One schema, many
  shapes.
- **Period locks are checked via `assertDateIsOpen(tenantId, date)`** in
  every service that creates a back-dated entry. Skipping this corrupts
  tax filings.
- **Order numbers** use a DB-level atomic sequence — never `COUNT(*)+1`.
- **Inventory deductions** use `SELECT ... FOR UPDATE` inside the order
  transaction to prevent oversell races.

## Adding a new feature — mini-runbook

When you're asked to add a feature, the canonical order is:

1. **Schema** — edit `packages/db/prisma/schema.prisma`. Add `tenantId`,
   relations, indexes.
2. **Migration** — `npx prisma migrate dev --name <feature>`.
3. **Service** — `apps/api/src/<module>/<feature>.service.ts`. All Prisma
   access lives here. Inject `PrismaService`. Every query carries
   `tenantId`.
4. **Controller** — `apps/api/src/<module>/<feature>.controller.ts`.
   `@UseGuards(JwtAuthGuard, RolesGuard)`. Validate inputs via DTOs.
5. **DTO** — `class-validator` decorators (`@IsString`, `@IsInt`, etc.).
   Reuse types from `packages/shared-types` where they exist.
6. **Spec** — `*.spec.ts` next to the service. Cover the SOD rule and
   the tenant-scoping check at minimum.
7. **Frontend page** — `apps/web/app/<area>/<feature>/page.tsx`. Use
   `@tanstack/react-query` for fetching, `sonner` for toasts, the
   existing settings/list patterns for layout.

If any of those steps feels weird, stop and re-read this doc or
`arch_decisions.md` before improvising.
