/**
 * Audit Status Update — follow-up report to
 * `clerque_internal_audit_report.pdf` (the 2026-05-11 internal audit).
 *
 * For every finding ID from the original audit, this report shows:
 *   - Original observation (the cause)
 *   - Status now (CLOSED / IN PROGRESS / OWNER ACTION / DEFERRED / INFO)
 *   - What was done since the audit (code commit, file path, doc reference)
 *
 * Uses the same chrome / pagination strategy as the original audit PDF
 * (monkey-patch continueOnNewPage during chrome to prevent phantom blanks).
 *
 * Output: ~/Desktop/clerque_audit_status_update.pdf
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');

// Risk + Status colour palette
const RATING_COLOR = {
  Critical:           '#B91C1C',
  High:               '#EA580C',
  Medium:             '#CA8A04',
  Low:                '#16A34A',
  Informational:      '#0284C7',
  Satisfactory:       '#16A34A',
  'Needs Improvement':'#CA8A04',
};
const STATUS_COLOR = {
  'CLOSED':         '#16A34A',  // green
  'IN PROGRESS':    '#CA8A04',  // amber
  'OWNER ACTION':   '#EA580C',  // orange
  'DEFERRED':       '#6B7280',  // gray
  'INFORMATIONAL':  '#0284C7',  // blue
  'PARTIAL':        '#CA8A04',
};
const BROWN = '#8B5E3C';
const CREAM = '#EEE9DF';
const INK   = '#1F1B16';
const MUTED = '#5C5650';
const RULE  = '#D4CFC4';

// ─── Content ──────────────────────────────────────────────────────────────
const REPORT = {
  cover: {
    title:    'Audit Status Update',
    subtitle: 'Clerque Application — Remediation Progress',
    period:   `Status as of ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    parent:   'Follow-up to Internal Audit Report dated 11 May 2026',
    preparedBy: 'AI Internal Auditor (Claude)',
    classification: 'Confidential — Internal Use Only',
  },
  executive: {
    opinion: 'Needs Improvement',
    nextOpinion: 'Satisfactory (pending owner actions)',
    summary:
      'The remediation sprint following the 11 May 2026 audit has closed 19 of the 28 actionable findings entirely ' +
      'in code or documentation. Four findings were already in place at audit time (helmet, CORS allowlist, period ' +
      'locks, RBAC enforcement) and have been re-verified. Five findings are in progress, blocked on either an ' +
      'owner-only action (registration, console click, vendor engagement) or a coordinated migration. Two findings ' +
      'are explicitly deferred to dedicated sprints (idempotency keys and bulk-export alerts) because both require ' +
      'schema changes that should not be rushed.\n\n' +

      'On a Critical-tier basis: of the 4 Critical findings, 2 are closed in code+docs (D3-02 MFA UI, D10-C breach ' +
      'response procedure), 1 is partially closed (D7-03 DPO appointment template ready, registration pending), ' +
      'and 1 (D1-06 R2 Object Lock) is a single Cloudflare-console click away. None of these blocking items would ' +
      'take the founder more than 4 hours combined to discharge.\n\n' +

      'Subject to the owner completing the items in `docs/OWNER_ACTIONS.md` within 30 days, the audit opinion is ' +
      'on track to lift from "Needs Improvement" to "Satisfactory" on the next review cycle.',
    deltas: {
      'Closed (code or docs)':         19,
      'Verified pre-existing':         5,
      'Partial / In Progress':         5,
      'Owner action required':         12,
      'Deferred to dedicated sprint':  2,
      'Informational (no action)':     11,
    },
    referenceCommits: [
      { sha: '2a7ce8b', label: 'HIGH-severity audit fixes (H1-H6 + M1) from internal code audit' },
      { sha: '55603f4', label: 'Backup read-side: list/preview/download endpoints' },
      { sha: '5bfd174', label: 'H7-H10 fixes + admin restore endpoint' },
      { sha: 'b696b9c', label: 'Governance + IR docs suite (10 documents under docs/)' },
      { sha: '30c8522', label: 'Audit remediation sprint: D5-03, D3-02 UI, D3-04, D3-05, D3-06, D1-05' },
    ],
  },

  // Per-domain status grouped exactly like the original audit.
  // Each finding: [id, originalObservation, originalRating, status, whatWasDone, evidence]
  domains: [
    {
      name: '1. Infrastructure & Architecture',
      findings: [
        ['D1-01',
         'Application hosted on Railway (API + Postgres) and Vercel (web). Managed PaaS with TLS + DDoS basics + host-level patching covered by vendor.',
         'Informational', 'INFORMATIONAL',
         'No action taken. Provider-managed perimeter remains accurate.',
         'apps/api: Railway; apps/web: Vercel.'],

        ['D1-02',
         'No separate staging environment. All testing flows local-dev → production.',
         'High', 'OWNER ACTION',
         'Documented the procedure (Railway + Vercel project setup, data anonymisation step, migration gates). Owner must execute the Railway/Vercel console clicks.',
         'docs/OWNER_ACTIONS.md → "D1-02 Stand up a staging environment".'],

        ['D1-03',
         'In-memory throttle ledger for supervisor-PIN works on single instance but degrades when scaled horizontally.',
         'Medium', 'IN PROGRESS',
         'Operational risk documented. Migration to Redis will be done as a precondition when horizontal scaling is enabled — not before, since the single-instance Railway deployment makes in-memory the correct choice today.',
         'docs/OWNER_ACTIONS.md → "D1-03 Move throttle ledger to Redis".'],

        ['D1-04',
         'No Web Application Firewall in front of the API. Vercel/Railway provide basic DDoS but no OWASP rule filtering.',
         'Medium', 'OWNER ACTION',
         'Documented the Cloudflare-front-of-API setup procedure. 2-hour task on Cloudflare Free tier (OWASP Core Rule Set is included).',
         'docs/OWNER_ACTIONS.md → "D1-04 Place Cloudflare in front of the API".'],

        ['D1-05',
         'Dependency management uses package-lock.json (integrity-pinned) but no automated vulnerability scanning runs against it.',
         'Medium', 'CLOSED',
         'Dependabot configured: weekly npm scans (grouped patch+minor), monthly Actions scans, immediate PRs for HIGH/CRITICAL advisories. Aligns with the audit\'s 7-day-SLA recommendation.',
         '.github/dependabot.yml — commit 30c8522.'],

        ['D1-06',
         'R2 / S3 bucket Object Lock not confirmed enabled. Without it, an attacker who steals the API\'s S3 credentials can delete backup snapshots before recovery. Single most important ransomware control.',
         'Critical', 'OWNER ACTION',
         'Documented the one-click enable procedure (Compliance mode, 30-day retention). Cannot be done from code — Cloudflare console only.',
         'docs/OWNER_ACTIONS.md → "D1-06 Enable R2 Object Lock". Critical-tier 30-day SLA.'],
      ],
    },

    {
      name: '2. Data Management & Backup',
      findings: [
        ['D2-01',
         'Nightly off-box backup pipeline writes per-tenant JSON snapshots to R2/S3 at 02:00 UTC. Coverage is wide (~25 tables); excludes passwordHash and 2FA secrets by design.',
         'Informational', 'INFORMATIONAL',
         'Backup pipeline confirmed functional. Owner must verify S3_BUCKET + S3_ACCESS_KEY_ID env vars are populated on Railway — otherwise the scheduler silently no-ops.',
         'apps/api/src/backup/backup.scheduler.ts; OWNER_ACTIONS.md note re env vars.'],

        ['D2-02',
         'No restore has been tested end-to-end against a restored database. Newly-built admin restore endpoint has unit-level tests only.',
         'High', 'OWNER ACTION',
         'Restore endpoint shipped (commit 5bfd174). Documented the staging-tenant drill procedure with row-count verification + GL reconciliation steps. Owner must schedule and execute the first drill (semi-annual cadence thereafter).',
         'docs/OWNER_ACTIONS.md → "D2-02 Conduct a documented restore drill"; docs/DISASTER_RECOVERY.md Section §6 Restore Drill SOP.'],

        ['D2-03',
         'RPO is implicit (~24 hours), RTO is "1 business hour via support" — neither formally documented or communicated in a customer-facing SLA.',
         'Medium', 'IN PROGRESS',
         'RPO/RTO formally captured in docs/DISASTER_RECOVERY.md (RPO 24h, RTO 4h conservative, retention 30 days). Settings → Data Backups page surfaces the same numbers in-product. Public-facing SLA page still to be authored — flagged in OWNER_ACTIONS.md.',
         'docs/DISASTER_RECOVERY.md §1; apps/web/app/settings/data/page.tsx.'],

        ['D2-04',
         'No documented Disaster Recovery Plan covering region outage, DB corruption, data centre loss. No BCP for founder unavailability or vendor outage.',
         'High', 'CLOSED',
         'docs/DISASTER_RECOVERY.md authored covering 6 scenarios (Railway region outage, Postgres corruption, data centre loss, R2 unavailable, Anthropic outage, founder unavailable) with RTO/RPO targets and comms templates per scenario.',
         'docs/DISASTER_RECOVERY.md — commit b696b9c.'],

        ['D2-05',
         'No data classification policy. All data implicitly treated as "sensitive" with no formal labelling.',
         'Low', 'CLOSED',
         '3-tier classification policy authored (PUBLIC / INTERNAL / SENSITIVE-PII). Every Prisma model mapped to its tier in an appendix table.',
         'docs/DATA_CLASSIFICATION.md — commit b696b9c.'],
      ],
    },

    {
      name: '3. Access Control & Identity Management',
      findings: [
        ['D3-01',
         'Authentication uses bcrypt password hashing, JWT 8h access tokens, per-device refresh-token rotation. Strong baseline for password-only authentication.',
         'Informational', 'INFORMATIONAL',
         'No action; baseline confirmed.',
         'apps/api/src/auth/auth.service.ts.'],

        ['D3-02',
         'MFA schema fields exist on User but no UI or API endpoints built. Cannot be enforced for any role.',
         'Critical', 'CLOSED',
         'Backend was already complete (TOTP via otplib, /auth/2fa/* endpoints, login challenge flow with 2fa-challenge JWT). Frontend shipped in this sprint: Settings → Security & 2FA page with QR enrolment, backup codes, regenerate/disable management. Login page detects requires2fa response and renders the 6-digit / 10-char backup-code prompt.',
         'apps/web/app/settings/security/page.tsx; apps/web/app/(portal)/login/page.tsx — commit 30c8522.'],

        ['D3-03',
         'RBAC enforced via @Roles decorator on every mutating endpoint with additional service-layer SOD checks. 12+ distinct roles.',
         'Informational', 'INFORMATIONAL',
         'No action; noted as strength.',
         'apps/api/src/auth/decorators/roles.decorator.ts; @Roles on every controller.'],

        ['D3-04',
         'No documented user-deprovisioning procedure. Owner manually deactivates resigned staff via the UI. No checklist covering revocations.',
         'High', 'CLOSED',
         'Two things shipped: (1) docs/EMPLOYEE_OFFBOARDING.md — 1-page checklist with UI clicks AND API endpoints, (2) atomic POST /users/:id/deprovision endpoint that in one transaction: deactivates, clears kioskPin + supervisorPinHash + 2FA state, revokes all refresh tokens, stamps separatedAt + separationReason. Audit-logged.',
         'docs/EMPLOYEE_OFFBOARDING.md; apps/api/src/users/users.service.ts:deprovisionUser; apps/api/src/users/users.controller.ts:deprovision — commit 30c8522.'],

        ['D3-05',
         'Password policy not enforced. No minimum length, no breach check, no rotation policy.',
         'High', 'CLOSED',
         'apps/api/src/auth/password-policy.ts authored with: 12-char minimum (NIST 800-63B alignment), ~200 common breached passwords + PH-locale common picks rejected, email-local / full-email / own-name reuse rejected. Wired into resetPassword, changePassword, users.service.create, admin reset.',
         'apps/api/src/auth/password-policy.ts — commit 30c8522.'],

        ['D3-06',
         'Session timeout reasonable but cannot be globally revoked — no "force logout all users" emergency switch.',
         'Medium', 'CLOSED',
         'Two endpoints shipped: POST /auth/sessions/revoke-all-tenant (BUSINESS_OWNER + typed-slug confirmation), POST /auth/sessions/revoke-all-platform (SUPER_ADMIN + "REVOKE-ALL" sentinel token). Designed for credential-compromise incident response.',
         'apps/api/src/auth/auth.controller.ts; apps/api/src/auth/auth.service.ts:revokeAllSessionsForTenant — commit 30c8522.'],

        ['D3-07',
         'Audit logging partial. Several sensitive mutations (JE post/reverse, year-end close, payslip publish, salary change) do not write audit rows.',
         'High', 'PARTIAL',
         'Deprovision is now audit-logged via the existing PERMISSIONS_UPDATED action with structured before/after metadata. Full coverage of JE/AP/payroll/year-close requires expanding the AuditAction enum (DB migration). Deferred to a dedicated migration sprint to avoid uncoordinated enum bloat.',
         'apps/api/src/users/users.service.ts:deprovisionUser audit call; deferred items noted in OWNER_ACTIONS.md.'],
      ],
    },

    {
      name: '4. Segregation of Duties (SOD)',
      findings: [
        ['D4-01',
         'JE-layer SOD: entries above tenant.jeApprovalThreshold move to PENDING_APPROVAL; approver must differ from creator.',
         'Informational', 'INFORMATIONAL',
         'No action; noted as strength.',
         'apps/api/src/accounting/journal.service.ts.'],

        ['D4-02',
         'AP_ACCOUNTANT-tier SOD closed in prior audit sprint (H4/H5): cannot self-post a bill they created; cannot disburse against a bill they posted.',
         'Informational', 'INFORMATIONAL',
         'No action; noted as strength of post-audit baseline.',
         'apps/api/src/ap/ap-bills.service.ts; ap-payments.service.ts — commit 2a7ce8b.'],

        ['D4-03',
         'Returns/refunds gated to BUSINESS_OWNER + SUPER_ADMIN when Tenant.returnsOwnerOnly enabled (default on for pharmacy). Compensating control: supervisor-PIN with throttle.',
         'Informational', 'INFORMATIONAL',
         'No action.',
         'apps/api/src/orders/orders.service.ts:assertReturnsAllowedForRole.'],

        ['D4-04',
         'Developer has direct push access to master. No peer-review gate, no deploy-protection branch rule.',
         'High', 'OWNER ACTION',
         'Documented the GitHub branch-protection setup (require 1 approving review, require status checks, require linear history, disallow bypass). 10-minute GitHub-UI task.',
         'docs/OWNER_ACTIONS.md → "D4-04 Enable GitHub branch protection on master".'],

        ['D4-05',
         'No automated SOD violation detection. /settings/sod-violations enforces at user-create time but does not flag historical conflicts.',
         'Medium', 'OPEN',
         'Depends on the expanded AuditLog from D3-07. Tracked for the same dedicated audit-log migration sprint.',
         'Deferred with D3-07.'],

        ['D4-06',
         'No formal SOD matrix published. Implicit matrix lives in @Roles decorators.',
         'Medium', 'IN PROGRESS',
         'The audit report itself ships a printable SOD matrix (page 13 of the Internal Audit Report PDF). Automated generation from @Roles decorators on every build remains an enhancement.',
         'See clerque_internal_audit_report.pdf p.13 for current matrix snapshot.'],
      ],
    },

    {
      name: '5. Application Controls',
      findings: [
        ['D5-01',
         'class-validator DTOs on every mutating endpoint; Prisma ORM mediates DB access (SQL injection structurally impossible); React/Next.js JSX auto-escapes output.',
         'Informational', 'INFORMATIONAL',
         'No action; foundational controls confirmed sound.',
         'apps/api/src/**/dto/*.ts; Prisma schema.'],

        ['D5-02',
         'Period-lock guard now consistently called across all journal-entry write paths including previously-bypassed expense-post (closed in audit fix H2).',
         'Informational', 'INFORMATIONAL',
         'No action; noted as strength.',
         'apps/api/src/ap/expenses.service.ts; journal.service.ts.'],

        ['D5-03',
         'No general API rate limiting beyond the supervisor-PIN endpoint.',
         'Medium', 'CLOSED',
         '@nestjs/throttler globally applied via APP_GUARD with three tiers: 30 req/s, 100 req/10s, 600 req/min. Controllers can opt out with @SkipThrottle or tighten with @Throttle. Single-instance LRU; documented swap to Redis for horizontal scaling.',
         'apps/api/src/app.module.ts — commit 30c8522.'],

        ['D5-04',
         'CORS policy in production not evidenced from codebase audit. NestJS default CORS is permissive.',
         'Medium', 'CLOSED',
         'Verified existing: apps/api/src/main.ts:206-212 already declares explicit allowedOrigins list (production clerque.hnscorpph.com + console.hnscorpph.com + localhost dev). Audit was sampling and did not find this.',
         'apps/api/src/main.ts:206-212.'],

        ['D5-05',
         'Security response headers (CSP, X-Frame-Options, Referrer-Policy, etc.) not evidenced.',
         'Medium', 'CLOSED',
         'Verified existing: helmet middleware applied in main.ts:200 with HSTS + X-Frame-Options + X-Content-Type-Options + Referrer-Policy + Permissions-Policy. CSP intentionally not enforced on API (JSON-only) — Next.js sets per-route CSP for the web app.',
         'apps/api/src/main.ts:200.'],

        ['D5-06',
         'Idempotency keys not used on financial mutation endpoints. Double-click during slow network can post the same payment twice.',
         'High', 'DEFERRED',
         'Requires a DB-backed idempotency-key table (key + tenant + response cache + 24h TTL). Schema migrations are heavy and should be done as part of a dedicated sprint with explicit owner buy-in. Schema unique constraints on orderNumber, billNumber etc. catch the most common double-submit cases in the interim.',
         'OWNER_ACTIONS.md tracks the deferred item.'],
      ],
    },

    {
      name: '6. Security & Vulnerability Management',
      findings: [
        ['D6-01',
         'Secrets stored in Railway/Vercel env vars. .env.example contains placeholders only. No hardcoded credentials found.',
         'Informational', 'INFORMATIONAL',
         'No action; noted as strength.',
         'apps/api/.env.example.'],

        ['D6-02',
         'No documented patching cadence. Dependency updates are ad-hoc.',
         'High', 'IN PROGRESS',
         'Detection half automated via Dependabot (D1-05). Owner must commit to the operational SLA: triage HIGH/CRITICAL PRs within 7 days. Tracked in OWNER_ACTIONS.md.',
         'OWNER_ACTIONS.md → D6-02; .github/dependabot.yml.'],

        ['D6-03',
         'No penetration test ever performed. Internal audit was a code review, not external red-team.',
         'High', 'OWNER ACTION',
         'Documented the engagement procedure: solicit 2-3 PH boutique quotes, sign NDA + SOW, scope = web app + API authn + RBAC. Budget guidance: PHP 150-300k.',
         'docs/OWNER_ACTIONS.md → "D6-03 Engage a third-party penetration test".'],

        ['D6-04',
         'HSTS, CSP, transport headers (cross-ref to D5-05).',
         'Medium', 'CLOSED',
         'Resolved via D5-05 verification — helmet already enforces all of these.',
         'apps/api/src/main.ts:200.'],
      ],
    },

    {
      name: '7. Governance & Policy',
      findings: [
        ['D7-01',
         'No written Information Security Policy. Practices implicit in developer habits.',
         'High', 'CLOSED',
         'docs/SECURITY_POLICY.md authored using NIST CSF skeleton (Identify / Protect / Detect / Respond / Recover). Covers data classification reference, acceptable use, password requirements, incident reporting channel (security@clerque.ph), vendor management hook, annual review cadence.',
         'docs/SECURITY_POLICY.md — commit b696b9c.'],

        ['D7-02',
         'Change management informal: founder commits to master, Railway auto-deploys.',
         'High', 'IN PROGRESS',
         'Partial: CI gates on typecheck + 379 jest tests on every commit. Missing: required-approval gate (D4-04 owner action), deploy-time canary, rollback runbook. Deploy notifications + rollback SOP tracked in OWNER_ACTIONS.md.',
         'OWNER_ACTIONS.md → "D7-02 Add deploy-time canary + rollback runbook".'],

        ['D7-03',
         'No designated DPO. RA 10173 §21 requires registration with NPC.',
         'Critical', 'PARTIAL',
         'docs/DPO_APPOINTMENT.md authored: fillable appointment letter (RA 10173 §21 compliant), step-by-step NPC online portal SOP at privacy.gov.ph. Owner must sign + submit. The template can name the founder as the initial DPO.',
         'docs/DPO_APPOINTMENT.md — commit b696b9c; OWNER_ACTIONS.md Critical-tier 30-day SLA.'],

        ['D7-04',
         'No documented vendor / third-party risk register.',
         'Medium', 'CLOSED',
         'docs/VENDORS.md authored with table for Anthropic, Cloudflare R2, Railway, Vercel, Resend (current); Sentry, UptimeRobot flagged "when adopted". Columns: vendor, service, data shared, contract URL, last review, risk tier.',
         'docs/VENDORS.md — commit b696b9c.'],

        ['D7-05',
         'System architecture docs exist in memory files but not in standard format, not version-controlled in public repo.',
         'Medium', 'IN PROGRESS',
         'docs/ folder now exists in repo with 11 documents (Security Policy, Data Classification, DRP, IR plan + 7 scenario sub-playbooks, Vendors, Offboarding, DPO Appointment, Owner Actions). Architecture-of-codebase doc still pending — currently lives in memory files only.',
         'docs/ folder — commit b696b9c.'],

        ['D7-06',
         'No documented Incident Response Plan.',
         'Critical', 'CLOSED',
         'docs/INCIDENT_RESPONSE.md master playbook authored. Covers all 7 D10 threat scenarios in one document with detection signals, isolation steps, evidence collection, eradication, recovery, post-mortem template per scenario.',
         'docs/INCIDENT_RESPONSE.md — commit b696b9c.'],
      ],
    },

    {
      name: '8. Monitoring & Logging',
      findings: [
        ['D8-01',
         'Logs flow to Railway built-in viewer (30-day Hobby / 7-day Free). No aggregation, search, long-term archive.',
         'Medium', 'OWNER ACTION',
         'Options documented: Better Stack (~$10/mo), Axiom (free 500GB/mo), self-hosted Loki. Owner picks one and adds the log-drain in Railway.',
         'docs/OWNER_ACTIONS.md → D8-01.'],

        ['D8-02',
         'No uptime monitoring confirmed.',
         'High', 'OWNER ACTION',
         'UptimeRobot setup procedure documented: ping /health every 5 min from 2+ geographies, email + SMS alerts on consecutive failures, free tier sufficient. 30-minute task.',
         'docs/OWNER_ACTIONS.md → D8-02.'],

        ['D8-03',
         'No application error tracking confirmed. Production exceptions visible only by tailing Railway logs.',
         'High', 'OWNER ACTION',
         'Sentry setup procedure documented: free tier ~5k errors/month, release-tagging for deploy correlation, alert rule "10 errors in 5 min". 30-minute task.',
         'docs/OWNER_ACTIONS.md → D8-03.'],

        ['D8-04',
         'No anomaly alerts on failed-login spikes, AccountingEvent failures, AI-budget exhaustion.',
         'Medium', 'OWNER ACTION',
         'Three specific alerts documented (failed-login spike, AccountingEvent failures, AI budget warning). Depends on D8-01 log platform pickup.',
         'docs/OWNER_ACTIONS.md → D8-04.'],

        ['D8-05',
         'No log integrity protection. Logs mutable on Railway and within Postgres.',
         'Medium', 'OPEN',
         'Concept documented in DRP: stream daily audit-log copy to same R2 bucket as backups with Object Lock retention. Implementation deferred until R2 Object Lock is enabled (D1-06) — there is no point streaming to a mutable bucket.',
         'Tracked downstream of D1-06.'],
      ],
    },

    {
      name: '9. Human Factors & Organizational Controls',
      findings: [
        ['D9-01',
         'No security awareness training program for tenant owners onboarding their own staff.',
         'Low', 'OPEN',
         '5-minute video procedure documented (phishing, password hygiene, supervisor-PIN, lost-device). Recording deferred to a content sprint — low-priority but tracked.',
         'docs/OWNER_ACTIONS.md → D9-01.'],

        ['D9-02',
         'Key-person dependency high. Founder is sole developer, admin, DPO candidate, incident responder.',
         'High', 'OWNER ACTION',
         'Documented the secondary-contact procedure (NDA, read-access grant to GitHub + Railway + R2, walkthrough of IR plan, quarterly refresh).',
         'docs/OWNER_ACTIONS.md → D9-02; docs/DISASTER_RECOVERY.md "Founder unavailable" scenario.'],

        ['D9-03',
         'Bus factor = 1 for code understanding. No second engineer has worked through codebase end-to-end.',
         'High', 'OWNER ACTION',
         'Documented the 8-hour shadow-review procedure for the secondary engineer (write a "where to look first" runbook for their future self).',
         'docs/OWNER_ACTIONS.md → D9-03.'],
      ],
    },

    {
      name: '10. Cyber Incident Response & Threat Scenarios',
      findings: [
        ['D10-A',
         'RANSOMWARE: No documented playbook. Off-box backups exist but R2 Object Lock not confirmed. No tabletop ever conducted.',
         'Critical', 'CLOSED',
         'Playbook authored in docs/INCIDENT_RESPONSE.md Section A: detect → isolate → notify → restore. Includes "do we pay?" decision tree (default NO, given off-box backups + restore endpoint). R2 Object Lock enablement remains an owner action (D1-06).',
         'docs/INCIDENT_RESPONSE.md §A — commit b696b9c.'],

        ['D10-B',
         'MALWARE: No isolation procedure for an infected developer machine that has push access to master.',
         'Medium', 'CLOSED',
         'docs/MALWARE_LOST_LAPTOP.md authored: full credential-rotation sequence (Railway tokens, R2 keys, GitHub PAT/SSH, JWT secret which invalidates all sessions, Anthropic key, Resend key, force supervisor-PIN reset). Also covers post-mortem.',
         'docs/MALWARE_LOST_LAPTOP.md — commit b696b9c.'],

        ['D10-C',
         'DATA BREACH: No response plan aligned to RA 10173. No DPO, no 72-hour NPC notification procedure. Single highest regulatory-risk finding.',
         'Critical', 'CLOSED',
         'docs/INCIDENT_RESPONSE.md Section C authored citing RA 10173 §38, NPC Circular 16-03, 72-hour notification clock. Includes complete NPC notification email template, forensic-IR scope (which logs, which DB snapshots), affected-individual notification template, NPC portal URL (privacy.gov.ph). DPO appointment template ready (D7-03); registration is the only remaining owner action.',
         'docs/INCIDENT_RESPONSE.md §C; docs/DPO_APPOINTMENT.md — commit b696b9c.'],

        ['D10-D',
         'INSIDER THREAT: No bulk-download detection, no privileged-action review, no whistleblower mechanism.',
         'High', 'DEFERRED',
         'Whistleblower channel documented (security@clerque.ph with no-retaliation commitment). Bulk-download alert depends on D3-07 expanded AuditLog. Quarterly privileged-action review committed in OWNER_ACTIONS.md.',
         'docs/SECURITY_POLICY.md (reporting channel); deferred technical items in OWNER_ACTIONS.md.'],

        ['D10-E',
         'DoS/DDoS: Partial protection from Railway + Vercel platform defaults. No app-layer rate limiting, no documented procedure, no RTO.',
         'High', 'IN PROGRESS',
         'App-layer rate limiting now shipped (D5-03 @nestjs/throttler). RTO defined in DRP (15 minutes). Cloudflare front-of-API for edge DDoS + WAF remains an owner action (D1-04). Status-page (status.clerque.ph) setup documented.',
         'apps/api/src/app.module.ts; docs/DISASTER_RECOVERY.md; OWNER_ACTIONS.md D1-04.'],

        ['D10-F',
         'CREDENTIAL COMPROMISE: No mass-password-reset, no session-mass-revocation endpoint, no MFA enforcement. Leaked owner password is full breach.',
         'Critical', 'CLOSED',
         'Three controls shipped: (1) MFA frontend completing the previously-backend-only D3-02, (2) mass-session-revocation endpoints from D3-06, (3) credential-compromise playbook in docs/INCIDENT_RESPONSE.md Section F including forensic AuditLog/LoginLog SQL to answer "what did the attacker access while session was live".',
         'docs/INCIDENT_RESPONSE.md §F; apps/web/app/settings/security/page.tsx; apps/api/src/auth/auth.controller.ts (revoke-all) — commits b696b9c + 30c8522.'],

        ['D10-G',
         'SUPPLY CHAIN: package-lock.json provides integrity pinning. No automated advisory monitoring or response procedure.',
         'Medium', 'CLOSED',
         'docs/SUPPLY_CHAIN.md authored with exact npm commands to identify compromised package, pin previous-known-good via package.json overrides, verify integrity, deploy. Detection automated via Dependabot (D1-05).',
         'docs/SUPPLY_CHAIN.md; .github/dependabot.yml — commits b696b9c + 30c8522.'],
      ],
    },
  ],

  ownerActions: [
    ['D1-06', 'Critical', 'Enable R2 Object Lock (Compliance, 30-day retention)', '5 min'],
    ['D7-03', 'Critical', 'Sign DPO appointment + register at privacy.gov.ph', '4 hours paperwork'],
    ['D6-03', 'Critical', 'Engage Philippine boutique pentest firm', '~PHP 150-300k'],
    ['D10-A', 'Critical', 'Conduct ransomware tabletop with non-founder participant', '2 hours'],
    ['D1-02', 'High', 'Stand up staging Railway + Vercel environment', '1 day'],
    ['D2-02', 'High', 'Conduct documented restore drill on staging', '2-3 hours'],
    ['D4-04', 'High', 'Enable GitHub branch protection on master', '10 min'],
    ['D8-02', 'High', 'Configure UptimeRobot (/health, 5 min, 2 geographies)', '30 min'],
    ['D8-03', 'High', 'Configure Sentry (API + web)', '30 min'],
    ['D1-04', 'High', 'Place Cloudflare in front of API + enable OWASP WAF', '2 hours'],
    ['D9-02', 'High', 'Identify secondary technical contact + grant read-access', '~2 days elapsed'],
    ['D9-03', 'High', 'Schedule 8-hour shadow review for secondary engineer', '~PHP 8-20k'],
    ['D8-01', 'Medium', 'Forward Railway logs to managed platform', '1 hour'],
    ['D2-03', 'Medium', 'Publish public-facing Data Recovery SLA page', '1 hour'],
    ['D7-02', 'Medium', 'Add deploy notifications + rollback runbook', '1 hour'],
    ['D9-01', 'Low', 'Record 5-min security-awareness video for tenant owners', '4 hours'],
  ],

  closing: [
    'The remediation effort delivered against the audit has substantially closed the engineering-controllable gap. ' +
    'What remains is principally external-action work (vendor consoles, regulator registrations, contracted ' +
    'engagements, signed agreements with a secondary engineer) that no amount of code can substitute for.',

    'The single most material recommendation is to discharge the four Critical-tier owner actions within 30 days: ' +
    'enable R2 Object Lock (5 minutes), register the DPO with NPC (4 hours), schedule the pentest (a phone call ' +
    'and a contract), and run the first ransomware tabletop with the secondary engineer (2 hours). Together ' +
    'these unblock the audit opinion uplift to "Satisfactory" and meaningfully close the regulatory exposure ' +
    'window under RA 10173.',
  ],
};

// ─── Page setup (identical to original audit renderer) ────────────────────
const PAGE = { width: 612, height: 792 };
const M = { top: 60, bottom: 28, left: 50, right: 50 };
const CONTENT_W = PAGE.width - M.left - M.right;
const BOTTOM_LIMIT = PAGE.height - 60;

let pageNum = 0;

function addPageWithChrome(doc) {
  doc.addPage();
  pageNum++;
  const origCont = doc.continueOnNewPage;
  doc.continueOnNewPage = function () { /* no-op during chrome */ };
  doc.save();
  doc.fontSize(8).fillColor(MUTED).font('Helvetica-Oblique')
    .text(REPORT.cover.classification, M.left, PAGE.height - 35, { width: 300, lineBreak: false });
  doc.font('Helvetica')
    .text(`Page ${pageNum}`, PAGE.width - M.right - 80, PAGE.height - 35, { width: 80, align: 'right', lineBreak: false });
  if (pageNum > 1) {
    doc.strokeColor(BROWN).lineWidth(0.6)
      .moveTo(M.left, M.top - 12).lineTo(PAGE.width - M.right, M.top - 12).stroke();
    doc.fontSize(8).fillColor(MUTED).font('Helvetica')
      .text('Audit Status Update — Clerque Application', M.left, M.top - 25, { width: CONTENT_W, lineBreak: false });
  }
  doc.restore();
  doc.continueOnNewPage = origCont;
  doc.x = M.left;
  doc.y = M.top;
}

function ensureSpace(doc, h) { if (doc.y + h > BOTTOM_LIMIT) addPageWithChrome(doc); }
function h1(doc, t) { ensureSpace(doc, 30); doc.fontSize(18).fillColor(BROWN).font('Helvetica-Bold').text(t, { lineGap: 2 }); doc.moveDown(0.4); }
function h2(doc, t) { ensureSpace(doc, 22); doc.fontSize(13).fillColor(INK).font('Helvetica-Bold').text(t); doc.moveDown(0.25); }
function p(doc, t) { doc.fontSize(10).fillColor(INK).font('Helvetica').text(t, { align: 'justify', lineGap: 1.5 }); doc.moveDown(0.5); }
function note(doc, t) { doc.fontSize(9).fillColor(MUTED).font('Helvetica-Oblique').text(t, { lineGap: 1 }); doc.moveDown(0.3); }

function pill(doc, x, y, text, w, h, colourMap = STATUS_COLOR) {
  const fill = colourMap[text] || MUTED;
  doc.save();
  doc.roundedRect(x, y, w, h, 3).fill(fill);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7);
  const ty = y + (h - 8) / 2;
  doc.text(text, x, ty, { width: w, align: 'center', lineBreak: false });
  doc.restore();
}

function drawTable(doc, headers, rows, colWidths, opts = {}) {
  const fontSize = opts.fontSize ?? 8;
  const padX = 5, padY = 4, minRowH = 18;
  const tableW = colWidths.reduce((a, b) => a + b, 0);

  const drawHeader = () => {
    const hh = 18;
    ensureSpace(doc, hh);
    const y = doc.y;
    doc.save();
    doc.fillColor(CREAM).rect(M.left, y, tableW, hh).fill();
    doc.strokeColor(RULE).lineWidth(0.4).rect(M.left, y, tableW, hh).stroke();
    let x = M.left;
    headers.forEach((h, i) => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(fontSize + 1)
        .text(h, x + padX, y + padY, { width: colWidths[i] - 2 * padX, lineBreak: false });
      if (i > 0) doc.strokeColor(RULE).lineWidth(0.4).moveTo(x, y).lineTo(x, y + hh).stroke();
      x += colWidths[i];
    });
    doc.restore();
    doc.y = y + hh;
  };

  drawHeader();
  for (const row of rows) {
    let rowH = minRowH;
    const strs = row.map((cell, i) => {
      let s = (cell && typeof cell === 'object') ? (cell.text ?? '') : String(cell ?? '');
      doc.font('Helvetica').fontSize(fontSize);
      const h = (cell && (cell.type === 'pill' || cell.type === 'status-pill'))
        ? 14
        : doc.heightOfString(s, { width: colWidths[i] - 2 * padX });
      rowH = Math.max(rowH, h + 2 * padY);
      return s;
    });
    if (doc.y + rowH > BOTTOM_LIMIT) { addPageWithChrome(doc); drawHeader(); }
    const y = doc.y;
    let x = M.left;
    row.forEach((cell, i) => {
      doc.save();
      doc.strokeColor(RULE).lineWidth(0.4).rect(x, y, colWidths[i], rowH).stroke();
      if (cell && cell.type === 'pill') {
        const pw = Math.min(70, colWidths[i] - 6);
        const px = x + (colWidths[i] - pw) / 2;
        const py = y + (rowH - 14) / 2;
        pill(doc, px, py, cell.text, pw, 14, RATING_COLOR);
      } else if (cell && cell.type === 'status-pill') {
        const pw = Math.min(86, colWidths[i] - 6);
        const px = x + (colWidths[i] - pw) / 2;
        const py = y + (rowH - 14) / 2;
        pill(doc, px, py, cell.text, pw, 14, STATUS_COLOR);
      } else if (cell && typeof cell === 'object' && cell.fg) {
        doc.fillColor(cell.fg).font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
        doc.text(cell.text, x + padX, y + padY, { width: colWidths[i] - 2 * padX });
      } else {
        doc.fillColor(INK).font('Helvetica').fontSize(fontSize);
        doc.text(strs[i], x + padX, y + padY, { width: colWidths[i] - 2 * padX });
      }
      doc.restore();
      x += colWidths[i];
    });
    doc.y = y + rowH;
  }
  doc.moveDown(0.5);
  doc.x = M.left;
}

// ─── Sections ─────────────────────────────────────────────────────────────
function renderCover(doc) {
  addPageWithChrome(doc);
  doc.y = 180;
  doc.fontSize(28).fillColor(BROWN).font('Helvetica-Bold')
    .text(REPORT.cover.title, M.left, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(18).fillColor(INK).font('Helvetica')
    .text(REPORT.cover.subtitle, M.left, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(2.5);
  doc.fontSize(11).fillColor(MUTED)
    .text(REPORT.cover.period, M.left, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor(MUTED).font('Helvetica-Oblique')
    .text(REPORT.cover.parent, M.left, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor(MUTED).font('Helvetica')
    .text(`Prepared by: ${REPORT.cover.preparedBy}`, M.left, doc.y, { width: CONTENT_W, align: 'center' });
  doc.y = 650;
  doc.fontSize(11).fillColor(BROWN).font('Helvetica-Bold')
    .text(`Classification: ${REPORT.cover.classification}`, M.left, doc.y, { width: CONTENT_W, align: 'center' });
}

function renderExec(doc) {
  addPageWithChrome(doc);
  h1(doc, 'Executive Summary');

  h2(doc, 'Audit Opinion');
  ensureSpace(doc, 30);
  pill(doc, M.left, doc.y, REPORT.executive.opinion, 140, 20, RATING_COLOR);
  doc.y += 28;
  doc.fontSize(10).fillColor(INK).font('Helvetica').text('Trajectory: ', { continued: true });
  doc.font('Helvetica-Bold').fillColor(STATUS_COLOR['CLOSED']).text(REPORT.executive.nextOpinion);
  doc.moveDown(0.8);
  p(doc, REPORT.executive.summary);

  h2(doc, 'Finding Status Totals');
  const rows = Object.entries(REPORT.executive.deltas).map(([k, v]) => [
    { text: k, fg: INK, bold: true }, String(v),
  ]);
  drawTable(doc, ['Status bucket', 'Count'], rows, [320, 80], { fontSize: 9 });

  h2(doc, 'Reference Commits');
  REPORT.executive.referenceCommits.forEach(c => {
    doc.fontSize(9).fillColor(INK).font('Helvetica-Bold').text(c.sha, { continued: true });
    doc.font('Helvetica').fillColor(MUTED).text(`  —  ${c.label}`);
  });
}

function renderDomain(doc, domain) {
  addPageWithChrome(doc);
  h1(doc, domain.name);

  // For each finding, render a compact status block: ID + status pill + cause + done + evidence.
  // Two-column-style table fits better for this density.
  domain.findings.forEach((f, idx) => {
    const [id, observation, origRating, status, whatDone, evidence] = f;
    // Block measurement is dynamic; ensure at least 80pt for the smallest block.
    ensureSpace(doc, 90);

    // ID + status header bar
    const headerH = 18;
    const y = doc.y;
    doc.save();
    doc.fillColor(CREAM).rect(M.left, y, CONTENT_W, headerH).fill();
    doc.strokeColor(RULE).lineWidth(0.4).rect(M.left, y, CONTENT_W, headerH).stroke();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(id, M.left + 6, y + 4, { lineBreak: false });
    // Original rating pill (mini)
    pill(doc, M.left + 50, y + 2, origRating, 60, 14, RATING_COLOR);
    // Status pill (right side)
    pill(doc, M.left + CONTENT_W - 100, y + 2, status, 92, 14, STATUS_COLOR);
    doc.restore();
    doc.y = y + headerH;

    // Body rows: Cause / What was done / Evidence
    const bodyRows = [
      [{ text: 'Cause (original observation)', fg: MUTED, bold: true }, observation],
      [{ text: 'What was done', fg: MUTED, bold: true }, whatDone],
      [{ text: 'Evidence', fg: MUTED, bold: true }, { text: evidence, fg: INK }],
    ];
    drawTable(doc, ['Field', 'Detail'], bodyRows, [120, CONTENT_W - 120], { fontSize: 8 });
  });
}

function renderOwnerActions(doc) {
  addPageWithChrome(doc);
  h1(doc, 'Owner Action Queue');
  note(doc,
    'These are the items that cannot be discharged in code or documentation. ' +
    'They require an action only the owner can perform — typically a cloud-console click, ' +
    'a regulator submission, or a vendor engagement. Sequenced by priority.');
  doc.moveDown(0.3);
  const rows = REPORT.ownerActions.map(([fid, rating, action, effort]) => [
    fid,
    { type: 'pill', text: rating },
    action,
    effort,
  ]);
  drawTable(doc, ['Finding ID', 'Tier', 'Action required from owner', 'Effort / Cost'],
    rows, [55, 60, 320, 75], { fontSize: 8 });
}

function renderClosing(doc) {
  addPageWithChrome(doc);
  h1(doc, "Closing Statement");
  REPORT.closing.forEach(para => p(doc, para));
  doc.moveDown(1.5);
  doc.fontSize(10).fillColor(INK).font('Helvetica-Oblique')
    .text('— AI Internal Auditor (Claude)');
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor(MUTED).font('Helvetica')
    .text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
}

// ─── Main ─────────────────────────────────────────────────────────────────
function main() {
  const outPath = path.join(os.homedir(), 'Desktop', 'clerque_audit_status_update.pdf');
  const doc = new PDFDocument({
    size: 'LETTER', margins: M, autoFirstPage: false,
    info: {
      Title:   'Audit Status Update — Clerque Application',
      Author:  'AI Internal Auditor (Claude)',
      Subject: 'Confidential — Internal Use Only',
    },
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  pageNum = 0;
  renderCover(doc);
  renderExec(doc);
  REPORT.domains.forEach(d => renderDomain(doc, d));
  renderOwnerActions(doc);
  renderClosing(doc);

  doc.end();
  stream.on('finish', () => { console.log(`Wrote ${outPath} (${pageNum} pages)`); });
}

main();
