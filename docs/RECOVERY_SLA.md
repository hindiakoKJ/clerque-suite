---
title: Data Recovery Service Level Agreement
audience: public (tenant owners + prospects)
status: active
last-reviewed: 2026-05-12
audit-finding: D2-03
owner: DPO (kristianjvsacdalan@gmail.com)
canonical-source: this file — `apps/web/app/legal/sla/page.tsx` is the published view
---

# Data Recovery SLA

This is Clerque's public commitment for restoring your tenant's data after an
incident — accidental deletion, database corruption, ransomware, or a failed
deploy. It is intentionally short so you can hand it to your accountant or
compliance officer without translation.

## Our targets

| Term | Target | What it means in plain English |
|---|---|---|
| **RPO** (Recovery Point Objective) | up to **24 hours** | You may lose up to one business day of data. The off-box snapshot runs nightly at 02:00 UTC (10:00 AM Manila). Anything entered after that is at risk until the next snapshot. |
| **RTO** (Recovery Time Objective) — support-mediated restore | **4 hours** (business-conservative) | From the time we acknowledge your email, your data is back in the live database within 4 business hours. This path uses the JSON backup. |
| **RTO** — admin self-service restore | **1 hour** | Once the post-Object-Lock self-service restore endpoint ships (next sprint), business owners can trigger a restore themselves and be back online in under an hour. |

## What we retain

- **30 days** of nightly snapshots in Cloudflare R2 (off-box, region-isolated).
- **30 days** of pre-destructive `TenantDataSnapshot` rows in the live
  database — captured automatically before any bulk delete, schema migration,
  or owner-initiated wipe.

Anything older than 30 days is purged. If you need a longer retention window
(e.g. BIR demands 10-year retention), download the JSON snapshot from
**Settings → Data Backups** and keep it on your own cold storage.

## What is NOT covered

- **User credentials.** `passwordHash` and 2FA secrets are not restored —
  every staff member re-sets their password on next login. This is
  deliberate: a compromised credential is the most common reason a restore
  is needed in the first place.
- **Tenant-side custom integrations.** Webhooks, third-party API keys, and
  custom scripts you wired into Clerque are your responsibility to re-apply.
- **Data you generated AFTER the snapshot you restore from.** Restore is a
  point-in-time recovery, not a merge.

## How to invoke a restore

1. Email **support@clerque.ph**
2. Subject line: `URGENT — restore from backup`
3. Body must include:
   - Your tenant slug (visible in the URL after login, e.g. `acme-coffee`)
   - The date of the last known good state (the snapshot we will restore from)
   - A one-line description of what happened
4. We acknowledge within **1 business hour**.
5. Restore is typically complete within **4 business hours** of acknowledgement.

## Communication during an incident

Live status is published at **status.clerque.ph** *(placeholder — page goes
live in the next sprint).* Until then, the business-owner email on file
receives updates every 30 minutes during an active restore.

## Caveat lector

This SLA describes our operational targets, not a contractual liability
ceiling. Refer to the Terms of Service for liability terms. Real-world
restore time depends on snapshot size and whether the incident affects the
underlying cloud provider; in a Cloudflare R2 or Railway regional outage we
defer to the Disaster Recovery Plan (`docs/DISASTER_RECOVERY.md`).
