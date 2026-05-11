# Vendor / Third-Party Register

**Document ID:** D7-04
**Owner:** Kristian JV Sacdalan (Founder, acting DPO)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11

---

Every third party that processes, stores, or transmits Clerque data must appear in the table below. New vendors require DPO sign-off before production traffic is routed. Review cadence is annual or sooner on vendor-announced breach.

Risk tiers:
- **High** — handles SENSITIVE-PII at scale or holds keys-to-the-kingdom credentials.
- **Medium** — handles INTERNAL data, or SENSITIVE-PII in narrow/transient scope.
- **Low** — PUBLIC data only, or no Clerque data at all.

## Active vendors

| Vendor | Service | Data shared | Contract / Terms | Last security review | Risk tier | Notes |
|---|---|---|---|---|---|---|
| **Anthropic** | AI Drafter (memo drafting) and AI Guide (in-app help) via Claude API | System prompts; Chart-of-Account names; memo strings; aggregate counts. **No customer PII, no employee PII, no salaries, no TINs.** | https://www.anthropic.com/legal/commercial-terms / https://privacy.anthropic.com/ | 2026-05-11 | Medium | Prompt-side filter strips PII before send. Graceful-degrade path documented in `DISASTER_RECOVERY.md` § Scenario 5. Anthropic does not train on API data per their commercial terms. |
| **Cloudflare R2** | Off-box backup storage and user uploads (product images, receipt logos, exported documents) | Full tenant DB snapshots (nightly), uploaded images, generated PDFs. SENSITIVE-PII. | https://www.cloudflare.com/business-msa/ / https://www.cloudflare.com/cloudflare-customer-dpa/ | 2026-05-11 | **High** | Object Lock enabled on `backups/` prefix → immutable, ransomware-resistant. R2 API tokens rotated annually or on suspicion. SSE-S3 encryption at rest. |
| **Railway** | Compute hosting (NestJS API) and managed Postgres | Full production database. SENSITIVE-PII. | https://railway.com/legal/terms / https://railway.com/legal/privacy | 2026-05-11 | **High** | The primary single point of failure. DR plan covers full Railway outage. Postgres encryption-at-rest enabled. Project access limited to founder. |
| **Vercel** | Web hosting (Next.js dashboard, marketing site) | No PII at rest; all data fetches go server-side to Railway with per-request auth. Cookies and short-lived session tokens transit Vercel edge. | https://vercel.com/legal/terms / https://vercel.com/legal/dpa | 2026-05-11 | Medium | Edge functions do not log request bodies. Team access limited to founder. |
| **Resend** | Transactional email (employee invites, customer receipts, password resets, regulator/security comms) | Employee email + name + invite token; customer email + receipt PDF link; admin email + reset token. SENSITIVE-PII (PII identifiers and one-time tokens). | https://resend.com/legal/terms-of-service / https://resend.com/legal/dpa | 2026-05-11 | **High** | API key rotated on suspicion. Webhook signature verified. Bounce/complaint feedback ingested into `Notification` model. |
| **Sentry** (when adopted) | Error monitoring and performance traces | Stack traces; request paths; user IDs (no names, no emails — scrubbed at SDK layer). | https://sentry.io/legal/terms/ / https://sentry.io/legal/dpa/ | _not yet adopted_ | Medium | When adopted: enable PII scrubbing at SDK init; set data-residency to EU if available; rotate DSN on staff change. |
| **UptimeRobot** (when adopted) | Liveness probes against public endpoints | Public URLs and HTTP response metadata only. No tenant data. | https://uptimerobot.com/terms/ | _not yet adopted_ | Low | Configure to ping `/health` only, never authenticated endpoints. |

## Vendor change procedure

1. New-vendor request emailed to `dpo@clerque.ph` with: service, data to be shared, why this vendor over an existing one, link to their DPA/security page.
2. DPO assigns risk tier and either approves (with conditions) or rejects within 5 working days.
3. On approval, vendor is added to this table with the approval date as **Last security review**.
4. Production credentials are issued only after the table is updated and committed.

## Off-boarding a vendor

- Revoke API keys on the vendor side first.
- Delete the integration env vars in Railway / Vercel.
- Confirm no orphan data remains on the vendor side (issue a deletion request under RA 10173 or the vendor's DPA).
- Move the row to the "Decommissioned" section below with the date.

## Decommissioned vendors

_(none yet)_
