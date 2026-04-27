# Clerque App-Suite — Session Instructions

This session is for **Clerque and its supporting services only**.

> HNScorpPH landing page (`apps/landing`) is maintained in a separate session.
> Do not make changes to `apps/landing` here unless explicitly asked.

---

## Read These First

Before starting any work, read the following memory files for full context:

- `C:\Users\user\.claude\projects\E--AI-Projects\memory\project_clerque.md` — build state, completed phases, roadmap, deferred features
- `C:\Users\user\.claude\projects\E--AI-Projects\memory\arch_decisions.md` — locked-in architectural decisions and the reasoning behind them
- `C:\Users\user\.claude\projects\E--AI-Projects\memory\user_profile.md` — working style and preferences
- `C:\Users\user\.claude\projects\E--AI-Projects\memory\feedback.md` — how to work with this user

---

## Monorepo Layout

```
E:\AI Projects\app-suite\
├── apps/
│   ├── web/          ← Next.js frontend (Clerque UI, port 3000)
│   ├── api/          ← NestJS backend (port 3001)
│   └── landing/      ← HNScorpPH landing page (NOT this session)
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

- Never touch `apps/landing` — that's the HNScorpPH landing page session
- Always check `project_clerque.md` before proposing new features — it may already be built
- Follow existing arch decisions in `arch_decisions.md` — do not re-litigate locked decisions
- No DB triggers — use NestJS `@Cron` or BullMQ
- SOD rules enforced at service layer, not DB
- BusinessType is the primary feature gate
