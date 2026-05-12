---
title: Production Rollback Runbook
audience: on-call engineer (currently the founder)
status: active
last-reviewed: 2026-05-12
audit-finding: D7-02
---

# Rollback Runbook — "The last deploy is bad"

Use this when a production deploy is actively harming users and the fastest
safe action is to put the previous version back. Triage first, rollback
second — but do not delay rollback for a post-mortem.

## When to roll back

Roll back if any one of the following is true within 5 minutes of a deploy:

- Error rate is **>20% above baseline** in Sentry or app logs.
- `/health` smoke test returns non-200, or 5xx storm in API logs.
- Login is broken (cannot acquire JWT).
- POS terminal cannot create an order end-to-end.

If only a single non-critical feature is broken, prefer a forward fix.
Rollback is for "the platform is on fire."

## Step-by-step (in order)

1. **Acknowledge in `#incidents`** (Slack channel; if Slack is not yet
   provisioned, email the DPO + co-founder). One line: "Rolling back deploy
   `<sha>` — error rate spiked." Start a timer.
2. **Identify the last-known-good commit:**
   ```
   git log --oneline -10
   ```
   The commit immediately before the bad SHA is usually it. Cross-check
   against the green deploys list in Railway and Vercel.
3. **Roll back the API (Railway):**
   - Open the service → **Deployments** tab.
   - Click the previous successful deploy.
   - Hit **Redeploy**.
   - Or via CLI: `railway service redeploy <deploymentId>`.
4. **Roll back the web (Vercel):**
   - Dashboard → **Deployments** → previous green deploy.
   - Click **... → Promote to Production**.
5. **Wait for both deploys to show green.** Do not skip this — half-rolled-
   back stacks are worse than the original problem.
6. **Re-run smoke test:**
   ```
   curl -sf https://api.clerque.ph/health
   ```
   Then a manual login + create-order in production.
7. **If a database migration was part of the bad deploy:**
   - **Do NOT roll back the database.** Migrations should be
     forward-compatible by design.
   - If the migration is destructive (drops a column or table) and must be
     reverted, **stop here**, call the DPO, and engage support. This is a
     separate emergency procedure — treat the database as a crime scene
     until then.
8. **Open a post-mortem.** Create `docs/postmortems/YYYY-MM-DD.md` using the
   template at the top of the postmortems folder. Required within 48 hours.

## Rollback hot-fix template (when "redeploy the last green" isn't enough)

When the bad deploy has already had follow-up commits on top of it and you
need to ship a fix without rewinding everything:

```bash
git revert <bad-sha>           # creates a revert commit
git push origin master         # CI deploys the revert
# Then on Vercel, Promote-to-Production the resulting build.
```

This is the safe, auditable rollback path. Avoid `git reset --hard` on
shared branches.

## Communication

- **Status page (status.clerque.ph)** — update within 5 minutes of
  acknowledgement, again at recovery.
- **Email blast** to `BUSINESS_OWNER` users for every tenant on the
  affected service. Use the incident-response template in
  `docs/INCIDENT_RESPONSE.md`. Keep it factual: what broke, what we did,
  whether their data is affected, ETA.
- **Resolution comms** within 24 hours, with link to post-mortem.

## After the rollback

- The `deploy-notify` GitHub Action (`.github/workflows/deploy-notify.yml`)
  posts every push to master to a webhook so that future deploys are at
  least visible after the fact — this replaces the missing peer-review gate
  with an after-the-fact visibility gate.
- Add the regression to `apps/web/__tests__` or `apps/api/test/` so the
  bug cannot return silently.
