# Clerque App-Suite — Session Instructions

This session is for **Clerque and its supporting services only**. The
HNScorpPH landing page lives in the separate `hns-corp-ph` repo, not here.

---

## Read These First

1. `docs/OPERATIONS.md` — how Clerque is run: KJ's working rules, where it is
   deployed, the variables, how to build and verify, migrations, reaching
   production from a session (including the cloud), AI, the receipt reader,
   the security posture, and what is open. It travels with the repository,
   so a cloud session has it too.
2. `DEPLOY.md` — the deploy runbook. `tasks/carolina-go-live.md` — the Day-1
   runbook for the first shop.
3. `tasks/next-session.md` — where the work stands and what waits on KJ.
   In a cloud session, first run `bash scripts/cloud-session-setup.sh`
   (`docs/OPERATIONS.md` section 7).

On KJ's desktop only, the session's memory folder adds history and reasoning:
`C:\Users\krist\.claude\projects\C--Users-krist-Claude-AI-Projects-app-suite\memory\`.
The older memory files (`project_clerque.md`, `arch_decisions.md`,
`feedback.md`, `user_profile.md`) were lost when the PC was reformatted in
Nov 2026. `docs/OPERATIONS.md` carries what mattered from them, and a cloud
session works from it too.

---

## Monorepo Layout

```
C:\Users\krist\Claude\AI Projects\app-suite\
├── apps/
│   ├── web/          ← Next.js frontend (Clerque UI, port 3000)
│   ├── api/          ← NestJS backend (port 3001)
│   └── counter/      ← Expo mobile POS app
├── packages/         ← Shared packages
└── package.json      ← Turborepo root
```

**Primary directories for this session:**
- `apps/web` — Clerque Next.js frontend
- `apps/api` — NestJS API, Prisma, PostgreSQL

---

## Stack

- **Frontend:** Next.js (App Router), Tailwind CSS, shadcn/ui
- **Backend:** NestJS, Prisma ORM, PostgreSQL
- **Auth:** JWT, multi-tenant RBAC
- **Infra:** Railway (API + DB), Vercel (web)

---

## What's Already Built

All 10 planned phases are complete. For what is built, see `docs/OPERATIONS.md`,
`tasks/next-session.md`, `tasks/todo.md` and the git history.

**Remaining deferred features (potential next work):**
1. Payroll computation engine (TimeEntry + PayRun schema already exist)
2. BIR Form 2307 generation
3. 2FA (schema fields exist, no UI/API yet)
4. T&E OCR / WhatsApp integration
5. Live BIR e-filing API
6. Multi-currency / FX engine

---

## Key Rules

- Push straight to `master`. A change with a **database migration** goes on a
  branch with a PR and waits for KJ's word (`start.sh` migrates on deploy).
- One next action for KJ, not a menu. Verify before claiming done.
- Check what is already built before proposing a feature (`docs/OPERATIONS.md`,
  `tasks/`, git history). Decisions already made there and in the code are not
  re-litigated; when the reason behind one is unclear, ask KJ rather than undo it.
- No DB triggers — use NestJS `@Cron` or BullMQ
- SOD rules enforced at service layer, not DB
- BusinessType is the primary feature gate
