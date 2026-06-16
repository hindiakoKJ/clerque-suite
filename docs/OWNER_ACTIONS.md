# Owner Action Checklist — Audit Remediation

**Last updated:** 2026-05-11
**Status of this sprint:** All code-level and documentation findings from the
Internal Audit Report (`scripts/clerque_internal_audit_report.py`) have been
closed in commits leading up to this document. What remains below requires
**actions only you can take** — cloud-console clicks, paperwork submissions,
contract signings, or paid vendor engagements.

Each item maps back to an audit finding ID. After you complete an item, tick
the box and note the date.

---

## Critical (30-day SLA)

### ☐ D1-06 — Enable R2 Object Lock on the backups bucket
**Why:** Without Object Lock, an attacker who steals our R2 API credentials
can delete every backup before we recover. With it, deletes are refused for
the retention window — ransomware-proof.

**Steps:**
1. Log in to Cloudflare dashboard → R2 → your backups bucket.
2. Settings → Object Lock → Enable.
3. Mode: **Compliance** (cannot be disabled by anyone once set; safer than
   Governance which can be disabled by admin).
4. Default retention: **30 days**.
5. Save.

**Verify:** in Cloudflare, try to delete a backup file from yesterday →
should be refused with a retention-policy error.

---

### ☐ D7-03 — Designate Data Protection Officer (DPO) and register with NPC
**Why:** RA 10173 §21 requires any personal-information controller handling
sensitive personal information to register a DPO with the National Privacy
Commission. Clerque handles employee TIN/SSS/PhilHealth/salary, customer PII,
and BIR retention data — squarely in scope. A breach today without a
registered DPO triggers an additional penalty on top of the breach itself.

**Steps:** Follow the procedure in `docs/DPO_APPOINTMENT.md` exactly.
Summary: (1) sign the appointment letter (you can name yourself as the
initial DPO), (2) register at https://privacy.gov.ph/npc-registration/,
(3) save the issued NPC Registration Number into the letter, into
`docs/VENDORS.md`, and into `docs/INCIDENT_RESPONSE.md`.

**Effort:** ~4 hours of paperwork. **Cost:** zero.

---

### ☐ D6-03 — Engage a third-party penetration test
**Why:** The internal security audit is a code review. Real attackers don't
review code — they probe the running service. A focused web-app pentest
gives you an outside-in perspective the internal audit cannot.

**Steps:**
1. Solicit quotes from 2-3 Philippine boutiques (suggested: Pwndepot,
   Secuna, Sec Consult Manila). Target scope: web app + API authn + RBAC.
2. Sign NDA + Statement of Work.
3. Set engagement window (typically 1-2 weeks).
4. Conduct kickoff: provide the auditor a test tenant, two test users
   (BUSINESS_OWNER + CASHIER), and the latest version of `docs/`.
5. On report receipt: triage findings into the same Critical/High/Medium
   buckets, action by SLA.

**Effort:** 2 weeks elapsed. **Cost:** ~PHP 150,000–300,000.
**Target completion:** before first paying customer goes live.

---

## High (90-day SLA)

### ☐ D1-02 — Stand up a staging environment
**Why:** All testing currently flows local-dev → production. A schema
migration that breaks a join can take down customer data with no rehearsal.

**Steps:**
1. Railway → New Project → name it `clerque-staging`.
2. Add Postgres + the API service from the same GitHub repo, pointed at a
   new branch `staging`.
3. Vercel → New Project → same repo, branch `staging`, preview deployments
   enabled.
4. Copy anonymised production data into the staging DB (use the new admin
   restore endpoint with a sanitisation step — strip TINs, salaries, emails
   to `user-<id>@example.test`).
5. Add a Railway service env: `NODE_ENV=staging`.
6. Update `.github/workflows/*` so PR builds run migrations against staging
   before merge.

**Effort:** 1 day. **Cost:** ~$10/month on Railway.

---

### ☐ D2-02 — Conduct a documented restore drill
**Why:** Untested backups are not backups. The admin restore endpoint exists;
no one has confirmed it works end-to-end against a real tenant snapshot.

**Steps:**
1. Pick a non-production tenant in staging.
2. Note: row counts in each major table (orders, journal_entries, products).
3. Pull yesterday's R2 snapshot via `GET /admin/backups/:slug/download`.
4. Run `POST /admin/backups/:slug/restore` with `confirmationToken: <slug>`.
5. Confirm: row counts match, GL balances reconcile (Trial Balance balances),
   ARinvoices' status enum values round-trip correctly.
6. Document timing: snapshot-fetch + wipe + reinsert + verify in minutes.
7. Schedule the next drill in `docs/DISASTER_RECOVERY.md` (semi-annual).

**Effort:** 2-3 hours. **Cost:** zero.

---

### ☐ D4-04 — Enable GitHub branch protection on master
**Why:** Right now a single accidental commit to master deploys instantly to
Railway production. One required review forces a second pair of eyes.

**Steps:**
1. GitHub → repo Settings → Branches → Add rule → name `master`.
2. Tick: "Require a pull request before merging" → "Require approvals" → 1.
3. Tick: "Require status checks to pass before merging" → select CI workflow.
4. Tick: "Require linear history".
5. Tick: "Do not allow bypassing the above settings" (this also blocks the
   founder; intentional).
6. Save.

**For emergency hot-fixes:** temporarily disable rule, push fix, re-enable.
Document the exception in your team chat for traceability.

**Effort:** 10 minutes. **Cost:** zero.

---

### ☐ D8-02 / D8-03 — Set up UptimeRobot + Sentry
**Why:** Currently you only know production is down when a customer tells
you. These give you push alerts within minutes.

**UptimeRobot steps:**
1. https://uptimerobot.com → sign up (free tier sufficient).
2. Add Monitor → HTTPS → `https://api.clerque.cc/health`.
3. Interval: 5 minutes. Alert contacts: your email + SMS.
4. Repeat for `https://clerque.cc` (web).
5. Configure "alert when down for 2 consecutive checks" to avoid pager fatigue.

**Sentry steps:**
1. https://sentry.io → sign up (free tier ~5k errors/month, sufficient).
2. Create project: NestJS for API, Next.js for web.
3. Copy DSN to Railway env (`SENTRY_DSN`) and Vercel env (`NEXT_PUBLIC_SENTRY_DSN`).
4. Verify by introducing a test error and confirming it shows up in Sentry.
5. Set up alert rules: "more than 10 errors in 5 minutes" → email + SMS.

**Effort:** 1 hour total. **Cost:** zero (free tiers).

---

### ☐ D9-02 / D9-03 — Identify a trusted secondary technical contact
**Why:** You are currently a single point of failure for the entire platform.
If you are unavailable, no one can act on an incident.

**Steps:**
1. Identify one person — former colleague, contracted developer, or a
   technical co-founder candidate. They do not need to know the codebase
   in detail, just enough to act in an incident.
2. Sign an NDA covering source code + customer data.
3. Grant read-access to: GitHub repo, Railway project (read), Cloudflare R2
   (read), Vercel project (read).
4. Walk them through `docs/INCIDENT_RESPONSE.md` over an hour.
5. Add their contact info to the "Communication Tree" section of
   `docs/DISASTER_RECOVERY.md`.
6. Pay them for an 8-hour "shadow review" of the codebase (D9-03) where
   they write a "where to look first" runbook for their future self.
7. Refresh quarterly: confirm they still have access and still want the role.

**Effort:** ~2 days elapsed (mostly waiting on the other person). **Cost:**
8 hours × their rate (~PHP 8,000–20,000).

---

### ☐ D1-04 — Place Cloudflare in front of the API
**Why:** Application-layer DDoS protection + WAF + rate limiting at the
edge, before requests even reach Railway.

**Steps:**
1. Cloudflare → Add Site (you already have one for `hnscorpph.com`).
2. Create CNAME `api.clerque` → your Railway-supplied API hostname.
3. Enable the orange-cloud proxy on that CNAME.
4. Security → WAF → Managed Rules → Cloudflare OWASP Core Rule Set: **On**.
5. Security → Rate Limiting → add rule: `/api/v1/auth/*` → 20 requests / 10s
   per IP. Block on violation.
6. Update Railway: set custom domain to `api.clerque.cc`.
7. Update Vercel env `NEXT_PUBLIC_API_URL` to the new hostname.

**Effort:** 2 hours. **Cost:** zero (Cloudflare Free tier covers this).

---

## Medium (180-day SLA)

### ☐ D1-03 — Move throttle ledger to Redis (when horizontal-scaling)
**Trigger:** Only act on this if/when you scale Railway to >1 API instance.
The in-memory throttle ledger works fine on a single instance and is
documented as such in the operations runbook.

### ☐ D2-03 — Publish a Data Recovery SLA page
**Steps:** Add a 1-page public document at `clerque.cc/legal/sla`
stating RPO=24h, RTO=4h, retention=30 days. Link it from
Settings → Data Backups page.

### ☐ D7-02 — Add deploy-time canary + rollback runbook
**Why:** Currently a bad deploy hits all users immediately. A 5-minute
canary delay catches obvious regressions.
**Steps:** Railway → Service → Deploy → enable "graceful rollout" with
50/50 split for 5 minutes. Add a `docs/ROLLBACK.md` with the exact
`git revert + git push + railway service rollback` commands.

### ☐ D7-04 — Quarterly vendor review
**Steps:** Open `docs/VENDORS.md` every quarter, confirm each vendor still
has the contract URL and risk tier accurate, update `Last security review`
column.

### ☐ D8-01 — Forward logs to a managed platform
**Options:** Better Stack ($10/mo), Axiom (free for 500GB/month), self-hosted
Loki on Hetzner.
**Steps:** Add log-drain in Railway → forward to chosen platform endpoint.

### ☐ D9-01 — Publish security-awareness video for tenant owners
**Why:** Your tenants onboard staff. Those staff make mistakes. A 5-minute
video covering phishing, password hygiene, supervisor-PIN protection saves
a breach.
**Steps:** Record in Loom. Embed in the onboarding flow at first-login.

---

## Code/configuration items SHIPPED in the audit-remediation sprint

For reference (so you don't accidentally re-do them):

| ID | Status | What landed |
|---|---|---|
| D5-04, D5-05 | ✅ Verified | helmet + CORS allowlist already in `main.ts` |
| D5-03 | ✅ Shipped | `@nestjs/throttler` global, 30/100/600 req tiers |
| D3-05 | ✅ Shipped | `apps/api/src/auth/password-policy.ts` enforces 12-char min + breach corpus + email/name reuse rejection |
| D3-04 | ✅ Shipped | `POST /users/:id/deprovision` (atomic) — see `docs/EMPLOYEE_OFFBOARDING.md` |
| D3-06 | ✅ Shipped | `POST /auth/sessions/revoke-all-tenant` + `revoke-all-platform`, typed-slug confirmation |
| D3-02 | ✅ Shipped | MFA backend was already complete; frontend at `/settings/security` + login-page challenge prompt |
| D1-05 | ✅ Shipped | `.github/dependabot.yml` weekly npm + monthly Actions scans |
| D7-01, D2-04, D2-05, D7-03, D7-04, D10-A through D10-G | ✅ Shipped | See `docs/` folder (10 documents) |
| D5-06 | ⏳ Deferred | Idempotency keys require a DB migration; will be a dedicated sprint |
| D3-07 | ⏳ Partial | Deprovision is audit-logged via existing AuditAction enum; full coverage (JE post/reverse, year-close, payslip publish, salary change) requires new enum values via migration |
| D10-D | ⏳ Deferred | Bulk-export alert needs the expanded AuditLog from D3-07 to work cleanly |

---

## How to use this checklist

- Print this page. Stick it next to your laptop.
- Tick boxes by date, not by intention. "Done" means verified working.
- Once all Critical items are ticked, the audit opinion can lift from
  "Needs Improvement" to "Satisfactory" on the next review cycle.
- File this in `docs/` and update at the end of every quarter.
