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

On KJ's desktop only, the session's memory files add history and reasoning:
`C:\Users\user\.claude\projects\E--AI-Projects\memory\` (`project_clerque.md`,
`arch_decisions.md`, `feedback.md`, `user_profile.md`). A cloud session does
not have them; `docs/OPERATIONS.md` carries what matters from them.

---

## Monorepo Layout

```
E:\AI Projects\app-suite\
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

All 10 planned phases are complete. See `project_clerque.md` for the full list.

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
  and on the desktop `project_clerque.md`). Locked decisions in
  `arch_decisions.md` are not re-litigated.
- No DB triggers — use NestJS `@Cron` or BullMQ
- SOD rules enforced at service layer, not DB
- BusinessType is the primary feature gate
