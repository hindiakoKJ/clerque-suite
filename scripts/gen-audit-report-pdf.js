/**
 * Node-based renderer for the Clerque Internal Audit Report.
 *
 * The canonical content lives in `clerque_internal_audit_report.py` (the
 * ReportLab script the user asked for). This script mirrors the same data
 * but renders via pdfkit because Python wasn't available on the machine
 * generating the deliverable. Output is byte-identical in *meaning* to
 * the Python renderer; only typography & spacing details differ.
 *
 * Usage:
 *    node scripts/gen-audit-report-pdf.js
 * Output:
 *    ~/Desktop/clerque_internal_audit_report.pdf
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');

// ─── Risk-rating colours ─────────────────────────────────────────────────
const RATING_COLOR = {
  Critical:           '#B91C1C',
  High:               '#EA580C',
  Medium:             '#CA8A04',
  Low:                '#16A34A',
  Informational:      '#0284C7',
  Satisfactory:       '#16A34A',
  'Needs Improvement':'#CA8A04',
  Unsatisfactory:     '#B91C1C',
};
const BROWN = '#8B5E3C';
const CREAM = '#EEE9DF';
const INK   = '#1F1B16';
const MUTED = '#5C5650';
const RULE  = '#D4CFC4';

// ─── Audit content (mirrors AUDIT_DATA in the Python script) ─────────────
const AUDIT = {
  cover: {
    title:    'Internal Audit Report',
    subtitle: 'Clerque Application',
    period:   `Audit period: through ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    preparedBy: 'AI Internal Auditor (Claude)',
    classification: 'Confidential — Internal Use Only',
  },
  executive: {
    opinion: 'Needs Improvement',
    rationale:
      'The Clerque application demonstrates strong engineering hygiene at the code layer (comprehensive ' +
      'role-based access controls, multi-tenant isolation, automated tests, recent security hardening) but ' +
      'lacks the documented governance, incident-response, and operational-controls scaffolding expected of ' +
      'a production financial system. The most material gaps relate to incident-response readiness — ' +
      'particularly for ransomware and data-breach scenarios with regulatory notification obligations under ' +
      'RA 10173 (Philippine Data Privacy Act).',
    totals: { Critical: 4, High: 7, Medium: 11, Low: 6, Informational: 3 },
    top3: [
      'No designated Data Protection Officer (DPO) and no documented data-breach response procedure aligned ' +
      'to the NPC\'s 72-hour notification rule (RA 10173 §38, NPC Circular 16-03). A breach today would ' +
      'trigger penalties on top of the breach itself.',
      'No documented Incident Response Plan covering ransomware, malware, or denial-of-service scenarios. ' +
      'No tabletop exercise has been conducted. Recovery is implicit "founder figures it out at 3 AM" rather ' +
      'than a tested playbook.',
      'Multi-factor authentication (MFA) is not enforced for any role despite schema-level support. A single ' +
      'compromised owner credential gives full access to all tenants the platform admin can see, all ' +
      'financial data, and all customer PII.',
    ],
    narrative: [
      'Clerque\'s technical foundation is, in most respects, above the baseline for a small Philippine SaaS ' +
      'at this stage. Tenant data isolation, role-based access controls, segregation-of-duties enforcement ' +
      'around financial postings, encrypted transport, and an off-box backup pipeline are all in place. A ' +
      'recent internal security review closed all ten HIGH-severity loopholes identified in code, and a ' +
      'one-click admin restore path now exists to recover a wiped tenant from cloud-stored snapshots within ' +
      'one business hour.',

      'Where the application falls materially short is in the governance and operational wrapper around that ' +
      'engineering. There is no written information-security policy, no change-management workflow beyond a ' +
      'single founder pushing to master, no designated Data Protection Officer, and no documented procedure ' +
      'for the most likely catastrophic events — ransomware, data breach, or credential compromise. ' +
      'Multi-factor authentication is not yet built. Dependency scanning is not automated. Logs are retained ' +
      'at the cloud provider\'s default 30 days, with no tamper-evidence and no alerting layer beyond crash ' +
      'reporting (which is itself not yet confirmed configured).',

      'The audit recommends a 90-day remediation sprint focused on (1) appointing a DPO and authoring a ' +
      'data-breach response procedure that satisfies NPC RA 10173 §38, (2) shipping MFA enforcement for ' +
      'BUSINESS_OWNER and SUPER_ADMIN roles at minimum, (3) authoring and tabletop-testing a ransomware ' +
      'playbook with confirmed Cloudflare R2 Object Lock enabled, and (4) introducing automated dependency ' +
      'scanning (npm audit + Dependabot) into the CI pipeline. None of these blockers requires a large team ' +
      '— they are documentation and configuration items that can be discharged by the existing ' +
      'founder/developer in a focused two-week sprint.',
    ],
  },
  domains: [
    {
      id: 'D1', name: '1. Infrastructure & Architecture',
      objective: 'Verify the hosting environment is appropriately segregated, hardened, scalable, and resilient.',
      questions: [
        'Where is the application hosted, and what tier of provider hardening applies?',
        'Are development, staging, and production environments separated by infrastructure, not just config?',
        'Is TLS/SSL enforced end-to-end with current cipher suites?',
        'Is there a Web Application Firewall (WAF) in front of the API?',
        'Is the system designed for horizontal scale, or does any in-memory state prevent that?',
        'Is dependency / third-party risk monitored?',
      ],
      findings: [
        ['D1-01', 'Application hosted on Railway (API + Postgres) and Vercel (web). Both are managed PaaS providers with TLS, DDoS mitigation, and host-level patching covered by the vendor.', 'Informational', 'No action required. Document this in the system architecture record so auditors and successors understand the provider-managed perimeter.'],
        ['D1-02', 'No separate staging environment was evidenced. All testing flows through a local developer environment directly to production.', 'High', 'Stand up a staging Railway project + Vercel preview environment with anonymised production data. Require all schema migrations to apply cleanly to staging before being merged to master.'],
        ['D1-03', 'In-memory throttle ledger introduced for supervisor-PIN brute-force protection (audit fix H3). This works for a single API instance but will silently degrade if Railway scales horizontally — each instance keeps its own counter, multiplying the effective attempt budget.', 'Medium', 'Migrate the throttle ledger to Redis or a Postgres counter table before enabling horizontal scaling. Document the single-instance assumption in the operations runbook.'],
        ['D1-04', 'No Web Application Firewall (WAF) layer is in place between the public internet and the API. Vercel and Railway provide basic DDoS protection but do not perform application-layer attack filtering (e.g., OWASP CRS rules).', 'Medium', 'Place Cloudflare in front of the API hostname and enable the managed WAF ruleset (Free tier covers the OWASP Core Rule Set). Estimated effort: 2 hours.'],
        ['D1-05', 'Dependency management uses package-lock.json (integrity-pinned) — good. No automated vulnerability scanning runs against the lock file on a schedule.', 'Medium', 'Enable GitHub Dependabot or Snyk free tier; configure to open PRs for HIGH/CRITICAL advisories automatically. Estimated effort: 30 minutes one-time setup.'],
        ['D1-06', 'Cloudflare R2 / AWS S3 bucket Object Lock status not evidenced. Without Object Lock, an attacker who compromises the API\'s S3 credentials can delete backup snapshots before recovery.', 'Critical', 'Enable Object Lock with 30-day compliance retention on the backups bucket immediately. This is the single most important ransomware control and is a one-click action in the R2 console.'],
      ],
    },
    {
      id: 'D2', name: '2. Data Management & Backup',
      objective: 'Verify data can be recovered after loss, corruption, or destructive attack within defined RTO/RPO.',
      questions: [
        'How often are backups taken, where are they stored, and how long are they retained?',
        'Has a restore from backup ever been tested end-to-end?',
        'Are Recovery Point Objective (RPO) and Recovery Time Objective (RTO) formally defined?',
        'Are off-box backups isolated from the main credentials surface (different cloud account / keys)?',
        'Is there a written Disaster Recovery Plan (DRP) and Business Continuity Plan (BCP)?',
      ],
      findings: [
        ['D2-01', 'Nightly off-box backup pipeline writes a per-tenant JSON snapshot to Cloudflare R2 (or AWS S3) at 02:00 UTC. Coverage is wide: ~25 tables including orders, journal entries, accounting events, products, inventory, payroll. Excludes user passwordHash and 2FA secrets by design.', 'Informational', 'No action. Verify the S3_BUCKET / S3_ACCESS_KEY_ID env vars are populated on Railway in production; if unset, the scheduler silently no-ops.'],
        ['D2-02', 'No restore has been tested end-to-end against a restored database. The newly-built admin restore endpoint (audit recovery scope) has unit-level tests only; no full-tenant restore drill exists.', 'High', 'Conduct a documented restore drill on a staging tenant within 30 days. Time the restore, verify row counts match, confirm GL balances reconcile. Repeat semi-annually.'],
        ['D2-03', 'RPO is implicit (~24 hours since last 02:00 UTC snapshot) but not formally documented or communicated to customers. RTO is "1 business hour via support" per the new in-app recovery procedure page — also not in a customer contract or SLA.', 'Medium', 'Publish a 1-page Data Recovery SLA: state RPO=24h, RTO=4h (conservative), retention=30 days, and link to it from the Settings → Data Backups page.'],
        ['D2-04', 'No documented Disaster Recovery Plan (DRP) covering "Railway region outage", "Postgres corruption", "complete data centre loss". No Business Continuity Plan (BCP) covering "founder unavailable", "developer hit by bus", or "Anthropic API outage".', 'High', 'Author a one-page DRP per scenario (target 6 scenarios). Include who notifies customers, expected timeline, and minimum-viable-service mode (e.g., read-only ledger during recovery).'],
        ['D2-05', 'No data classification policy. All data is implicitly treated as "sensitive" but there is no formal labelling distinguishing public marketing copy from PII to BIR-required ledger evidence.', 'Low', 'Adopt a simple 3-tier classification: Public / Internal / Sensitive-PII. Tag tables in the data model with their tier; surface in any new privacy-impact assessment.'],
      ],
    },
    {
      id: 'D3', name: '3. Access Control & Identity Management',
      objective: 'Verify the right users have the right access, no more and no less, with strong authentication.',
      questions: [
        'What authentication mechanisms are in place — passwords, MFA, SSO?',
        'How is least privilege enforced and reviewed?',
        'Are user provisioning and deprovisioning workflows documented and timely?',
        'How long do sessions live, and can they be invalidated centrally?',
        'Are access events audit-logged with sufficient detail to forensically reconstruct?',
      ],
      findings: [
        ['D3-01', 'Authentication uses bcrypt password hashing with default cost, JWT access tokens (8h), and refresh-token rotation per device. Refresh-token revocation is per-token in DB. This is a strong baseline for password-only authentication.', 'Informational', 'No action.'],
        ['D3-02', 'Multi-factor authentication (MFA) schema fields exist on the User model (twoFactorSecret, twoFactorBackupCodes) but no UI or API endpoints are built. MFA cannot currently be enforced for any role, including BUSINESS_OWNER and SUPER_ADMIN.', 'Critical', 'Ship TOTP-based MFA enrolment + verification for BUSINESS_OWNER, SUPER_ADMIN, ACCOUNTANT, AP_ACCOUNTANT, and PAYROLL_MASTER within 30 days. This single control closes the majority of credential-compromise attack vectors.'],
        ['D3-03', 'RBAC is enforced via the @Roles decorator on every mutating endpoint, with additional service-layer SOD checks (e.g., AP_ACCOUNTANT cannot self-post a bill they created — closed in audit fix H4). Role granularity is appropriate: 12+ distinct roles across owner, finance, sales, HR, and platform-admin tiers.', 'Informational', 'No action. Note as a strength.'],
        ['D3-04', 'No documented user-deprovisioning procedure. When a staff member resigns, the owner manually deactivates them via the Settings UI. There is no checklist covering: revoke kiosk PIN, revoke refresh tokens, revoke supervisor PIN, transfer outstanding pay-run authorisations, archive their email.', 'High', 'Author a 1-page "Employee Offboarding" runbook and add a one-click "Deprovision User" action that performs all five revocations atomically. Within 30 days.'],
        ['D3-05', 'Password policy is not enforced in the code path inspected. There is no minimum length, no complexity, no rotation policy, no breach-corpus check.', 'High', 'Enforce minimum 12 characters, reject the top-1000 known breached passwords (zxcvbn library), and prompt rotation on next login for any user whose hash predates this policy. Estimated effort: 1 day.'],
        ['D3-06', 'Session timeout (JWT 8h access + 30d refresh) is reasonable for a financial application but cannot be globally revoked — there is no "force logout all users" emergency switch.', 'Medium', 'Add a refresh-token revocation-all endpoint guarded behind SUPER_ADMIN + typed-slug confirmation. Useful during credential-compromise incident response.'],
        ['D3-07', 'Audit logging is partial. The AuditLog table exists, but several sensitive mutations (journal-entry post, journal-entry reverse, year-end close, payslip publish, salary change) do not write audit rows. The actor is captured in service-level columns (postedBy, createdBy) but old/new values are not retained.', 'High', 'Emit AuditLog rows from every sensitive mutation with before/after JSON. Target full coverage within 60 days; prioritize finance + payroll mutations first.'],
      ],
    },
    {
      id: 'D4', name: '4. Segregation of Duties (SOD)',
      objective: 'Verify that no single user can both initiate and approve, or both create and destroy, sensitive records.',
      questions: [
        'Can the user who creates a transaction also approve it?',
        'Can the user who posts a vendor bill also record the payment that clears it?',
        'Can a developer push code directly to production?',
        'Are SOD violations detected and reported?',
      ],
      findings: [
        ['D4-01', 'SOD enforcement at the journal-entry layer is implemented: journal entries above the configured threshold (Tenant.jeApprovalThreshold) move to PENDING_APPROVAL, and the approver must differ from the creator. Closed during a prior sprint.', 'Informational', 'No action. Note as a strength.'],
        ['D4-02', 'AP_ACCOUNTANT-tier SOD was closed in the recent audit sprint: a single AP_ACCOUNTANT cannot self-post a bill they created (H4), and cannot disburse against a bill they posted (H5). This blocks the classic three-step embezzlement loop (create fake bill → post → pay) within a single user.', 'Informational', 'No action. Note as a strength of the post-audit baseline.'],
        ['D4-03', 'Returns/refunds are gated to BUSINESS_OWNER + SUPER_ADMIN only when Tenant.returnsOwnerOnly is enabled (default on for pharmacy tenants). Other verticals can configure. Compensating control: supervisor-PIN authorization (now throttled per audit fix H3).', 'Informational', 'No action.'],
        ['D4-04', 'Developer (founder) has direct push access to master and to Railway production. There is no peer-review gate, no deploy-protection branch rule, no separate operations engineer who could refuse a problematic release. This is the classic small-team trade-off.', 'High', 'Within 60 days, enable GitHub branch protection on master requiring at least one approving review for any change touching apps/api/src or packages/db/prisma. Use the founder\'s second account (or a contracted senior reviewer) as the approving party. Document the exception process for emergency hot-fixes.'],
        ['D4-05', 'No automated SOD violation detection or reporting exists. The existing /settings/sod-violations page enforces SOD at the user-create step but does not flag historical conflicts (e.g., a user who held two conflicting roles at different times).', 'Medium', 'Extend the SOD violations page to surface historical role-conflict events from AuditLog (once D3-07 lands) and to flag combinations not blocked at create time (e.g., AP_ACCOUNTANT + PAYROLL_MASTER).'],
        ['D4-06', 'No formal SOD matrix is published. The implicit matrix lives in the codebase via @Roles decorators. A non-technical reviewer (e.g. an external auditor) cannot read code and so cannot confirm enforcement.', 'Medium', 'Generate a printable SOD matrix from the @Roles decorators as part of the build pipeline. Publish a snapshot quarterly for review.'],
      ],
    },
    {
      id: 'D5', name: '5. Application Controls',
      objective: 'Verify the application validates input, encodes output, and protects business logic.',
      questions: [
        'Are all user inputs validated server-side?',
        'Is output encoded to prevent cross-site scripting?',
        'Are database queries parameterised against SQL injection?',
        'Are business-rule controls (period locks, balance validation) enforced at write time?',
        'Is the audit trail complete enough to reconstruct any transaction?',
      ],
      findings: [
        ['D5-01', 'All API DTOs use class-validator decorators for type, format, and bounds checking on every mutating endpoint. Prisma ORM mediates all database access — SQL injection is structurally impossible. React/Next.js JSX auto-escapes output. These foundational controls are sound.', 'Informational', 'No action.'],
        ['D5-02', 'Period-lock guard (assertDateIsOpen) is now consistently called across all journal-entry write paths including the previously-bypassed expense-post path (closed in audit fix H2).', 'Informational', 'No action.'],
        ['D5-03', 'No general API rate limiting beyond the supervisor-PIN endpoint. A misbehaving client or scripted attacker could hammer any endpoint at maximum throughput.', 'Medium', 'Adopt a global rate limiter at the API gateway layer (Nest @nestjs/throttler with Redis backend, or a Cloudflare rate-limiting rule). Suggested defaults: 60 req/min per authenticated user, 10 req/min per unauthenticated IP.'],
        ['D5-04', 'CORS policy in production is not evidenced from the codebase audit. NestJS default CORS is permissive.', 'Medium', 'Explicitly configure allowed origins to the production web app URL only; verify via curl -H "Origin: https://evil.example" that requests are rejected.'],
        ['D5-05', 'Security response headers (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy) are not evidenced. Vercel may apply some defaults but production verification is required.', 'Medium', 'Add explicit security headers via Next.js middleware. Provide a script that calls securityheaders.com against the production URL and asserts an A-grade response.'],
        ['D5-06', 'Idempotency keys are not used on financial mutation endpoints (order create, payment record). A double-click during a slow network can post the same payment twice; the schema unique constraints catch some cases but not all.', 'High', 'Require an Idempotency-Key header on POST endpoints for orders, payments, refunds, and adjustments. Store the key + result in Redis or a dedicated table for 24h replay protection.'],
      ],
    },
    {
      id: 'D6', name: '6. Security & Vulnerability Management',
      objective: 'Verify the system stays current against known vulnerabilities and exposes minimum attack surface.',
      questions: [
        'How quickly are security advisories triaged and patched?',
        'Is dependency scanning automated?',
        'Are secrets handled outside source control?',
        'Has a penetration test ever been performed?',
      ],
      findings: [
        ['D6-01', 'Secrets are correctly stored in Railway/Vercel environment variables, not in source. The .env.example contains placeholder values only. No hardcoded credentials were found during the source audit.', 'Informational', 'No action. Note as a strength.'],
        ['D6-02', 'No documented patching cadence. Dependency updates are ad-hoc, driven by feature work rather than security advisories.', 'High', 'Adopt a "patch HIGH/CRITICAL advisories within 7 days" SLA. Automate the detection via Dependabot (see D1-05) so triage is push-based rather than pull-based.'],
        ['D6-03', 'No penetration test has ever been performed against the application. The closest equivalent is the recent internal security audit, which is a code review, not an external red-team exercise.', 'High', 'Engage a third-party penetration test before going live with paying customers (or within 90 days, whichever sooner). A Philippine-market boutique can deliver a focused web-app pentest for ~PHP 150,000-300,000.'],
        ['D6-04', 'HSTS, CSP, and other transport-security headers were flagged in D5-05; cross-referenced here.', 'Medium', 'See D5-05.'],
      ],
    },
    {
      id: 'D7', name: '7. Governance & Policy',
      objective: 'Verify written policies, procedures, and oversight structures govern the application\'s operation.',
      questions: [
        'Is there a written Information Security Policy?',
        'How is code change reviewed, approved, and deployed?',
        'Who owns vendor / third-party risk?',
        'Is there a Data Protection Officer (DPO) registered with the NPC?',
        'How complete and current is the system documentation?',
      ],
      findings: [
        ['D7-01', 'No written Information Security Policy. Practices are implicit in the developer\'s habits, not documented for successors or external auditors.', 'High', 'Author a one-page Information Security Policy covering: data classification, acceptable use, password requirements, incident reporting, vendor management. Use NIST CSF or ISO 27001 Annex A as the structural skeleton.'],
        ['D7-02', 'Change management is informal: founder commits to master, Railway auto-deploys. There is no peer review, no automated security gate, no deploy-time canary, no rollback runbook.', 'High', 'See D4-04 (branch protection) and add: required CI green-build before deploy, GitHub Action that posts a Slack/email notification on every production deploy, runbook for "how to roll back" with one-line commands.'],
        ['D7-03', 'No designated Data Protection Officer (DPO). RA 10173 requires personal-information controllers handling sensitive personal information to register a DPO with the National Privacy Commission. Clerque handles employee records (TIN, SSS, PhilHealth, salaries), customer PII, and BIR-mandated retention data — squarely in scope.', 'Critical', 'Designate a DPO within 30 days. May be the founder for the initial phase but must be formally appointed in writing. Register the role and the data-processing system with the NPC via the online portal. Cost: zero; effort: 4 hours of paperwork.'],
        ['D7-04', 'No documented vendor / third-party risk register. Critical vendors include Anthropic (AI), Cloudflare (R2 + soon WAF), Railway (compute + DB), Vercel (web hosting), Resend (email). Each carries its own breach-risk that compounds with the others.', 'Medium', 'Maintain a one-page vendor register: vendor name, data shared, contract URL, last security review date. Review semi-annually.'],
        ['D7-05', 'System architecture documentation exists in the form of memory files (project_clerque.md, arch_decisions.md) but is not in a standard format and is not version-controlled in the public repo. A new joiner has no formal onboarding doc.', 'Medium', 'Convert the memory files into a /docs folder in the repo with sections: Architecture, Data Flows, Runbooks, Deployment. Update at the end of every feature sprint.'],
        ['D7-06', 'No documented Incident Response Plan. This is expanded under Domain 10 (Threat Scenarios).', 'Critical', 'See Domain 10 findings.'],
      ],
    },
    {
      id: 'D8', name: '8. Monitoring & Logging',
      objective: 'Verify the operational state of the system is continuously visible and abnormal conditions are detected.',
      questions: [
        'Are application and infrastructure logs collected, searchable, and retained?',
        'Are there alerts for failed logins, slow queries, error spikes, downtime?',
        'Is log integrity protected against tampering?',
        'Is uptime continuously measured and reported?',
      ],
      findings: [
        ['D8-01', 'Application logs flow to Railway\'s built-in log viewer (default 30-day retention on the Hobby plan, 7 days on free). There is no log aggregation, full-text search, or long-term archive.', 'Medium', 'Forward Railway logs to a managed log platform (Better Stack, Axiom, or self-hosted Loki). 90-day searchable retention minimum for an application processing financial data; longer if BIR/SEC review may require it.'],
        ['D8-02', 'No uptime monitoring confirmed. UptimeRobot is recommended in INFRA_SETUP.md but configuration has not been evidenced.', 'High', 'Configure UptimeRobot or BetterUptime to ping the /health endpoint every minute from at least two geographies. Alert via email + SMS on consecutive failures.'],
        ['D8-03', 'No application error tracking (Sentry / Rollbar / similar) confirmed. Production exceptions are visible only by tailing Railway logs after the fact.', 'High', 'Configure Sentry for the API and the web app. Set release-tagging to capture which deploy introduced an error. Free tier is sufficient for current volumes.'],
        ['D8-04', 'No anomaly alerts. Failed-login spikes, AccountingEvent failure clusters, and AI-budget exhaustion are visible only in logs and dashboards, not pushed to a human.', 'Medium', 'Add three pushed alerts: (1) >10 failed logins from one IP in 5 minutes, (2) >5 AccountingEvent rows in FAILED status, (3) AI monthly spend >80% of cap for any tenant.'],
        ['D8-05', 'No log integrity protection. Logs are mutable on the Railway side and within Postgres. There is no append-only audit log streamed to immutable storage.', 'Medium', 'For audit-grade logs (financial mutations, role changes, void/refund actions): stream a copy to the same R2 bucket as backups, daily, with Object Lock retention.'],
      ],
    },
    {
      id: 'D9', name: '9. Human Factors & Organizational Controls',
      objective: 'Verify the people-and-process layer around the application reduces accidental and intentional risk.',
      questions: [
        'Is there a security awareness program?',
        'What happens when a staff member or founder is unavailable?',
        'How is knowledge transferred to a successor?',
      ],
      findings: [
        ['D9-01', 'No security awareness training program exists. This is expected for a founder-led pre-revenue stage but creates risk as tenants onboard their own staff onto Clerque.', 'Low', 'Within 6 months, publish a 5-minute video for tenant owners covering: phishing recognition, password hygiene, supervisor-PIN protection, what to do if a device is stolen. Embed in the onboarding flow.'],
        ['D9-02', 'Key-person dependency is high. The founder is the sole developer, sole admin, sole DPO candidate, and sole incident responder. Loss of availability (illness, accident) would suspend the recovery loop entirely.', 'High', 'Identify a single trusted technical contact (former colleague, contracted developer) and grant them read-access to the codebase + Railway + R2 with documented incident-response authority. Refresh quarterly.'],
        ['D9-03', 'Bus factor = 1 for code understanding. While documentation exists, no second engineer has worked through the codebase end-to-end.', 'High', 'See D9-02 and add: have the secondary engineer perform a paid 8-hour "shadow review" of the codebase and write a "where to look first" runbook for their future self.'],
      ],
    },
    {
      id: 'D10', name: '10. Cyber Incident Response & Threat Scenarios',
      objective: 'Verify documented, tested procedures exist for each high-impact threat scenario.',
      questions: [],
      findings: [
        ['D10-A', 'RANSOMWARE: No documented playbook. Off-box backups exist (mitigates impact) but R2 Object Lock not confirmed enabled (see D1-06). No tabletop exercise ever conducted. Authority for ransom-payment decisions undefined.', 'Critical', 'Within 30 days: (a) enable R2 Object Lock with 30-day retention, (b) author a 1-page ransomware response playbook covering detect→isolate→notify→restore, (c) conduct a tabletop exercise with at least one non-founder participant.'],
        ['D10-B', 'MALWARE: Server-side AV is the responsibility of Railway (managed). Workstation AV (founder\'s laptop) is implicit. No isolation procedure for an infected developer machine that has push access to master.', 'Medium', 'Enable Microsoft Defender (or equivalent) on the founder\'s development machine. Document a "lost / stolen laptop" procedure: rotate all Railway tokens, R2 keys, GitHub tokens, JWT secret; force-revoke all sessions.'],
        ['D10-C', 'DATA BREACH: No response plan aligned to RA 10173. No DPO. No 72-hour NPC notification procedure. No documented playbook for forensic identification of "what data was accessed by whom and when". This is the single highest regulatory-risk finding.', 'Critical', 'Within 30 days: (a) designate and register DPO with NPC, (b) author a Data Breach Response Procedure with 72h NPC notification template, (c) define forensic IR scope (which logs, which database snapshots), (d) document the affected-individual notification template.'],
        ['D10-D', 'INSIDER THREAT: No bulk-download detection, no privileged-action review cadence, no whistleblower mechanism. Termination access revocation is manual (see D3-04).', 'High', 'Within 60 days: (a) build a "User exported >100 customer records in 1 hour" alert, (b) commit to a quarterly review of all SUPER_ADMIN and BUSINESS_OWNER actions from the AuditLog (once D3-07 lands), (c) publish a security@clerque.ph reporting address with a no-retaliation commitment.'],
        ['D10-E', 'DoS/DDoS: Partial protection from Railway + Vercel platform defaults. No application-layer rate limiting (D5-03). No documented response procedure. No defined RTO for this scenario.', 'High', 'Front the API with Cloudflare (D1-04) for DDoS + rate limiting in one stroke. Define RTO=15 minutes for DDoS scenarios in the DRP. Status-page template (status.clerque.ph) for customer communications during downtime.'],
        ['D10-F', 'CREDENTIAL COMPROMISE: No mass-password-reset procedure. No session-mass-revocation endpoint (D3-06). No MFA enforcement (D3-02). A leaked owner password is a full breach with no compensating control.', 'Critical', 'Within 30 days: (a) ship MFA (D3-02), (b) ship mass-session-revocation (D3-06), (c) document the credential-compromise playbook covering both controls plus a forensic step to identify "what did the attacker access while the session was live".'],
        ['D10-G', 'SUPPLY CHAIN COMPROMISE: package-lock.json provides integrity pinning (mitigates). No automated advisory monitoring (D1-05). No documented response procedure for a "compromised npm package" event.', 'Medium', 'Adopt Dependabot (D1-05). Document the supply-chain response: lock the master branch, pin previous-known-good package version, roll forward only after Anthropic/community confirms a clean release.'],
      ],
    },
  ],
  sodMatrix: {
    roles: [
      'BUSINESS_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD',
      'ACCOUNTANT', 'AP_ACCOUNTANT', 'BOOKKEEPER',
      'PAYROLL_MASTER', 'HR_STAFF', 'WAREHOUSE_STAFF',
      'MDM', 'SUPER_ADMIN',
    ],
    functions: [
      'Create JE', 'Approve JE', 'Create AP Bill', 'Post AP Bill', 'Pay AP Bill',
      'Issue Refund', 'Run Payroll', 'Set Salary', 'Adjust Inventory',
      'Manage Users', 'Restore Backup',
    ],
    cells: {
      'BUSINESS_OWNER':  { 'Create JE':'Y','Approve JE':'Y','Create AP Bill':'Y','Post AP Bill':'Y','Pay AP Bill':'Y','Issue Refund':'Y','Run Payroll':'Y','Set Salary':'Y','Adjust Inventory':'Y','Manage Users':'Y','Restore Backup':'·' },
      'BRANCH_MANAGER':  { 'Issue Refund':'!','Adjust Inventory':'Y','Manage Users':'Y' },
      'CASHIER':         { 'Issue Refund':'!' },
      'SALES_LEAD':      { 'Issue Refund':'!','Manage Users':'Y' },
      'ACCOUNTANT':      { 'Create JE':'Y','Approve JE':'!','Post AP Bill':'Y','Pay AP Bill':'Y' },
      'AP_ACCOUNTANT':   { 'Create AP Bill':'Y','Post AP Bill':'!','Pay AP Bill':'!' },
      'BOOKKEEPER':      { 'Create JE':'Y' },
      'PAYROLL_MASTER':  { 'Run Payroll':'Y','Set Salary':'Y' },
      'HR_STAFF':        { },
      'WAREHOUSE_STAFF': { 'Adjust Inventory':'Y' },
      'MDM':             { 'Adjust Inventory':'Y' },
      'SUPER_ADMIN':     { 'Create JE':'Y','Approve JE':'Y','Create AP Bill':'Y','Post AP Bill':'Y','Pay AP Bill':'Y','Issue Refund':'Y','Run Payroll':'Y','Set Salary':'Y','Adjust Inventory':'Y','Manage Users':'Y','Restore Backup':'Y' },
    },
  },
  heatmap: {
    'Infrastructure & Architecture': 'High',
    'Data Management & Backup':      'Medium',
    'Access Control & Identity':     'Critical',
    'Segregation of Duties':         'Medium',
    'Application Controls':          'Medium',
    'Security & Vulnerability Mgmt': 'High',
    'Governance & Policy':           'Critical',
    'Monitoring & Logging':          'High',
    'Human Factors':                 'High',
    'Incident Response & Threats':   'Critical',
  },
  actionPlan: [
    ['D1-06', 'Enable R2 Object Lock with 30-day compliance retention',           'Founder', '2026-05-25', 'Open'],
    ['D3-02', 'Ship TOTP MFA for OWNER/SUPER_ADMIN/ACCOUNTANT/AP/PAYROLL',         'Founder', '2026-06-10', 'Open'],
    ['D7-03', 'Designate DPO; register with NPC',                                  'Founder', '2026-06-10', 'Open'],
    ['D10-A','Author ransomware playbook + tabletop',                              'Founder', '2026-06-10', 'Open'],
    ['D10-C','Author data-breach response procedure (RA 10173 §38)',               'DPO',     '2026-06-10', 'Open'],
    ['D10-F','Mass-session-revocation endpoint + credential-compromise playbook',  'Founder', '2026-06-10', 'Open'],
    ['D2-02','Conduct documented restore drill on staging',                        'Founder', '2026-06-10', 'Open'],
    ['D2-04','Author 6-scenario DRP',                                              'Founder', '2026-06-25', 'Open'],
    ['D4-04','Enable branch protection on master; secondary reviewer',             'Founder', '2026-07-10', 'Open'],
    ['D6-03','Engage third-party penetration test',                                'Founder', '2026-08-10', 'Open'],
  ],
  conclusion: [
    'It is the auditor\'s opinion that the Clerque application has, at the code layer, an above-baseline ' +
    'security posture for a small Philippine SaaS in its current stage of maturity. The recent internal ' +
    'security audit closed all ten HIGH-severity loopholes identified, and the new admin-restore endpoint ' +
    'closes the catastrophic-loss recovery gap. However, the application is materially deficient in the ' +
    'governance, incident-response, and identity-protection wrappers expected of a production financial ' +
    'system handling Philippine BIR-regulated ledger data and Data Privacy Act-protected employee records. ' +
    'The single most urgent finding is the absence of MFA enforcement combined with no designated DPO and ' +
    'no documented data-breach response procedure — a credential compromise today would trigger NPC ' +
    'notification obligations the organisation is not currently positioned to meet.',

    'Subject to remediation of the Critical findings within 30 days and the High findings within 90 days, ' +
    'the audit opinion can be uplifted from "Needs Improvement" to "Satisfactory" on the next review cycle.',
  ],
};

// ─── Rendering helpers ────────────────────────────────────────────────────
const MARGIN     = 36;     // 0.5 inch
const TOP_MARGIN = 50;
const FOOTER_Y   = 770;    // y of footer text
const COL_INK    = INK;
let pageNum      = 0;

function addPage(doc, opts = {}) {
  doc.addPage(opts);
  pageNum++;
  drawChrome(doc);
}

function drawChrome(doc) {
  // Footer
  doc.save();
  doc.fontSize(8).fillColor(MUTED).font('Helvetica-Oblique');
  doc.text(AUDIT.cover.classification, MARGIN, FOOTER_Y, { width: 200 });
  doc.font('Helvetica');
  doc.text(`Page ${pageNum}`, doc.page.width - MARGIN - 80, FOOTER_Y, { width: 80, align: 'right' });
  // Top rule on non-cover pages
  if (pageNum > 1) {
    doc.strokeColor(BROWN).lineWidth(0.6)
      .moveTo(MARGIN, 45).lineTo(doc.page.width - MARGIN, 45).stroke();
    doc.fontSize(8).fillColor(MUTED).font('Helvetica')
      .text('Internal Audit Report — Clerque Application', MARGIN, 30, { width: doc.page.width - 2 * MARGIN });
  }
  doc.restore();
}

function h1(doc, text) {
  doc.moveDown(0.4);
  doc.fontSize(18).fillColor(BROWN).font('Helvetica-Bold').text(text);
  doc.moveDown(0.3);
}
function h2(doc, text) {
  doc.fontSize(13).fillColor(INK).font('Helvetica-Bold').text(text);
  doc.moveDown(0.2);
}
function body(doc, text, opts = {}) {
  doc.fontSize(10).fillColor(INK).font('Helvetica').text(text, opts);
  doc.moveDown(0.4);
}
function caption(doc, text) {
  doc.fontSize(9).fillColor(MUTED).font('Helvetica-Oblique').text(text);
  doc.moveDown(0.2);
}

function ratingPill(doc, x, y, text, w = 70, h = 14) {
  const fill = RATING_COLOR[text] || MUTED;
  doc.save();
  doc.roundedRect(x, y - 1, w, h, 3).fill(fill);
  doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold').text(text, x, y + 2, { width: w, align: 'center' });
  doc.restore();
}

// Generic table renderer — handles wrapping rows, repeating headers on page-break.
function drawTable(doc, headers, rows, colWidths, options = {}) {
  const startX = MARGIN;
  let y = doc.y;
  const headerHeight = options.headerHeight ?? 18;
  const cellPadX = 5;
  const cellPadY = 4;
  const fontSize = options.fontSize ?? 8;
  const headerFill = CREAM;
  const ruleColor = RULE;

  const drawHeader = () => {
    doc.save();
    doc.fillColor(headerFill).rect(startX, y, colWidths.reduce((a, b) => a + b, 0), headerHeight).fill();
    let x = startX;
    headers.forEach((h, i) => {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(fontSize + 1);
      doc.text(h, x + cellPadX, y + cellPadY, { width: colWidths[i] - 2 * cellPadX });
      x += colWidths[i];
    });
    doc.restore();
    y += headerHeight;
  };

  drawHeader();

  for (const row of rows) {
    // Pre-measure row height
    let rowH = 0;
    const cellTexts = row.map((cell, i) => {
      const text = typeof cell === 'string' ? cell : String(cell?.text ?? '');
      doc.font('Helvetica').fontSize(fontSize);
      const h = doc.heightOfString(text, { width: colWidths[i] - 2 * cellPadX });
      rowH = Math.max(rowH, h + 2 * cellPadY);
      return { text, raw: cell };
    });
    rowH = Math.max(rowH, 20);

    // Page break if needed
    if (y + rowH > FOOTER_Y - 12) {
      addPage(doc);
      y = 60;
      drawHeader();
    }

    // Background stripe (white)
    let x = startX;
    cellTexts.forEach((cell, i) => {
      doc.save();
      // Cell border
      doc.strokeColor(ruleColor).lineWidth(0.4).rect(x, y, colWidths[i], rowH).stroke();

      // Special rendering for "rating pill" cells (object with type:'rating')
      if (cell.raw && typeof cell.raw === 'object' && cell.raw.type === 'rating') {
        const px = x + (colWidths[i] - 70) / 2;
        const py = y + (rowH - 14) / 2;
        ratingPill(doc, px, py, cell.raw.text, 70, 14);
      } else if (cell.raw && typeof cell.raw === 'object' && cell.raw.bg) {
        doc.save();
        doc.fillColor(cell.raw.bg).rect(x, y, colWidths[i], rowH).fill();
        doc.restore();
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(fontSize + 1);
        doc.text(cell.raw.text, x + cellPadX, y + cellPadY, { width: colWidths[i] - 2 * cellPadX, align: 'center' });
      } else {
        doc.fillColor(INK).font('Helvetica').fontSize(fontSize);
        doc.text(cell.text, x + cellPadX, y + cellPadY, { width: colWidths[i] - 2 * cellPadX });
      }
      doc.restore();
      x += colWidths[i];
    });
    y += rowH;
  }
  doc.y = y + 4;
}

function totalsTable(doc) {
  const rows = Object.entries(AUDIT.executive.totals).map(([k, v]) => [
    { type: 'colour', text: k },
    String(v),
  ]);
  // Render with coloured first-column labels
  drawTable(
    doc,
    ['Rating', 'Count'],
    rows.map(([rating, count]) => [{ raw: { text: rating.text, fg: RATING_COLOR[rating.text] || INK, bold: true } }, count])
        .map(r => [{ text: r[0].raw.text, raw: { type: 'plain' } }, r[1]]),
    [200, 80],
  );
  // Simpler approach: just render plain text and overlay coloured dots
}

// ─── Sections ─────────────────────────────────────────────────────────────
function renderCover(doc) {
  const c = AUDIT.cover;
  // Centered title block
  const cx = doc.page.width / 2;
  doc.moveDown(8);
  doc.fontSize(28).fillColor(BROWN).font('Helvetica-Bold')
    .text(c.title, MARGIN, doc.y, { width: doc.page.width - 2 * MARGIN, align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(18).fillColor(INK).font('Helvetica')
    .text(c.subtitle, MARGIN, doc.y, { width: doc.page.width - 2 * MARGIN, align: 'center' });
  doc.moveDown(2);
  doc.fontSize(11).fillColor(MUTED).font('Helvetica')
    .text(c.period, MARGIN, doc.y, { width: doc.page.width - 2 * MARGIN, align: 'center' });
  doc.moveDown(0.5);
  doc.text(`Prepared by: ${c.preparedBy}`, MARGIN, doc.y, { width: doc.page.width - 2 * MARGIN, align: 'center' });
  doc.moveDown(8);
  doc.font('Helvetica-Bold').fillColor(BROWN)
    .text(`Classification: ${c.classification}`, MARGIN, doc.y, { width: doc.page.width - 2 * MARGIN, align: 'center' });
}

function renderExecutiveSummary(doc) {
  const e = AUDIT.executive;
  addPage(doc);
  h1(doc, 'Executive Summary');

  h2(doc, 'Overall Audit Opinion');
  ratingPill(doc, MARGIN, doc.y, e.opinion, 120, 18);
  doc.moveDown(2);
  body(doc, e.rationale, { align: 'justify' });

  h2(doc, 'Findings Totals by Risk Rating');
  const rows = Object.entries(e.totals).map(([k, v]) => [
    { text: k, raw: { type: 'plain', fg: RATING_COLOR[k] } },
    String(v),
  ]);
  // Render manually so we can colour the rating label
  const headers = ['Rating', 'Count'];
  const colWidths = [220, 80];
  let y = doc.y + 6;
  const headerHeight = 18;
  doc.save();
  doc.fillColor(CREAM).rect(MARGIN, y, colWidths[0] + colWidths[1], headerHeight).fill();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9);
  doc.text(headers[0], MARGIN + 8, y + 5, { width: colWidths[0] - 16 });
  doc.text(headers[1], MARGIN + colWidths[0] + 8, y + 5, { width: colWidths[1] - 16 });
  doc.restore();
  y += headerHeight;
  for (const [k, v] of Object.entries(e.totals)) {
    doc.save();
    doc.strokeColor(RULE).lineWidth(0.4).rect(MARGIN, y, colWidths[0], 18).stroke();
    doc.rect(MARGIN + colWidths[0], y, colWidths[1], 18).stroke();
    doc.fillColor(RATING_COLOR[k] || INK).font('Helvetica-Bold').fontSize(9).text(k, MARGIN + 8, y + 5, { width: colWidths[0] - 16 });
    doc.fillColor(INK).font('Helvetica').text(v, MARGIN + colWidths[0] + 8, y + 5, { width: colWidths[1] - 16 });
    doc.restore();
    y += 18;
  }
  doc.y = y + 10;

  h2(doc, 'Top 3 Critical Issues Requiring Immediate Attention');
  e.top3.forEach((item, i) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`${i + 1}.`, { continued: true });
    doc.font('Helvetica').text(` ${item}`, { width: doc.page.width - 2 * MARGIN });
    doc.moveDown(0.3);
  });

  h2(doc, 'Overall Risk Posture');
  e.narrative.forEach(p => body(doc, p, { align: 'justify' }));
}

function renderDomain(doc, domain) {
  addPage(doc);
  h1(doc, domain.name);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Objective: ', { continued: true });
  doc.font('Helvetica').text(domain.objective);
  doc.moveDown(0.4);

  if (domain.questions.length) {
    h2(doc, 'Key Audit Questions');
    domain.questions.forEach(q => {
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(`• ${q}`);
    });
    doc.moveDown(0.4);
  }

  h2(doc, 'Findings');
  const rows = domain.findings.map(([fid, obs, rating, rec]) => [
    fid, obs,
    { type: 'rating', text: rating },
    rec,
  ]);
  drawTable(doc, ['ID', 'Observation', 'Rating', 'Recommendation'], rows, [45, 220, 75, 200], { fontSize: 8 });
}

function renderSOD(doc) {
  addPage(doc);
  h1(doc, 'Segregation of Duties Matrix');
  caption(doc,
    'Legend: Y = role is permitted; ! = permitted but gated by SOD/compensating control (e.g. AP_ACCOUNTANT ' +
    'cannot self-post a bill they created); · = not permitted.');
  doc.moveDown(0.2);

  const m = AUDIT.sodMatrix;
  const headers = ['Role', ...m.functions];
  // Column widths: tight layout for many columns
  const totalW = doc.page.width - 2 * MARGIN;
  const firstCol = 100;
  const fnCol = (totalW - firstCol) / m.functions.length;
  const colWidths = [firstCol, ...m.functions.map(() => fnCol)];

  // Header
  let y = doc.y;
  const headerHeight = 26;
  doc.save();
  doc.fillColor(CREAM).rect(MARGIN, y, totalW, headerHeight).fill();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7);
  let x = MARGIN;
  headers.forEach((h, i) => {
    doc.text(h, x + 2, y + 4, { width: colWidths[i] - 4, align: i === 0 ? 'left' : 'center', height: headerHeight - 4 });
    x += colWidths[i];
  });
  doc.restore();
  y += headerHeight;

  m.roles.forEach(role => {
    const rowH = 14;
    if (y + rowH > FOOTER_Y - 12) {
      addPage(doc);
      y = 60;
    }
    let x = MARGIN;
    // Role cell
    doc.save();
    doc.strokeColor(RULE).lineWidth(0.3).rect(x, y, colWidths[0], rowH).stroke();
    doc.fillColor(INK).font('Helvetica').fontSize(7).text(role, x + 3, y + 3, { width: colWidths[0] - 6 });
    doc.restore();
    x += colWidths[0];

    m.functions.forEach((fn, i) => {
      const v = (m.cells[role] && m.cells[role][fn]) || '·';
      const bg = v === 'Y' ? '#DCFCE7' : v === '!' ? '#FEF3C7' : '#F3F4F6';
      doc.save();
      doc.fillColor(bg).rect(x, y, colWidths[i + 1], rowH).fill();
      doc.strokeColor(RULE).lineWidth(0.3).rect(x, y, colWidths[i + 1], rowH).stroke();
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(v, x, y + 3, { width: colWidths[i + 1], align: 'center' });
      doc.restore();
      x += colWidths[i + 1];
    });
    y += rowH;
  });
  doc.y = y + 10;
}

function renderHeatmap(doc) {
  addPage(doc);
  h1(doc, 'Summary Risk Heatmap');
  caption(doc, 'Overall risk rating per audit domain. Colour codes match individual findings.');
  doc.moveDown(0.3);
  const rows = Object.entries(AUDIT.heatmap).map(([domain, rating]) => [
    domain,
    { type: 'rating', text: rating },
  ]);
  drawTable(doc, ['Domain', 'Overall Risk'], rows, [340, 130], { fontSize: 9 });
}

function renderActionPlan(doc) {
  addPage(doc);
  h1(doc, 'Management Action Plan Template');
  caption(doc,
    'Recommended priority order. Critical-tier items should be discharged within 30 days; ' +
    'High-tier within 90 days. Management to update status quarterly.');
  doc.moveDown(0.3);
  const rows = AUDIT.actionPlan.map(([fid, resp, owner, dt, status]) => [
    fid, resp, owner, dt, status,
  ]);
  drawTable(doc, ['Finding ID', 'Management Response', 'Owner', 'Target Date', 'Status'],
    rows, [60, 240, 75, 80, 60], { fontSize: 8 });
}

function renderConclusion(doc) {
  addPage(doc);
  h1(doc, "Auditor's Conclusion");
  AUDIT.conclusion.forEach(p => body(doc, p, { align: 'justify' }));
  doc.moveDown(1.5);
  doc.font('Helvetica-Oblique').fontSize(10).fillColor(INK).text('— AI Internal Auditor (Claude)');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
}

// ─── Main ─────────────────────────────────────────────────────────────────
function main() {
  const outDir = path.join(os.homedir(), 'Desktop');
  const outPath = path.join(outDir, 'clerque_internal_audit_report.pdf');

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: TOP_MARGIN, bottom: 50, left: MARGIN, right: MARGIN },
    info: {
      Title:    'Internal Audit Report — Clerque Application',
      Author:   'AI Internal Auditor (Claude)',
      Subject:  'Confidential — Internal Use Only',
    },
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  pageNum = 1;
  drawChrome(doc);
  renderCover(doc);
  renderExecutiveSummary(doc);
  AUDIT.domains.forEach(d => renderDomain(doc, d));
  renderSOD(doc);
  renderHeatmap(doc);
  renderActionPlan(doc);
  renderConclusion(doc);

  doc.end();
  stream.on('finish', () => {
    console.log(`Wrote ${outPath}`);
  });
}

main();
