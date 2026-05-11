# Information Security Policy

**Document ID:** D7-01
**Owner:** Kristian JV Sacdalan (Founder, acting DPO)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11
**Framework:** NIST Cybersecurity Framework (CSF) v1.1

---

## 1. Purpose

This policy defines how Clerque protects the confidentiality, integrity, and availability of information entrusted to us by our tenant organisations (Philippine SMEs operating POS, Ledger, and Payroll workloads). It is the umbrella document; all other policies and runbooks in `docs/` inherit from it.

## 2. Scope

Applies to:

- All Clerque production systems: NestJS API on Railway, Next.js web on Vercel, Postgres on Railway, Cloudflare R2 for backups, and any third-party processor listed in `VENDORS.md`.
- All personnel (founder, contractors, future employees) with access to any of the above.
- All tenant data — including but not limited to BIR-required ledger evidence, employee TIN/SSS/PhilHealth records, salary, supervisor PINs, and customer information.

## 3. Data classification

Three tiers, defined in detail in `DATA_CLASSIFICATION.md`:

1. **PUBLIC** — marketing site copy, pricing page.
2. **INTERNAL** — operational metrics, aggregated reports, infra dashboards.
3. **SENSITIVE-PII** — everything covered by RA 10173 (PH Data Privacy Act), all BIR-required evidence, all employee compensation data, and all credential material (PINs, refresh tokens, JWT secrets).

Default classification when in doubt: **SENSITIVE-PII**.

## 4. Acceptable use

- Production credentials are never stored in plaintext outside of Railway/Vercel/Cloudflare secret stores or a sealed password manager. They are never pasted into Slack, email, browser URL bars, AI prompts, or git-tracked files.
- Founder/admin work on production happens only from a device with full-disk encryption and an auto-lock under 5 minutes.
- No tenant SENSITIVE-PII is ever copied to a personal device or personal cloud account.
- Anthropic prompts must not contain raw tenant PII — the AI Drafter is configured to send COA names and memos only; see `VENDORS.md` entry for Anthropic.

## 5. Password & authentication requirements

- **Length:** minimum 12 characters for any human-typed credential (founder, admin, super-admin, tenant employee). Supervisor PINs may be 6+ digits but must be unique per user and rate-limited (already enforced server-side).
- **Breach check:** before set or rotation, run the candidate password through HaveIBeenPwned k-anonymity API. Reject any hash with `count > 0`.
- **Rotation:** time-based rotation is NOT required. Rotation is triggered by:
  - Suspicion of compromise (credential found in a paste, phishing report, malware on the device that handled it).
  - Personnel departure (`EMPLOYEE_OFFBOARDING.md`).
  - Loss of the device that stored the password manager (`MALWARE_LOST_LAPTOP.md`).
- **MFA:** mandatory for all admin and super-admin accounts. The `invoke MFA enforce` admin action must be used after any credential-compromise event.
- **Storage:** server-side passwords use argon2id; client-side users use a sealed password manager (1Password / Bitwarden / iCloud Keychain).

## 6. Incident reporting

- **Channel:** `security@clerque.ph`. Monitored by the founder during business hours and on a phone push 24/7. Acknowledgement target: 4 hours.
- **What to report:** anything that *might* be a security issue — suspected phishing, an unfamiliar device alert, an unexpected admin action, a missing or modified file in R2, a regulator inquiry, an oddly-behaving dependency.
- **No retaliation:** any person — employee, contractor, customer, security researcher, or bystander — who reports a suspected issue in good faith will not be punished, even if the report turns out to be a false alarm. This protection applies regardless of seniority or relationship.
- **Escalation:** the receiver opens an entry in the IR log and invokes the matching scenario in `INCIDENT_RESPONSE.md`. Sev-1 events page the founder immediately.

## 7. Vendor management

All third parties that process, store, or transmit Clerque data are listed in `VENDORS.md` with risk tier and last-review date. New vendors require:

1. Written confirmation of what data they will see.
2. Their public security or DPA documentation linked from `VENDORS.md`.
3. Risk-tier assignment by the DPO before any production traffic is routed to them.

Vendor review cadence is annual or sooner if a vendor announces a breach.

---

## NIST CSF organisation

### Identify

- Asset inventory: `VENDORS.md` plus the Prisma schema (source of truth for data assets) — see the model-to-tier table in `DATA_CLASSIFICATION.md`.
- Risk register: see the audit report `../SECURITY_AUDIT_2026-05-08.md`; this policy and its siblings close the audit-flagged governance gaps.
- Legal: RA 10173 (PH Data Privacy Act), NPC Circular 16-03 (breach notification), BIR record-keeping rules (10 years for accounting evidence).

### Protect

- Identity & access: MFA on admin tier; supervisor-PIN rate-limiting; argon2id at-rest hashing; per-tenant row-level scoping enforced in NestJS guards.
- Data: TLS in transit; encrypted at rest in Railway Postgres; off-box backups to R2 with Object Lock (immutable) — nightly 02:00 UTC, ~25 tables, RPO ≈ 24h.
- Training: this policy is mandatory reading for every contractor before access provisioning.

### Detect

- Logging: `AuditLog`, `LoginLog`, `ConsoleLog` models capture admin and auth events.
- Monitoring: UptimeRobot for liveness; Sentry (planned) for error spikes; weekly review of admin-action AuditLog entries by the founder.

### Respond

- Master playbook: `INCIDENT_RESPONSE.md` — seven threat scenarios, each with isolation → evidence → eradication → recovery → post-mortem.
- Regulator: data breach involving PII triggers the NPC 72-hour notification path under RA 10173 §38 — see `INCIDENT_RESPONSE.md` § Data Breach.

### Recover

- Backups: nightly R2 with Object Lock; restore via `POST /admin/backups/:slug/restore`.
- DR scenarios: `DISASTER_RECOVERY.md`.
- Lessons-learned: every sev-1 produces a post-mortem appended to `INCIDENT_RESPONSE.md` history.

---

## 8. Review cadence

This policy is reviewed annually by the DPO. Material changes (new vendor tier, new regulator obligation, new data class) trigger an ad-hoc review and bump the **Last reviewed** date at the top of this file.
