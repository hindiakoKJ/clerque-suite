# Disaster Recovery Plan

**Document ID:** D2-04 / D10-E
**Owner:** Kristian JV Sacdalan (Founder, acting DPO)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11

---

## Targets at a glance

| Scenario | RTO | RPO |
|---|---|---|
| Railway region outage | 4 h | 0 (read replicas) or 24 h (worst case) |
| Postgres corruption | 6 h | 24 h (last nightly R2 backup) |
| Complete data centre loss | 24 h | 24 h |
| Cloudflare R2 unavailable | n/a (no live dependency) | 24 h on next backup window |
| Anthropic API outage | immediate (graceful degrade) | 0 |
| Founder unavailable | 8 h to delegated operator | n/a |

Backups: nightly 02:00 UTC, ~25 tables, stored in R2 with Object Lock. Restore endpoint: `POST /admin/backups/:slug/restore`.

---

## Scenario 1 — Railway region outage

- **Trigger:** Railway status page red for our region OR UptimeRobot reports `api.clerque.ph` down for 5+ minutes AND Vercel is up.
- **Who notifies whom:** UptimeRobot pages founder → founder posts a status banner on the Vercel-served `/status` page within 15 min.
- **Decision tree:**
  1. Confirm Railway-side via status.railway.app.
  2. If ETA < 2h → wait, communicate.
  3. If ETA > 2h or unknown → spin up Railway service in alternate region from latest R2 backup.
- **Recovery procedure:**
  1. Create a new Railway project in an unaffected region.
  2. Restore the latest tenant snapshots via the restore endpoint (one POST per tenant slug).
  3. Update DNS CNAME for `api.clerque.ph` (TTL 60s on file).
  4. Verify with the smoke-test suite.
- **Communication template:**
  > Subject: Clerque service interruption — Railway region outage
  > We are aware of a Railway-side outage affecting `api.clerque.ph` since [HH:MM PHT]. POS terminals already shifted into offline mode continue to record sales locally. We will restore service from our R2 backup if Railway does not recover by [HH:MM PHT]. Next update: [HH:MM PHT].

## Scenario 2 — Postgres corruption

- **Trigger:** failing migrations, FK violations on read, or backup-integrity job reports checksum mismatch.
- **Who notifies whom:** founder discovers (via Sentry or manual report) → DPO logs the event → tenant comms only if customer-visible.
- **Decision tree:**
  1. Stop all writes — toggle `PlatformConfig.READONLY` to true.
  2. Identify scope: single tenant, single table, or cluster-wide?
  3. Single tenant + single table → restore that table from last good R2 snapshot for that tenant.
  4. Cluster-wide → full restore from R2.
- **Recovery procedure:**
  1. `POST /admin/backups/<slug>/restore` for affected tenants.
  2. Re-enable writes (`PlatformConfig.READONLY = false`).
  3. Run reconciliation: any orders rung up after the snapshot but before the corruption window need to be re-keyed from POS offline logs.
- **RTO:** 6 h. **RPO:** 24 h.
- **Comms template:**
  > Subject: Data restore notice
  > Between [HH:MM] and [HH:MM] PHT we detected and corrected a database integrity issue affecting [scope]. Transactions recorded during that window may need to be re-keyed from your POS offline log; we will contact affected tenants individually.

## Scenario 3 — Complete data centre loss

- **Trigger:** Railway us-east AND backup region both unreachable for > 1 h, or a public Railway-wide incident.
- **Who notifies whom:** founder → all tenants via Resend transactional within 2 h with the comms template.
- **Decision tree:**
  1. Pull latest R2 backup set to local laptop (R2 is independent of Railway).
  2. Provision a fresh Postgres on alternate provider (Neon / Supabase already noted as fallback).
  3. Provision a fresh Railway-equivalent (Render / Fly.io) for the NestJS API.
  4. Re-point DNS.
- **Recovery procedure:** as Scenario 2, but new infra. Vercel hosting is independent and is expected to remain up.
- **RTO:** 24 h. **RPO:** 24 h.
- **Comms template:**
  > Subject: Clerque service restoration — extended outage
  > Clerque experienced an extended outage starting [HH:MM PHT] due to an infrastructure-provider failure beyond our control. Your data is intact and is being restored from our independent off-site backup. Estimated restoration: [HH:MM PHT, date]. POS terminals continue to record offline; nothing is lost.

## Scenario 4 — Cloudflare R2 unavailable

- **Trigger:** nightly backup job fails 2 nights in a row OR R2 status page red.
- **Note:** R2 is **not** in the live request path. Outage affects backups, uploads of new product images, and receipt logos — not POS, ledger, or payroll operations.
- **Decision tree:**
  1. If < 24 h outage → wait, retry the backup at the next window.
  2. If > 24 h → divert the next backup to a temporary S3-compatible target (AWS S3 or Backblaze B2) and update `S3_ENDPOINT` env in Railway.
- **Recovery procedure:**
  1. Verify R2 recovery against status page.
  2. Run a one-shot backup outside the cron window to close the RPO gap.
- **RTO:** n/a (no live dependency). **RPO:** next successful backup window.
- **Comms template:** internal only unless customer image uploads were affected.

## Scenario 5 — Anthropic API outage (graceful AI degradation)

- **Trigger:** AI Drafter / AI Guide requests return 5xx > 5% over 10 min OR Anthropic status page red.
- **Note:** Clerque core (POS, Ledger, Payroll) does **not** depend on Anthropic. Only the AI Drafter (memo drafting) and AI Guide (in-app help) degrade.
- **Decision tree:**
  1. Set `PlatformConfig.AI_DISABLED = true`.
  2. AI buttons in the UI render disabled state with a tooltip: "AI helpers are temporarily offline."
  3. Users continue all manual flows.
- **Recovery procedure:** unset `AI_DISABLED` once Anthropic status recovers. Re-enqueue any pending AiUsage rows flagged `failed`.
- **RTO:** immediate degradation, no recovery action required for core. **RPO:** 0.
- **Comms template:** in-app banner only.

## Scenario 6 — Founder unavailable (delegation)

- **Trigger:** founder unreachable for > 4 h during a live sev-1, or pre-planned absence > 24 h.
- **Delegation chain (in order):**
  1. Designated technical delegate (named in the founder's password manager "Break-Glass" note).
  2. Spouse / next-of-kin holds the sealed envelope with the password-manager master phrase and instructions to hand it to the technical delegate.
- **Decision tree:**
  1. If sev-1 and founder unreachable for 4 h → break glass.
  2. Delegate confirms identity to spouse, retrieves envelope, opens password manager.
  3. Delegate executes the matching `INCIDENT_RESPONSE.md` playbook.
- **Recovery procedure:** founder, on return, rotates every credential the delegate touched (treat as scoped credential compromise — see `INCIDENT_RESPONSE.md` § D10-F).
- **RTO:** 8 h to delegated operator.
- **Comms template:**
  > Subject: Clerque on-call coverage
  > For [date range], operational on-call is held by [delegate name, delegate@email]. Security incidents continue to be reported to security@clerque.ph and will be triaged within 4 hours.

---

## Restore drill SOP

Quarterly: restore one randomly chosen tenant snapshot into a staging Railway project, run the smoke-test suite, log the result, then tear down. The restore endpoint (`POST /admin/backups/:slug/restore`) is the only supported path; do not hand-craft `pg_restore` calls against production.
