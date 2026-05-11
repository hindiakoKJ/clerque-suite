"""
Clerque Internal Audit Report — ReportLab PDF generator.

Usage:
    pip install reportlab
    python clerque_internal_audit_report.py

Output:
    clerque_internal_audit_report.pdf (in the working directory)

Tested with ReportLab 4.x. Content of the report is embedded in this file
as the AUDIT_DATA dict — edit there to refresh findings without changing
the rendering code.
"""
from datetime import date
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    Table, TableStyle, PageBreak, KeepTogether, NextPageTemplate,
)


# ─── Risk-rating colours (also used by the Node renderer) ──────────────────
RATING_COLORS = {
    'Critical':       colors.HexColor('#B91C1C'),  # red-700
    'High':           colors.HexColor('#EA580C'),  # orange-600
    'Medium':         colors.HexColor('#CA8A04'),  # yellow-600
    'Low':            colors.HexColor('#16A34A'),  # green-600
    'Informational':  colors.HexColor('#0284C7'),  # sky-600
    'Satisfactory':   colors.HexColor('#16A34A'),
    'Needs Improvement': colors.HexColor('#CA8A04'),
    'Unsatisfactory': colors.HexColor('#B91C1C'),
}

BROWN  = colors.HexColor('#8B5E3C')
CREAM  = colors.HexColor('#EEE9DF')
INK    = colors.HexColor('#1F1B16')
MUTED  = colors.HexColor('#5C5650')


# ════════════════════════════════════════════════════════════════════════════
# Audit content — the entire report is parameterised here.
# ════════════════════════════════════════════════════════════════════════════
AUDIT_DATA = {
    'cover': {
        'title':       'Internal Audit Report',
        'subtitle':    'Clerque Application',
        'period':      f'Audit period: through {date.today().strftime("%d %B %Y")}',
        'prepared_by': 'AI Internal Auditor (Claude)',
        'classification': 'Confidential — Internal Use Only',
    },

    'executive_summary': {
        'overall_opinion': 'Needs Improvement',
        'opinion_rationale': (
            'The Clerque application demonstrates strong engineering hygiene at the code layer '
            '(comprehensive role-based access controls, multi-tenant isolation, automated tests, '
            'recent security hardening) but lacks the documented governance, incident-response, '
            'and operational-controls scaffolding expected of a production financial system. The '
            'most material gaps relate to incident-response readiness — particularly for ransomware '
            'and data-breach scenarios with regulatory notification obligations under RA 10173 '
            '(Philippine Data Privacy Act).'
        ),
        'findings_totals': {
            'Critical':       4,
            'High':           7,
            'Medium':         11,
            'Low':            6,
            'Informational':  3,
        },
        'top_3_critical': [
            'No designated Data Protection Officer (DPO) and no documented data-breach response '
            'procedure aligned to the NPC\'s 72-hour notification rule (RA 10173 §38, NPC Circular '
            '16-03). A breach today would trigger penalties on top of the breach itself.',

            'No documented Incident Response Plan covering ransomware, malware, or denial-of-service '
            'scenarios. No tabletop exercise has been conducted. Recovery is implicit "founder '
            'figures it out at 3 AM" rather than a tested playbook.',

            'Multi-factor authentication (MFA) is not enforced for any role despite schema-level '
            'support. A single compromised owner credential gives full access to all tenants the '
            'platform admin can see, all financial data, and all customer PII.',
        ],
        'narrative': (
            'Clerque\'s technical foundation is, in most respects, above the baseline for a small '
            'Philippine SaaS at this stage. Tenant data isolation, role-based access controls, '
            'segregation-of-duties enforcement around financial postings, encrypted transport, and '
            'an off-box backup pipeline are all in place. A recent internal security review closed '
            'all ten HIGH-severity loopholes identified in code, and a one-click admin restore path '
            'now exists to recover a wiped tenant from cloud-stored snapshots within one business '
            'hour.\n\n'

            'Where the application falls materially short is in the *governance and operational* '
            'wrapper around that engineering. There is no written information-security policy, no '
            'change-management workflow beyond a single founder pushing to master, no designated '
            'Data Protection Officer, and no documented procedure for the most likely catastrophic '
            'events — ransomware, data breach, or credential compromise. Multi-factor authentication '
            'is not yet built. Dependency scanning is not automated. Logs are retained at the cloud '
            'provider\'s default 30 days, with no tamper-evidence and no alerting layer beyond '
            'crash reporting (which is itself not yet confirmed configured).\n\n'

            'The audit recommends a 90-day remediation sprint focused on (1) appointing a DPO and '
            'authoring a data-breach response procedure that satisfies NPC RA 10173 §38, (2) '
            'shipping MFA enforcement for BUSINESS_OWNER and SUPER_ADMIN roles at minimum, (3) '
            'authoring and tabletop-testing a ransomware playbook with confirmed Cloudflare R2 '
            'Object Lock enabled, and (4) introducing automated dependency scanning (npm audit + '
            'Dependabot) into the CI pipeline. None of these blockers requires a large team — they '
            'are documentation and configuration items that can be discharged by the existing '
            'founder/developer in a focused two-week sprint.'
        ),
    },

    # Each domain is rendered as its own section with findings table + narrative.
    'domains': [
        {
            'id':    'D1',
            'name':  '1. Infrastructure & Architecture',
            'objective': 'Verify the hosting environment is appropriately segregated, hardened, scalable, and resilient.',
            'audit_questions': [
                'Where is the application hosted, and what tier of provider hardening applies?',
                'Are development, staging, and production environments separated by infrastructure, not just config?',
                'Is TLS/SSL enforced end-to-end with current cipher suites?',
                'Is there a Web Application Firewall (WAF) in front of the API?',
                'Is the system designed for horizontal scale, or does any in-memory state prevent that?',
                'Is dependency / third-party risk monitored?',
            ],
            'findings': [
                ('D1-01', 'Application hosted on Railway (API + Postgres) and Vercel (web). Both are managed PaaS providers with TLS, DDoS mitigation, and host-level patching covered by the vendor.', 'Informational', 'No action required. Document this in the system architecture record so auditors and successors understand the provider-managed perimeter.'),
                ('D1-02', 'No separate staging environment was evidenced. All testing flows through a local developer environment directly to production.', 'High', 'Stand up a staging Railway project + Vercel preview environment with anonymised production data. Require all schema migrations to apply cleanly to staging before being merged to master.'),
                ('D1-03', 'In-memory throttle ledger introduced for supervisor-PIN brute-force protection (audit fix H3). This works for a single API instance but will silently degrade if Railway scales horizontally — each instance keeps its own counter, multiplying the effective attempt budget.', 'Medium', 'Migrate the throttle ledger to Redis or a Postgres counter table before enabling horizontal scaling. Document the single-instance assumption in the operations runbook.'),
                ('D1-04', 'No Web Application Firewall (WAF) layer is in place between the public internet and the API. Vercel and Railway provide basic DDoS protection but do not perform application-layer attack filtering (e.g., OWASP CRS rules).', 'Medium', 'Place Cloudflare in front of the API hostname and enable the managed WAF ruleset (Free tier covers the OWASP Core Rule Set). Estimated effort: 2 hours.'),
                ('D1-05', 'Dependency management uses package-lock.json (integrity-pinned) — good. No automated vulnerability scanning runs against the lock file on a schedule.', 'Medium', 'Enable GitHub Dependabot or Snyk free tier; configure to open PRs for HIGH/CRITICAL advisories automatically. Estimated effort: 30 minutes one-time setup.'),
                ('D1-06', 'Cloudflare R2 / AWS S3 bucket Object Lock status not evidenced. Without Object Lock, an attacker who compromises the API\'s S3 credentials can delete backup snapshots before recovery.', 'Critical', 'Enable Object Lock with 30-day compliance retention on the backups bucket immediately. This is the single most important ransomware control and is a one-click action in the R2 console.'),
            ],
        },

        {
            'id':    'D2',
            'name':  '2. Data Management & Backup',
            'objective': 'Verify data can be recovered after loss, corruption, or destructive attack within defined RTO/RPO.',
            'audit_questions': [
                'How often are backups taken, where are they stored, and how long are they retained?',
                'Has a restore from backup ever been tested end-to-end?',
                'Are Recovery Point Objective (RPO) and Recovery Time Objective (RTO) formally defined?',
                'Are off-box backups isolated from the main credentials surface (different cloud account / keys)?',
                'Is there a written Disaster Recovery Plan (DRP) and Business Continuity Plan (BCP)?',
            ],
            'findings': [
                ('D2-01', 'Nightly off-box backup pipeline writes a per-tenant JSON snapshot to Cloudflare R2 (or AWS S3) at 02:00 UTC. Coverage is wide: ~25 tables including orders, journal entries, accounting events, products, inventory, payroll. Excludes user passwordHash and 2FA secrets by design.', 'Informational', 'No action. Verify the S3_BUCKET / S3_ACCESS_KEY_ID env vars are populated on Railway in production; if unset, the scheduler silently no-ops.'),
                ('D2-02', 'No restore has been tested end-to-end against a restored database. The newly-built admin restore endpoint (audit recovery scope) has unit-level tests only; no full-tenant restore drill exists.', 'High', 'Conduct a documented restore drill on a staging tenant within 30 days. Time the restore, verify row counts match, confirm GL balances reconcile. Repeat semi-annually.'),
                ('D2-03', 'RPO is implicit (~24 hours since last 02:00 UTC snapshot) but not formally documented or communicated to customers. RTO is "1 business hour via support" per the new in-app recovery procedure page — also not in a customer contract or SLA.', 'Medium', 'Publish a 1-page Data Recovery SLA: state RPO=24h, RTO=4h (conservative), retention=30 days, and link to it from the Settings → Data Backups page.'),
                ('D2-04', 'No documented Disaster Recovery Plan (DRP) covering "Railway region outage", "Postgres corruption", "complete data centre loss". No Business Continuity Plan (BCP) covering "founder unavailable", "developer hit by bus", or "Anthropic API outage".', 'High', 'Author a one-page DRP per scenario (target 6 scenarios). Include who notifies customers, expected timeline, and minimum-viable-service mode (e.g., read-only ledger during recovery).'),
                ('D2-05', 'No data classification policy. All data is implicitly treated as "sensitive" but there is no formal labelling distinguishing public marketing copy from PII to BIR-required ledger evidence.', 'Low', 'Adopt a simple 3-tier classification: Public / Internal / Sensitive-PII. Tag tables in the data model with their tier; surface in any new privacy-impact assessment.'),
            ],
        },

        {
            'id':    'D3',
            'name':  '3. Access Control & Identity Management',
            'objective': 'Verify the right users have the right access, no more and no less, with strong authentication.',
            'audit_questions': [
                'What authentication mechanisms are in place — passwords, MFA, SSO?',
                'How is least privilege enforced and reviewed?',
                'Are user provisioning and deprovisioning workflows documented and timely?',
                'How long do sessions live, and can they be invalidated centrally?',
                'Are access events audit-logged with sufficient detail to forensically reconstruct?',
            ],
            'findings': [
                ('D3-01', 'Authentication uses bcrypt password hashing with default cost, JWT access tokens (8h), and refresh-token rotation per device. Refresh-token revocation is per-token in DB. This is a strong baseline for password-only authentication.', 'Informational', 'No action.'),
                ('D3-02', 'Multi-factor authentication (MFA) schema fields exist on the User model (twoFactorSecret, twoFactorBackupCodes) but no UI or API endpoints are built. MFA cannot currently be enforced for any role, including BUSINESS_OWNER and SUPER_ADMIN.', 'Critical', 'Ship TOTP-based MFA enrolment + verification for BUSINESS_OWNER, SUPER_ADMIN, ACCOUNTANT, AP_ACCOUNTANT, and PAYROLL_MASTER within 30 days. This single control closes the majority of credential-compromise attack vectors.'),
                ('D3-03', 'RBAC is enforced via the @Roles decorator on every mutating endpoint, with additional service-layer SOD checks (e.g., AP_ACCOUNTANT cannot self-post a bill they created — closed in audit fix H4). Role granularity is appropriate: 12+ distinct roles across owner, finance, sales, HR, and platform-admin tiers.', 'Informational', 'No action. Note as a strength.'),
                ('D3-04', 'No documented user-deprovisioning procedure. When a staff member resigns, the owner manually deactivates them via the Settings UI. There is no checklist covering: revoke kiosk PIN, revoke refresh tokens, revoke supervisor PIN, transfer outstanding pay-run authorisations, archive their email.', 'High', 'Author a 1-page "Employee Offboarding" runbook and add a one-click "Deprovision User" action that performs all five revocations atomically. Within 30 days.'),
                ('D3-05', 'Password policy is not enforced in the code path inspected. There is no minimum length, no complexity, no rotation policy, no breach-corpus check.', 'High', 'Enforce minimum 12 characters, reject the top-1000 known breached passwords (zxcvbn library), and prompt rotation on next login for any user whose hash predates this policy. Estimated effort: 1 day.'),
                ('D3-06', 'Session timeout (JWT 8h access + 30d refresh) is reasonable for a financial application but cannot be globally revoked — there is no "force logout all users" emergency switch.', 'Medium', 'Add a refresh-token revocation-all endpoint guarded behind SUPER_ADMIN + typed-slug confirmation. Useful during credential-compromise incident response.'),
                ('D3-07', 'Audit logging is partial. The AuditLog table exists, but several sensitive mutations (journal-entry post, journal-entry reverse, year-end close, payslip publish, salary change) do not write audit rows. The actor is captured in service-level columns (postedBy, createdBy) but old/new values are not retained.', 'High', 'Emit AuditLog rows from every sensitive mutation with before/after JSON. Target full coverage within 60 days; prioritize finance + payroll mutations first.'),
            ],
        },

        {
            'id':    'D4',
            'name':  '4. Segregation of Duties (SOD)',
            'objective': 'Verify that no single user can both initiate and approve, or both create and destroy, sensitive records.',
            'audit_questions': [
                'Can the user who creates a transaction also approve it?',
                'Can the user who posts a vendor bill also record the payment that clears it?',
                'Can a developer push code directly to production?',
                'Are SOD violations detected and reported?',
            ],
            'findings': [
                ('D4-01', 'SOD enforcement at the journal-entry layer is implemented: journal entries above the configured threshold (Tenant.jeApprovalThreshold) move to PENDING_APPROVAL, and the approver must differ from the creator. Closed during a prior sprint.', 'Informational', 'No action. Note as a strength.'),
                ('D4-02', 'AP_ACCOUNTANT-tier SOD was closed in the recent audit sprint: a single AP_ACCOUNTANT cannot self-post a bill they created (H4), and cannot disburse against a bill they posted (H5). This blocks the classic three-step embezzlement loop (create fake bill → post → pay) within a single user.', 'Informational', 'No action. Note as a strength of the post-audit baseline.'),
                ('D4-03', 'Returns/refunds are gated to BUSINESS_OWNER + SUPER_ADMIN only when Tenant.returnsOwnerOnly is enabled (default on for pharmacy tenants). Other verticals can configure. Compensating control: supervisor-PIN authorization (now throttled per audit fix H3).', 'Informational', 'No action.'),
                ('D4-04', 'Developer (founder) has direct push access to master and to Railway production. There is no peer-review gate, no deploy-protection branch rule, no separate operations engineer who could refuse a problematic release. This is the classic small-team trade-off.', 'High', 'Within 60 days, enable GitHub branch protection on master requiring at least one approving review for any change touching apps/api/src or packages/db/prisma. Use the founder\'s second account (or a contracted senior reviewer) as the approving party. Document the exception process for emergency hot-fixes.'),
                ('D4-05', 'No automated SOD violation detection or reporting exists. The existing /settings/sod-violations page enforces SOD at the user-create step but does not flag historical conflicts (e.g., a user who held two conflicting roles at different times).', 'Medium', 'Extend the SOD violations page to surface historical role-conflict events from AuditLog (once D3-07 lands) and to flag combinations not blocked at create time (e.g., AP_ACCOUNTANT + PAYROLL_MASTER).'),
                ('D4-06', 'No formal SOD matrix is published. The implicit matrix lives in the codebase via @Roles decorators. A non-technical reviewer (e.g. an external auditor) cannot read code and so cannot confirm enforcement.', 'Medium', 'Generate a printable SOD matrix from the @Roles decorators as part of the build pipeline. Publish a snapshot quarterly for review.'),
            ],
        },

        {
            'id':    'D5',
            'name':  '5. Application Controls',
            'objective': 'Verify the application validates input, encodes output, and protects business logic.',
            'audit_questions': [
                'Are all user inputs validated server-side?',
                'Is output encoded to prevent cross-site scripting?',
                'Are database queries parameterised against SQL injection?',
                'Are business-rule controls (period locks, balance validation) enforced at write time?',
                'Is the audit trail complete enough to reconstruct any transaction?',
            ],
            'findings': [
                ('D5-01', 'All API DTOs use class-validator decorators for type, format, and bounds checking on every mutating endpoint. Prisma ORM mediates all database access — SQL injection is structurally impossible. React/Next.js JSX auto-escapes output. These foundational controls are sound.', 'Informational', 'No action.'),
                ('D5-02', 'Period-lock guard (assertDateIsOpen) is now consistently called across all journal-entry write paths including the previously-bypassed expense-post path (closed in audit fix H2).', 'Informational', 'No action.'),
                ('D5-03', 'No general API rate limiting beyond the supervisor-PIN endpoint. A misbehaving client or scripted attacker could hammer any endpoint at maximum throughput.', 'Medium', 'Adopt a global rate limiter at the API gateway layer (Nest @nestjs/throttler with Redis backend, or a Cloudflare rate-limiting rule). Suggested defaults: 60 req/min per authenticated user, 10 req/min per unauthenticated IP.'),
                ('D5-04', 'CORS policy in production is not evidenced from the codebase audit. NestJS default CORS is permissive.', 'Medium', 'Explicitly configure allowed origins to the production web app URL only; verify via curl -H "Origin: https://evil.example" that requests are rejected.'),
                ('D5-05', 'Security response headers (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy) are not evidenced. Vercel may apply some defaults but production verification is required.', 'Medium', 'Add explicit security headers via Next.js middleware. Provide a script that calls securityheaders.com against the production URL and asserts an A-grade response.'),
                ('D5-06', 'Idempotency keys are not used on financial mutation endpoints (order create, payment record). A double-click during a slow network can post the same payment twice; the schema unique constraints catch some cases but not all.', 'High', 'Require an Idempotency-Key header on POST endpoints for orders, payments, refunds, and adjustments. Store the key + result in Redis or a dedicated table for 24h replay protection.'),
            ],
        },

        {
            'id':    'D6',
            'name':  '6. Security & Vulnerability Management',
            'objective': 'Verify the system stays current against known vulnerabilities and exposes minimum attack surface.',
            'audit_questions': [
                'How quickly are security advisories triaged and patched?',
                'Is dependency scanning automated?',
                'Are secrets handled outside source control?',
                'Has a penetration test ever been performed?',
            ],
            'findings': [
                ('D6-01', 'Secrets are correctly stored in Railway/Vercel environment variables, not in source. The .env.example contains placeholder values only. No hardcoded credentials were found during the source audit.', 'Informational', 'No action. Note as a strength.'),
                ('D6-02', 'No documented patching cadence. Dependency updates are ad-hoc, driven by feature work rather than security advisories.', 'High', 'Adopt a "patch HIGH/CRITICAL advisories within 7 days" SLA. Automate the detection via Dependabot (see D1-05) so triage is push-based rather than pull-based.'),
                ('D6-03', 'No penetration test has ever been performed against the application. The closest equivalent is the recent internal security audit, which is a code review, not an external red-team exercise.', 'High', 'Engage a third-party penetration test before going live with paying customers (or within 90 days, whichever sooner). A Philippine-market boutique can deliver a focused web-app pentest for ~₱150,000-300,000.'),
                ('D6-04', 'HSTS, CSP, and other transport-security headers were flagged in D5-05; cross-referenced here.', 'Medium', 'See D5-05.'),
            ],
        },

        {
            'id':    'D7',
            'name':  '7. Governance & Policy',
            'objective': 'Verify written policies, procedures, and oversight structures govern the application\'s operation.',
            'audit_questions': [
                'Is there a written Information Security Policy?',
                'How is code change reviewed, approved, and deployed?',
                'Who owns vendor / third-party risk?',
                'Is there a Data Protection Officer (DPO) registered with the NPC?',
                'How complete and current is the system documentation?',
            ],
            'findings': [
                ('D7-01', 'No written Information Security Policy. Practices are implicit in the developer\'s habits, not documented for successors or external auditors.', 'High', 'Author a one-page Information Security Policy covering: data classification, acceptable use, password requirements, incident reporting, vendor management. Use NIST CSF or ISO 27001 Annex A as the structural skeleton.'),
                ('D7-02', 'Change management is informal: founder commits to master, Railway auto-deploys. There is no peer review, no automated security gate, no deploy-time canary, no rollback runbook.', 'High', 'See D4-04 (branch protection) and add: required CI green-build before deploy, GitHub Action that posts a Slack/email notification on every production deploy, runbook for "how to roll back" with one-line commands.'),
                ('D7-03', 'No designated Data Protection Officer (DPO). RA 10173 requires personal-information controllers handling sensitive personal information to register a DPO with the National Privacy Commission. Clerque handles employee records (TIN, SSS, PhilHealth, salaries), customer PII, and BIR-mandated retention data — squarely in scope.', 'Critical', 'Designate a DPO within 30 days. May be the founder for the initial phase but must be formally appointed in writing. Register the role and the data-processing system with the NPC via the online portal. Cost: zero; effort: 4 hours of paperwork.'),
                ('D7-04', 'No documented vendor / third-party risk register. Critical vendors include Anthropic (AI), Cloudflare (R2 + soon WAF), Railway (compute + DB), Vercel (web hosting), Resend (email). Each carries its own breach-risk that compounds with the others.', 'Medium', 'Maintain a one-page vendor register: vendor name, data shared, contract URL, last security review date. Review semi-annually.'),
                ('D7-05', 'System architecture documentation exists in the form of memory files (project_clerque.md, arch_decisions.md) but is not in a standard format and is not version-controlled in the public repo. A new joiner has no formal onboarding doc.', 'Medium', 'Convert the memory files into a /docs folder in the repo with sections: Architecture, Data Flows, Runbooks, Deployment. Update at the end of every feature sprint.'),
                ('D7-06', 'No documented Incident Response Plan. This is expanded under Domain 10 (Threat Scenarios).', 'Critical', 'See Domain 10 findings.'),
            ],
        },

        {
            'id':    'D8',
            'name':  '8. Monitoring & Logging',
            'objective': 'Verify the operational state of the system is continuously visible and abnormal conditions are detected.',
            'audit_questions': [
                'Are application and infrastructure logs collected, searchable, and retained?',
                'Are there alerts for failed logins, slow queries, error spikes, downtime?',
                'Is log integrity protected against tampering?',
                'Is uptime continuously measured and reported?',
            ],
            'findings': [
                ('D8-01', 'Application logs flow to Railway\'s built-in log viewer (default 30-day retention on the Hobby plan, 7 days on free). There is no log aggregation, full-text search, or long-term archive.', 'Medium', 'Forward Railway logs to a managed log platform (Better Stack, Axiom, or self-hosted Loki). 90-day searchable retention minimum for an application processing financial data; longer if BIR/SEC review may require it.'),
                ('D8-02', 'No uptime monitoring confirmed. UptimeRobot is recommended in INFRA_SETUP.md but configuration has not been evidenced.', 'High', 'Configure UptimeRobot or BetterUptime to ping the /health endpoint every minute from at least two geographies. Alert via email + SMS on consecutive failures.'),
                ('D8-03', 'No application error tracking (Sentry / Rollbar / similar) confirmed. Production exceptions are visible only by tailing Railway logs after the fact.', 'High', 'Configure Sentry for the API and the web app. Set release-tagging to capture which deploy introduced an error. Free tier is sufficient for current volumes.'),
                ('D8-04', 'No anomaly alerts. Failed-login spikes, AccountingEvent failure clusters, and AI-budget exhaustion are visible only in logs and dashboards, not pushed to a human.', 'Medium', 'Add three pushed alerts: (1) >10 failed logins from one IP in 5 minutes, (2) >5 AccountingEvent rows in FAILED status, (3) AI monthly spend >80% of cap for any tenant.'),
                ('D8-05', 'No log integrity protection. Logs are mutable on the Railway side and within Postgres. There is no append-only audit log streamed to immutable storage.', 'Medium', 'For audit-grade logs (financial mutations, role changes, void/refund actions): stream a copy to the same R2 bucket as backups, daily, with Object Lock retention.'),
            ],
        },

        {
            'id':    'D9',
            'name':  '9. Human Factors & Organizational Controls',
            'objective': 'Verify the people-and-process layer around the application reduces accidental and intentional risk.',
            'audit_questions': [
                'Is there a security awareness program?',
                'What happens when a staff member or founder is unavailable?',
                'How is knowledge transferred to a successor?',
            ],
            'findings': [
                ('D9-01', 'No security awareness training program exists. This is expected for a founder-led pre-revenue stage but creates risk as tenants onboard their own staff onto Clerque.', 'Low', 'Within 6 months, publish a 5-minute video for tenant owners covering: phishing recognition, password hygiene, supervisor-PIN protection, what to do if a device is stolen. Embed in the onboarding flow.'),
                ('D9-02', 'Key-person dependency is high. The founder is the sole developer, sole admin, sole DPO candidate, and sole incident responder. Loss of availability (illness, accident) would suspend the recovery loop entirely.', 'High', 'Identify a single trusted technical contact (former colleague, contracted developer) and grant them read-access to the codebase + Railway + R2 with documented incident-response authority. Refresh quarterly.'),
                ('D9-03', 'Bus factor = 1 for code understanding. While documentation exists, no second engineer has worked through the codebase end-to-end.', 'High', 'See D9-02 and add: have the secondary engineer perform a paid 8-hour "shadow review" of the codebase and write a "where to look first" runbook for their future self.'),
            ],
        },

        {
            'id':    'D10',
            'name':  '10. Cyber Incident Response & Threat Scenarios',
            'objective': 'Verify documented, tested procedures exist for each high-impact threat scenario.',
            'audit_questions': [],  # Handled in the dedicated scenarios section
            'findings': [
                ('D10-A', 'RANSOMWARE: No documented playbook. Off-box backups exist (mitigates impact) but R2 Object Lock not confirmed enabled (see D1-06). No tabletop exercise ever conducted. Authority for ransom-payment decisions undefined.', 'Critical', 'Within 30 days: (a) enable R2 Object Lock with 30-day retention, (b) author a 1-page ransomware response playbook covering detect→isolate→notify→restore, (c) conduct a tabletop exercise with at least one non-founder participant.'),
                ('D10-B', 'MALWARE: Server-side AV is the responsibility of Railway (managed). Workstation AV (founder\'s laptop) is implicit. No isolation procedure for an infected developer machine that has push access to master.', 'Medium', 'Enable Microsoft Defender (or equivalent) on the founder\'s development machine. Document a "lost / stolen laptop" procedure: rotate all Railway tokens, R2 keys, GitHub tokens, JWT secret; force-revoke all sessions.'),
                ('D10-C', 'DATA BREACH: No response plan aligned to RA 10173. No DPO. No 72-hour NPC notification procedure. No documented playbook for forensic identification of "what data was accessed by whom and when". This is the single highest regulatory-risk finding.', 'Critical', 'Within 30 days: (a) designate and register DPO with NPC, (b) author a Data Breach Response Procedure with 72h NPC notification template, (c) define forensic IR scope (which logs, which database snapshots), (d) document the affected-individual notification template.'),
                ('D10-D', 'INSIDER THREAT: No bulk-download detection, no privileged-action review cadence, no whistleblower mechanism. Termination access revocation is manual (see D3-04).', 'High', 'Within 60 days: (a) build a "User exported >100 customer records in 1 hour" alert, (b) commit to a quarterly review of all SUPER_ADMIN and BUSINESS_OWNER actions from the AuditLog (once D3-07 lands), (c) publish a security@clerque.ph reporting address with a no-retaliation commitment.'),
                ('D10-E', 'DoS/DDoS: Partial protection from Railway + Vercel platform defaults. No application-layer rate limiting (D5-03). No documented response procedure. No defined RTO for this scenario.', 'High', 'Front the API with Cloudflare (D1-04) for DDoS + rate limiting in one stroke. Define RTO=15 minutes for DDoS scenarios in the DRP. Status-page template (status.clerque.ph) for customer communications during downtime.'),
                ('D10-F', 'CREDENTIAL COMPROMISE: No mass-password-reset procedure. No session-mass-revocation endpoint (D3-06). No MFA enforcement (D3-02). A leaked owner password is a full breach with no compensating control.', 'Critical', 'Within 30 days: (a) ship MFA (D3-02), (b) ship mass-session-revocation (D3-06), (c) document the credential-compromise playbook covering both controls plus a forensic step to identify "what did the attacker access while the session was live".'),
                ('D10-G', 'SUPPLY CHAIN COMPROMISE: package-lock.json provides integrity pinning (mitigates). No automated advisory monitoring (D1-05). No documented response procedure for a "compromised npm package" event.', 'Medium', 'Adopt Dependabot (D1-05). Document the supply-chain response: lock the master branch, pin previous-known-good package version, roll forward only after Anthropic/community confirms a clean release.'),
            ],
        },
    ],

    'sod_matrix': {
        'roles': [
            'BUSINESS_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD',
            'ACCOUNTANT', 'AP_ACCOUNTANT', 'BOOKKEEPER',
            'PAYROLL_MASTER', 'HR_STAFF', 'WAREHOUSE_STAFF',
            'MDM', 'SUPER_ADMIN',
        ],
        'functions': [
            'Create JE',          # journal entry
            'Approve JE',
            'Create AP Bill',
            'Post AP Bill',
            'Pay AP Bill',
            'Issue Refund',
            'Run Payroll',
            'Set Salary',
            'Adjust Inventory',
            'Manage Users',
            'Restore Backup',
        ],
        # 'Y' = allowed by code; '·' = not allowed; '!' = allowed BUT SOD-gated
        'cells': {
            ('BUSINESS_OWNER',  'Create JE'):        'Y',
            ('BUSINESS_OWNER',  'Approve JE'):       'Y',
            ('BUSINESS_OWNER',  'Create AP Bill'):   'Y',
            ('BUSINESS_OWNER',  'Post AP Bill'):     'Y',
            ('BUSINESS_OWNER',  'Pay AP Bill'):      'Y',
            ('BUSINESS_OWNER',  'Issue Refund'):     'Y',
            ('BUSINESS_OWNER',  'Run Payroll'):      'Y',
            ('BUSINESS_OWNER',  'Set Salary'):       'Y',
            ('BUSINESS_OWNER',  'Adjust Inventory'): 'Y',
            ('BUSINESS_OWNER',  'Manage Users'):     'Y',
            ('BUSINESS_OWNER',  'Restore Backup'):   '·',

            ('BRANCH_MANAGER',  'Create JE'):        '·',
            ('BRANCH_MANAGER',  'Approve JE'):       '·',
            ('BRANCH_MANAGER',  'Issue Refund'):     '!',  # owner-only flag default for pharmacy
            ('BRANCH_MANAGER',  'Adjust Inventory'): 'Y',
            ('BRANCH_MANAGER',  'Manage Users'):     'Y',

            ('CASHIER',         'Issue Refund'):     '!',  # supervisor-PIN required
            ('CASHIER',         'Adjust Inventory'): '·',

            ('SALES_LEAD',      'Issue Refund'):     '!',
            ('SALES_LEAD',      'Manage Users'):     'Y',

            ('ACCOUNTANT',      'Create JE'):        'Y',
            ('ACCOUNTANT',      'Approve JE'):       '!',  # createdBy != approverBy
            ('ACCOUNTANT',      'Post AP Bill'):     'Y',
            ('ACCOUNTANT',      'Pay AP Bill'):      'Y',

            ('AP_ACCOUNTANT',   'Create AP Bill'):   'Y',
            ('AP_ACCOUNTANT',   'Post AP Bill'):     '!',  # not on own bills (H4)
            ('AP_ACCOUNTANT',   'Pay AP Bill'):      '!',  # not on bills they posted (H5)

            ('BOOKKEEPER',      'Create JE'):        'Y',

            ('PAYROLL_MASTER',  'Run Payroll'):      'Y',
            ('PAYROLL_MASTER',  'Set Salary'):       'Y',

            ('HR_STAFF',        'Set Salary'):       '·',

            ('WAREHOUSE_STAFF', 'Adjust Inventory'): 'Y',
            ('MDM',             'Adjust Inventory'): 'Y',

            ('SUPER_ADMIN',     'Create JE'):        'Y',
            ('SUPER_ADMIN',     'Approve JE'):       'Y',
            ('SUPER_ADMIN',     'Create AP Bill'):   'Y',
            ('SUPER_ADMIN',     'Post AP Bill'):     'Y',
            ('SUPER_ADMIN',     'Pay AP Bill'):      'Y',
            ('SUPER_ADMIN',     'Issue Refund'):     'Y',
            ('SUPER_ADMIN',     'Run Payroll'):      'Y',
            ('SUPER_ADMIN',     'Set Salary'):       'Y',
            ('SUPER_ADMIN',     'Adjust Inventory'): 'Y',
            ('SUPER_ADMIN',     'Manage Users'):     'Y',
            ('SUPER_ADMIN',     'Restore Backup'):   'Y',
        },
    },

    'heatmap': {
        # domain → overall rating
        'Infrastructure & Architecture':     'High',
        'Data Management & Backup':          'Medium',
        'Access Control & Identity':         'Critical',
        'Segregation of Duties':             'Medium',
        'Application Controls':              'Medium',
        'Security & Vulnerability Mgmt':     'High',
        'Governance & Policy':               'Critical',
        'Monitoring & Logging':              'High',
        'Human Factors':                     'High',
        'Incident Response & Threats':       'Critical',
    },

    'action_plan': [
        # (finding_id, mgmt_response, owner, target_date, status)
        ('D1-06', 'Enable R2 Object Lock with 30-day compliance retention',           'Founder',         '2026-05-25', 'Open'),
        ('D3-02', 'Ship TOTP MFA for OWNER/SUPER_ADMIN/ACCOUNTANT/AP/PAYROLL',         'Founder',         '2026-06-10', 'Open'),
        ('D7-03', 'Designate DPO; register with NPC',                                  'Founder',         '2026-06-10', 'Open'),
        ('D10-A','Author ransomware playbook + tabletop',                              'Founder',         '2026-06-10', 'Open'),
        ('D10-C','Author data-breach response procedure (RA 10173 §38)',               'DPO (when assigned)','2026-06-10', 'Open'),
        ('D10-F','Mass-session-revocation endpoint + credential-compromise playbook',  'Founder',         '2026-06-10', 'Open'),
        ('D2-02','Conduct documented restore drill on staging',                        'Founder',         '2026-06-10', 'Open'),
        ('D2-04','Author 6-scenario DRP',                                              'Founder',         '2026-06-25', 'Open'),
        ('D4-04','Enable branch protection on master; secondary reviewer',             'Founder',         '2026-07-10', 'Open'),
        ('D6-03','Engage third-party penetration test',                                'Founder',         '2026-08-10', 'Open'),
    ],

    'conclusion': (
        'It is the auditor\'s opinion that the Clerque application has, at the code layer, an above-baseline '
        'security posture for a small Philippine SaaS in its current stage of maturity. The recent internal '
        'security audit closed all ten HIGH-severity loopholes identified, and the new admin-restore endpoint '
        'closes the catastrophic-loss recovery gap. However, the application is materially deficient in the '
        'governance, incident-response, and identity-protection wrappers expected of a production financial '
        'system handling Philippine BIR-regulated ledger data and Data Privacy Act-protected employee records. '
        'The single most urgent finding is the absence of MFA enforcement combined with no designated DPO and '
        'no documented data-breach response procedure — a credential compromise today would trigger NPC '
        'notification obligations the organisation is not currently positioned to meet.\n\n'

        'Subject to remediation of the Critical findings within 30 days and the High findings within 90 days, '
        'the audit opinion can be uplifted from "Needs Improvement" to "Satisfactory" on the next review cycle.'
    ),
}


# ════════════════════════════════════════════════════════════════════════════
# Rendering
# ════════════════════════════════════════════════════════════════════════════

def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle(name='CoverTitle',    parent=ss['Title'],   fontSize=28, textColor=BROWN, alignment=TA_CENTER, spaceAfter=18))
    ss.add(ParagraphStyle(name='CoverSubtitle', parent=ss['Title'],   fontSize=18, textColor=INK,   alignment=TA_CENTER, spaceAfter=24))
    ss.add(ParagraphStyle(name='CoverMeta',     parent=ss['Normal'],  fontSize=11, textColor=MUTED, alignment=TA_CENTER, spaceAfter=8))
    ss.add(ParagraphStyle(name='H1',            parent=ss['Heading1'],fontSize=18, textColor=BROWN, spaceBefore=18, spaceAfter=10))
    ss.add(ParagraphStyle(name='H2',            parent=ss['Heading2'],fontSize=14, textColor=INK,   spaceBefore=12, spaceAfter=6))
    ss.add(ParagraphStyle(name='Body',          parent=ss['BodyText'],fontSize=10, leading=14, alignment=TA_JUSTIFY, textColor=INK, spaceAfter=8))
    ss.add(ParagraphStyle(name='Caption',       parent=ss['BodyText'],fontSize=9,  leading=12, textColor=MUTED, alignment=TA_LEFT, spaceAfter=4))
    ss.add(ParagraphStyle(name='SmallBody',     parent=ss['BodyText'],fontSize=9,  leading=12, textColor=INK,  alignment=TA_LEFT))
    ss.add(ParagraphStyle(name='TableCell',     parent=ss['BodyText'],fontSize=8,  leading=10, textColor=INK,  alignment=TA_LEFT))
    return ss


def _rating_pill(text, ss):
    """Return a coloured Paragraph for a risk rating cell."""
    colour = RATING_COLORS.get(text, MUTED)
    style = ParagraphStyle(
        f'rate_{text}', parent=ss['TableCell'],
        textColor=colors.white, alignment=TA_CENTER, fontSize=8, leading=10,
        backColor=colour,
        borderPadding=2,
    )
    return Paragraph(f'<b>{text}</b>', style)


def _cover(ss):
    cover = AUDIT_DATA['cover']
    return [
        Spacer(1, 1.5 * inch),
        Paragraph(cover['title'],    ss['CoverTitle']),
        Paragraph(cover['subtitle'], ss['CoverSubtitle']),
        Spacer(1, 0.8 * inch),
        Paragraph(cover['period'],          ss['CoverMeta']),
        Paragraph('Prepared by: ' + cover['prepared_by'], ss['CoverMeta']),
        Spacer(1, 2.5 * inch),
        Paragraph('<b>Classification:</b> ' + cover['classification'], ss['CoverMeta']),
        PageBreak(),
    ]


def _executive_summary(ss):
    es = AUDIT_DATA['executive_summary']
    elems = [Paragraph('Executive Summary', ss['H1'])]
    elems.append(Paragraph('Overall Audit Opinion', ss['H2']))
    elems.append(_rating_pill(es['overall_opinion'], ss))
    elems.append(Spacer(1, 6))
    elems.append(Paragraph(es['opinion_rationale'], ss['Body']))

    elems.append(Paragraph('Findings Totals by Risk Rating', ss['H2']))
    header = ['Rating', 'Count']
    rows = [header] + [[k, str(v)] for k, v in es['findings_totals'].items()]
    tbl = Table(rows, colWidths=[2.5 * inch, 1.0 * inch])
    tstyle = [
        ('BACKGROUND', (0, 0), (-1, 0), CREAM),
        ('TEXTCOLOR',  (0, 0), (-1, 0), INK),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D4CFC4')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]
    for i, (k, _) in enumerate(es['findings_totals'].items(), start=1):
        tstyle.append(('TEXTCOLOR', (0, i), (0, i), RATING_COLORS.get(k, INK)))
        tstyle.append(('FONTNAME',  (0, i), (0, i), 'Helvetica-Bold'))
    tbl.setStyle(TableStyle(tstyle))
    elems.append(tbl)

    elems.append(Paragraph('Top 3 Critical Issues Requiring Immediate Attention', ss['H2']))
    for i, item in enumerate(es['top_3_critical'], start=1):
        elems.append(Paragraph(f'<b>{i}.</b> {item}', ss['Body']))

    elems.append(Paragraph('Overall Risk Posture', ss['H2']))
    for para in es['narrative'].split('\n\n'):
        elems.append(Paragraph(para.strip(), ss['Body']))
    elems.append(PageBreak())
    return elems


def _findings_table(domain, ss):
    """Build the per-domain findings table."""
    header = ['ID', 'Observation', 'Rating', 'Recommendation']
    data = [header]
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), CREAM),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('TEXTCOLOR',  (0, 0), (-1, 0), INK),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#D4CFC4')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    for idx, (fid, obs, rating, rec) in enumerate(domain['findings'], start=1):
        data.append([
            Paragraph(fid, ss['TableCell']),
            Paragraph(obs, ss['TableCell']),
            _rating_pill(rating, ss),
            Paragraph(rec, ss['TableCell']),
        ])
    tbl = Table(data, colWidths=[0.55 * inch, 2.7 * inch, 0.8 * inch, 2.7 * inch], repeatRows=1)
    tbl.setStyle(TableStyle(style))
    return tbl


def _domain_section(domain, ss):
    elems = [Paragraph(domain['name'], ss['H1'])]
    elems.append(Paragraph('<b>Objective:</b> ' + domain['objective'], ss['Body']))
    if domain['audit_questions']:
        elems.append(Paragraph('Key Audit Questions', ss['H2']))
        for q in domain['audit_questions']:
            elems.append(Paragraph('• ' + q, ss['SmallBody']))
        elems.append(Spacer(1, 6))
    elems.append(Paragraph('Findings', ss['H2']))
    elems.append(_findings_table(domain, ss))
    elems.append(PageBreak())
    return elems


def _sod_matrix(ss):
    sod = AUDIT_DATA['sod_matrix']
    elems = [Paragraph('Segregation of Duties Matrix', ss['H1'])]
    elems.append(Paragraph(
        'Legend: <b>Y</b> = role is permitted to perform this function; '
        '<b>!</b> = permitted but with an SOD or compensating control gate '
        '(e.g. AP_ACCOUNTANT cannot self-post a bill they created); '
        '<b>·</b> = not permitted.',
        ss['Caption']))
    elems.append(Spacer(1, 6))

    header = ['Role'] + sod['functions']
    rows = [header]
    for role in sod['roles']:
        row = [role]
        for fn in sod['functions']:
            row.append(sod['cells'].get((role, fn), '·'))
        rows.append(row)

    n_cols = len(header)
    col_w = (8.5 - 1.0) * inch / n_cols  # fit US Letter portrait with 0.5" margins
    tbl = Table(rows, colWidths=[col_w * 1.6] + [col_w * 0.85] * (n_cols - 1), repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), CREAM),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE',   (0, 0), (-1, -1), 7),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#D4CFC4')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN',  (1, 1), (-1, -1), 'CENTER'),
        ('LEFTPADDING',  (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING',   (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 3),
    ]
    # Colour cells by content
    for r_idx, role in enumerate(sod['roles'], start=1):
        for c_idx, fn in enumerate(sod['functions'], start=1):
            v = sod['cells'].get((role, fn), '·')
            if v == 'Y':
                style.append(('BACKGROUND', (c_idx, r_idx), (c_idx, r_idx), colors.HexColor('#DCFCE7')))  # green-100
            elif v == '!':
                style.append(('BACKGROUND', (c_idx, r_idx), (c_idx, r_idx), colors.HexColor('#FEF3C7')))  # amber-100
            else:
                style.append(('BACKGROUND', (c_idx, r_idx), (c_idx, r_idx), colors.HexColor('#F3F4F6')))  # gray-100
    tbl.setStyle(TableStyle(style))
    elems.append(tbl)
    elems.append(PageBreak())
    return elems


def _heatmap(ss):
    elems = [Paragraph('Summary Risk Heatmap', ss['H1'])]
    elems.append(Paragraph('Overall risk rating per domain. Colour codes match individual findings.', ss['Caption']))
    elems.append(Spacer(1, 6))

    rows = [['Domain', 'Overall Risk']]
    for d, r in AUDIT_DATA['heatmap'].items():
        rows.append([d, _rating_pill(r, ss)])
    tbl = Table(rows, colWidths=[4.5 * inch, 1.8 * inch], repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), CREAM),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#D4CFC4')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING',    (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elems.append(tbl)
    elems.append(PageBreak())
    return elems


def _action_plan(ss):
    elems = [Paragraph('Management Action Plan Template', ss['H1'])]
    elems.append(Paragraph(
        'Recommended priority order. Critical-tier items should be discharged within 30 days; '
        'High-tier within 90 days. Management to update status quarterly.',
        ss['Caption']))
    elems.append(Spacer(1, 6))
    rows = [['Finding ID', 'Management Response', 'Owner', 'Target Date', 'Status']]
    for fid, resp, owner, dt, status in AUDIT_DATA['action_plan']:
        rows.append([
            Paragraph(fid, ss['TableCell']),
            Paragraph(resp, ss['TableCell']),
            Paragraph(owner, ss['TableCell']),
            Paragraph(dt, ss['TableCell']),
            Paragraph(status, ss['TableCell']),
        ])
    tbl = Table(rows, colWidths=[0.7 * inch, 3.0 * inch, 1.1 * inch, 1.0 * inch, 0.7 * inch], repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), CREAM),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#D4CFC4')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elems.append(tbl)
    elems.append(PageBreak())
    return elems


def _conclusion(ss):
    elems = [Paragraph("Auditor's Conclusion", ss['H1'])]
    for para in AUDIT_DATA['conclusion'].split('\n\n'):
        elems.append(Paragraph(para.strip(), ss['Body']))
    elems.append(Spacer(1, 30))
    elems.append(Paragraph('— AI Internal Auditor (Claude)', ss['Body']))
    elems.append(Paragraph(date.today().strftime('%d %B %Y'), ss['Caption']))
    return elems


def _on_page(canvas, doc):
    """Header (right-aligned title on every page except page 1) + footer + page numbers."""
    canvas.saveState()
    page_num = canvas.getPageNumber()
    # Footer — classification on every page
    canvas.setFont('Helvetica-Oblique', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.5 * inch, 0.35 * inch, 'Confidential — Internal Use Only')
    canvas.drawRightString(LETTER[0] - 0.5 * inch, 0.35 * inch, f'Page {page_num}')
    # Top rule on non-cover pages
    if page_num > 1:
        canvas.setStrokeColor(BROWN)
        canvas.setLineWidth(0.6)
        canvas.line(0.5 * inch, LETTER[1] - 0.55 * inch, LETTER[0] - 0.5 * inch, LETTER[1] - 0.55 * inch)
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(0.5 * inch, LETTER[1] - 0.45 * inch, 'Internal Audit Report — Clerque Application')
    canvas.restoreState()


def build(out_path='clerque_internal_audit_report.pdf'):
    doc = BaseDocTemplate(
        out_path, pagesize=LETTER,
        leftMargin=0.5 * inch, rightMargin=0.5 * inch,
        topMargin=0.7 * inch,  bottomMargin=0.6 * inch,
        title='Internal Audit Report — Clerque Application',
        author='AI Internal Auditor (Claude)',
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id='main')
    doc.addPageTemplates([PageTemplate(id='main', frames=frame, onPage=_on_page)])

    ss = _styles()
    story = []
    story += _cover(ss)
    story += _executive_summary(ss)
    for domain in AUDIT_DATA['domains']:
        story += _domain_section(domain, ss)
    story += _sod_matrix(ss)
    story += _heatmap(ss)
    story += _action_plan(ss)
    story += _conclusion(ss)

    doc.build(story)
    print(f'Wrote {out_path}')


if __name__ == '__main__':
    build()
