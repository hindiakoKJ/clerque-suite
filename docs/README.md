# Clerque Governance & Incident Response Documentation

This directory contains the policy and playbook suite that closes the governance gaps surfaced by the 2026-05-08 internal security audit (see `../SECURITY_AUDIT_2026-05-08.md`). Each document is intended to be ~1–2 pages, founder-readable, and immediately actionable.

Owner: Kristian JV Sacdalan (kristianjvsacdalan@gmail.com) — Founder & acting DPO.
Last reviewed: 2026-05-11.

## Index

| File | Purpose | Audit findings closed |
|---|---|---|
| [SECURITY_POLICY.md](./SECURITY_POLICY.md) | Information Security Policy (NIST CSF skeleton — Identify / Protect / Detect / Respond / Recover). Defines scope, password rules, incident-reporting channel, vendor management hook, review cadence. | **D7-01** |
| [DATA_CLASSIFICATION.md](./DATA_CLASSIFICATION.md) | Three-tier data classification (PUBLIC / INTERNAL / SENSITIVE-PII) with per-tier handling, retention, disposal, export rules. Includes Prisma-model-to-tier mapping table. | **D2-05** |
| [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) | Six-scenario DR plan with RTO/RPO targets and comms templates. Covers Railway outage, Postgres corruption, full DC loss, R2 down, Anthropic outage, founder unavailable. | **D2-04**, **D10-E** |
| [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) | Master IR playbook for seven threat scenarios (ransomware, malware/lost laptop, data breach, account takeover, DDoS, credential compromise, supply chain). Includes NPC notification template under RA 10173 §38. | **D10-A** through **D10-G** |
| [EMPLOYEE_OFFBOARDING.md](./EMPLOYEE_OFFBOARDING.md) | One-page offboarding checklist with admin-UI clicks and API endpoints for every revocation step. | **D3-04** |
| [VENDORS.md](./VENDORS.md) | Third-party register with risk tier, data shared, review date per vendor (Anthropic, Cloudflare R2, Railway, Vercel, Resend, Sentry, UptimeRobot). | **D7-04** |
| [DPO_APPOINTMENT.md](./DPO_APPOINTMENT.md) | Fillable DPO Appointment Letter template citing RA 10173 §21, plus the step-by-step NPC online registration procedure. | **D7-03** |
| [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md) | Supply-chain-compromise procedure with the exact `npm` commands to identify, pin, verify and redeploy. | **D10-G** |
| [MALWARE_LOST_LAPTOP.md](./MALWARE_LOST_LAPTOP.md) | Step-by-step credential rotation runbook for malware infection or lost / stolen founder laptop. | **D10-B** |

## How these documents fit together

```
SECURITY_POLICY (the umbrella)
  ├── DATA_CLASSIFICATION  ← defines what we are protecting
  ├── VENDORS              ← who else touches the data
  ├── DPO_APPOINTMENT      ← who is accountable (RA 10173 §21)
  ├── EMPLOYEE_OFFBOARDING ← access lifecycle
  ├── DISASTER_RECOVERY    ← when infra fails
  └── INCIDENT_RESPONSE    ← when something is attacked
        ├── MALWARE_LOST_LAPTOP   (D10-B detail)
        └── SUPPLY_CHAIN          (D10-G detail)
```

## Review cadence

- Annual full review (next: 2027-05-11).
- Ad-hoc review after any sev-1 incident.
- The DPO is responsible for triggering reviews and recording the date at the top of each file.
