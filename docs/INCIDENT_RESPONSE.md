# Incident Response Playbook

**Document ID:** D10-A through D10-G
**Owner:** Kristian JV Sacdalan (Founder, acting DPO)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11

---

## How to use this document

When you suspect an incident:

1. Identify the scenario below that best matches.
2. Work top-to-bottom: **Detect → Isolate → Evidence → Eradicate → Recover → Post-mortem**.
3. Log every action in the IR log with timestamps (PHT). The IR log is a single dated markdown file at `tasks/ir-<YYYY-MM-DD>-<slug>.md`.
4. If you can't decide which scenario fits, default to **D10-C Data Breach** because it has the strictest legal clock (NPC 72 hours).

Severity:

- **Sev-1**: tenant data exposed, full outage > 1 h, or regulator-reportable.
- **Sev-2**: degraded service or a single tenant affected.
- **Sev-3**: internal-only or contained.

Contact: `security@clerque.ph`. Sev-1 also pages founder phone.

---

## D10-A — Ransomware

### Detection signals
- Files in R2 unexpectedly renamed with `.encrypted` / `.locked` / unfamiliar extension.
- Ransom note appearing in any tenant's `Document` records or in R2 bucket root.
- Sudden surge of `DELETE` operations in AuditLog by a single actor.
- Bitlocker/FileVault prompt on founder laptop on next boot.

### Immediate isolation (in order)
1. Revoke the suspected actor's session — `POST /admin/users/:id/sessions/revoke-all`.
2. Disable the R2 API token in Cloudflare dashboard → R2 → Manage tokens.
3. Set `PlatformConfig.READONLY = true` to freeze writes.
4. Disconnect the affected laptop from the network (Wi-Fi off, ethernet unplugged). Do **not** power it off — RAM may contain the key.

### Evidence collection
- Snapshot the R2 bucket listing (no need to download — Object Lock keeps history).
- Export AuditLog for the last 30 days.
- Photograph the ransom note (do not click anything in it).

### Eradication
- Image the affected laptop for forensics, then full-disk wipe.
- Rotate every credential listed in `MALWARE_LOST_LAPTOP.md`.

### Recovery
- Restore each affected tenant via `POST /admin/backups/:slug/restore`. R2 Object Lock means the immutable backups predate any attacker write.
- Verify tenant data with the smoke-test suite.
- Re-enable writes.

### Do we pay? — Decision tree
```
Are off-box, immutable backups intact in R2 (Object Lock = yes)?
  └── YES  → do NOT pay. Restore from backup.   ← DEFAULT path for Clerque
  └── NO   → still do NOT pay without consulting NPC and legal counsel.
            Paying funds future attacks, does not guarantee data return,
            and is reportable to the BSP/AMLC if routed through PH banking.
```

The default Clerque answer is **NO** because:
- Backups are immutable (R2 Object Lock).
- The restore endpoint is tested quarterly (see `DISASTER_RECOVERY.md` § Restore drill SOP).
- The maximum data loss is bounded by the 24 h RPO.

### Post-mortem template
- Timeline (PHT).
- Initial vector (phishing? supply chain? stolen creds?).
- Data exposed (if any — if yes, escalate also as D10-C).
- What detective control should have caught this sooner?
- Action items with owners and dates.

---

## D10-B — Malware / Lost or Stolen Laptop

See the dedicated runbook: **`MALWARE_LOST_LAPTOP.md`**.

Summary of what that doc covers: step-by-step rotation of Railway tokens, R2 access keys, GitHub PAT/SSH, JWT secret (forces all sessions invalid), Anthropic key, Resend key, and forcing supervisor-PIN resets for every user.

---

## D10-C — Data Breach (PII exposure)

> **Legal clock starts at the moment of *awareness*, not at the moment of confirmation.** Under NPC Circular 16-03, the personal-information controller must notify the NPC within **72 hours** of knowledge of a breach involving sensitive personal information that is likely to give rise to a real risk of serious harm.

### Detection signals
- Unfamiliar query against `User`, `Customer`, `Payslip`, or `Document` tables in AuditLog.
- Tenant reports a tenant employee's PII appearing somewhere it should not (paste site, social media, phishing target list).
- Sentry / WAF spikes on endpoints returning PII.
- A security researcher emails `security@clerque.ph` describing the issue.

### Immediate isolation (in order)
1. **Start the 72 h clock NOW** — note the timestamp at the top of the IR log.
2. Identify the actor or vulnerability — disable the actor's session and any API key in scope.
3. If a vulnerability path is identified, disable the affected endpoint via feature flag or quick deploy.
4. Preserve logs — do not let log retention age out anything from the suspect window.

### Evidence collection
- AuditLog export for the affected scope.
- LoginLog export for the suspected actor's IP range.
- Postgres slow-query or query-log capture if available.
- Save copies of any researcher email or external evidence.

### Eradication
- Patch the vulnerability.
- If credential-based — escalate also as D10-F.
- If supply-chain-based — escalate also as D10-G.

### Recovery
- Restore data integrity if anything was modified (vs. only read).
- Force password rotation for impacted users.
- Issue tenant-specific export to affected tenants for their own records.

### Regulator notification — RA 10173 §38 / NPC Circular 16-03

**Required when**: the breach involves sensitive personal information AND there is a real risk of serious harm to the data subjects.

**Notification deadlines**:
- **NPC**: within 72 hours of knowledge.
- **Affected data subjects**: as soon as reasonably possible, in a manner appropriate to ensure they can take action.

**Submission channels**:
- Primary: NPC's online breach-notification portal at the National Privacy Commission e-services site (https://www.privacy.gov.ph/breach-management/). Upload the notification letter and supporting evidence.
- Secondary: email to the NPC's Complaints and Investigation Division as listed on privacy.gov.ph at the time of the incident.

#### NPC notification email template

```
Subject: Personal Data Breach Notification — Clerque Technologies (RA 10173 §38)

To: complaints@privacy.gov.ph
From: dpo@clerque.ph
Date: <YYYY-MM-DD, PHT>

1. Personal Information Controller
   Name:            Clerque Technologies
   Address:         <registered address>
   Contact person:  Kristian JV Sacdalan, Data Protection Officer
   Email / phone:   dpo@clerque.ph / <phone>
   NPC Registration No.: <registration number, if already registered>

2. Nature of the Breach
   Description:     <plain-language summary of what happened>
   Date(s) of breach: <discovery date> / <occurrence date if known>
   Date of knowledge: <YYYY-MM-DD HH:MM PHT>   ← starts the 72 h clock

3. Personal Data Possibly Involved
   Categories:      <e.g. names, TINs, salary, SSS/PhilHealth numbers, contact info>
   Approximate number of data subjects affected: <count>
   Approximate number of records affected: <count>

4. Possible Consequences and Adverse Effects on Data Subjects
   <e.g. identity fraud risk, financial loss, reputational harm>

5. Measures Taken to Address the Breach
   Containment:     <what you did to stop ongoing exposure>
   Mitigation:      <what you did to reduce harm to data subjects>
   Remediation:     <what you did to prevent recurrence>

6. Name and Contact of the Data Protection Officer
   Kristian JV Sacdalan, dpo@clerque.ph, <phone>

7. Attachments
   - Internal incident report
   - Evidence preservation log
   - Notification template to affected data subjects
```

**Reference**: RA 10173 §38 (data breach notification), NPC Circular 16-03 (personal data breach management).

### Post-mortem template
- Timeline (PHT) with the 72 h clock marked.
- Notifications sent (NPC, data subjects, tenants) with timestamps.
- Records of NPC correspondence and any follow-up requests.
- Root cause and remediation.

---

## D10-D — Account Takeover / Unauthorised Access

### Detection signals
- LoginLog shows successful logins from an unfamiliar country/ASN.
- A user reports actions they did not perform.
- A new TrustedDevice registered without the user's knowledge.

### Immediate isolation
1. Revoke all sessions for the affected user — `POST /admin/users/:id/sessions/revoke-all`.
2. Disable the user account pending re-verification.
3. Remove unfamiliar TrustedDevice rows.

### Evidence collection
- LoginLog and AuditLog for the user for the last 30 days.
- Cross-reference with tenant's report.

### Eradication
- Force password reset, require MFA enrolment if not already.
- Re-issue refresh tokens only after out-of-band identity verification.

### Recovery
- Walk the tenant through the AuditLog showing what was accessed.
- If PII was viewed by the attacker → escalate as D10-C.

### Post-mortem template
- Initial vector (password reuse? phishing? session theft?).
- What signal could have detected this sooner?

---

## D10-E — Denial of Service / Sustained outage

Cross-reference `DISASTER_RECOVERY.md`. Outage *caused by attack* (volumetric DDoS, Slowloris, Layer-7 abuse) is handled here; outage *caused by infra failure* is handled in the DR plan.

### Detection signals
- Cloudflare/Vercel traffic spike > 10× baseline.
- Sustained 5xx from `api.clerque.ph` despite Railway being healthy.
- Tenant reports site is unreachable.

### Immediate isolation
1. Enable Cloudflare "Under Attack" mode in front of `api.clerque.ph` and `clerque.ph`.
2. Rate-limit aggressively at the edge.
3. Identify the attack vector (volumetric? credential stuffing? application-layer?).

### Evidence collection
- Cloudflare analytics for the window.
- Railway metrics.
- LoginLog for credential-stuffing patterns.

### Eradication
- Block offending ASN/IP ranges at Cloudflare.
- If credential-stuffing → escalate to D10-F.

### Recovery
- Stand down "Under Attack" mode once traffic normalises for 1 h.
- Communicate via status banner.

### Post-mortem template
- Peak RPS, duration, root cause, control gap, remediation.

---

## D10-F — Credential Compromise

### Detection signals
- Founder credential surfaced in a breach corpus (HaveIBeenPwned alert).
- Unusual admin or super-admin actions in AuditLog.
- A laptop that held credentials is suspected compromised (link to D10-B).
- A contractor offboarded without prior credential rotation.

### Immediate isolation (in order)
1. **Invoke MFA enforcement on all admin accounts** — `POST /admin/security/mfa-enforce-all` (forces re-enrolment on next login).
2. **Rotate the JWT secret** in Railway env vars. This invalidates every active session globally on next request.
3. **Mass session revocation** — `POST /admin/security/sessions/revoke-all` (operator must be an unaffected super-admin; if the only super-admin was compromised, use the break-glass account documented in the founder's password manager).
4. Rotate the specific credential that was compromised — see `MALWARE_LOST_LAPTOP.md` for the per-credential rotation procedure.

### Evidence collection — what did the attacker access while the session was live?

Run, for each suspected actor and time window:

```sql
-- AuditLog forensic query
SELECT id, "createdAt", "actorId", action, "entityType", "entityId",
       "tenantId", "ipAddress", "userAgent", metadata
FROM "AuditLog"
WHERE "actorId" = '<suspect user id>'
  AND "createdAt" BETWEEN '<session start>' AND '<session end>'
ORDER BY "createdAt" ASC;
```

Cross-reference with `LoginLog` to confirm the session start/end and source IP:

```sql
SELECT id, "createdAt", "userId", "ipAddress", "userAgent",
       success, "failureReason"
FROM "LoginLog"
WHERE "userId" = '<suspect user id>'
  AND "createdAt" >= '<window start>'
ORDER BY "createdAt" ASC;
```

If any PII record was read (`entityType` ∈ {User, Customer, Payslip, ARInvoice, …}) — escalate also as **D10-C** and start the 72 h clock.

### Eradication
- Confirm rotated credentials are not stored anywhere stale (CI secrets, local `.env` files).
- Review and revoke any API keys created during the suspect window.

### Recovery
- Affected users re-authenticate with new credentials + MFA.
- Founder writes up the post-mortem within 7 days.

### Post-mortem template
- Initial vector, dwell time, blast radius (AuditLog query results), what control failed, what control would have prevented this.

---

## D10-G — Supply Chain Compromise

See the dedicated runbook: **`SUPPLY_CHAIN.md`**.

Summary: detection signals (npm advisory, lockfile diff, postinstall script firing on unrelated package), exact `npm` commands to identify the package, pin the previous-known-good version, verify integrity, and redeploy.

---

## Incident history

Append a one-line entry per closed incident below — date, scenario ID, severity, link to post-mortem file.

| Date | Scenario | Sev | Post-mortem |
|---|---|---|---|
| _(none yet)_ |  |  |  |
