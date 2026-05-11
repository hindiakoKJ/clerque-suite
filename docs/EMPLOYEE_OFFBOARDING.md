# Employee / Contractor Offboarding Runbook

**Document ID:** D3-04
**Owner:** Kristian JV Sacdalan (Founder, acting DPO)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11

---

Use this checklist on the **last working day** of any departing person who has had access to Clerque production, a tenant account, or company devices. Complete every box. The checklist is also valid for tenant-side employee offboarding by their managers.

Departure log path: `tasks/offboarding-<YYYY-MM-DD>-<initials>.md`.

## 1-page checklist

- [ ] **Revoke kiosk PIN**
  - Admin UI: *Settings → Branches → [branch] → Kiosk Terminals → [terminal] → Edit → clear "Assigned User"*.
  - API: `PATCH /api/admin/kiosk-terminals/:id` with `{ "assignedUserId": null }`.

- [ ] **Revoke supervisor PIN**
  - Admin UI: *Settings → Users → [user] → Reset Supervisor PIN → Disable*.
  - API: `POST /api/admin/users/:id/supervisor-pin/disable`.

- [ ] **Revoke all refresh tokens / active sessions**
  - Admin UI: *Settings → Users → [user] → Sessions → Revoke All*.
  - API: `POST /api/admin/users/:id/sessions/revoke-all`.

- [ ] **Revoke trusted devices**
  - Admin UI: *Settings → Users → [user] → Trusted Devices → Remove all*.
  - API: `DELETE /api/admin/users/:id/trusted-devices`.

- [ ] **Disable the user account (do not delete — preserve audit trail)**
  - Admin UI: *Settings → Users → [user] → Status → Disabled*.
  - API: `PATCH /api/admin/users/:id` with `{ "status": "DISABLED" }`.

- [ ] **Transfer outstanding pay-run authorisations**
  - Admin UI: *Payroll → Pay Runs → filter by "Authorised by" = departing user → Reassign authoriser*.
  - API: `PATCH /api/admin/payruns/:id` with `{ "authorisedByUserId": "<new-authoriser-id>" }` for each open run.

- [ ] **Transfer outstanding approvals (leave, expense claim, employee request)**
  - Admin UI: *Approvals dashboard → filter by approver = departing user → bulk reassign*.
  - API: `POST /api/admin/approvals/reassign` with body `{ "fromUserId": "<id>", "toUserId": "<id>" }`.

- [ ] **Reassign branch ownership / station assignments**
  - Admin UI: *Settings → Branches → [branch] → Manager → change*.
  - API: `PATCH /api/admin/branches/:id` with `{ "managerUserId": "<new-id>" }`.

- [ ] **Revoke external system access (only for company staff, not tenant employees)**
  - Railway: remove from project members.
  - Vercel: remove from team.
  - Cloudflare: remove from account.
  - GitHub: remove from org / revoke PAT.
  - Anthropic console: remove from workspace.
  - Resend: remove from team.

- [ ] **Archive email mailbox**
  - Workspace admin: convert mailbox to archive-only; forward to founder for 30 days.

- [ ] **Return company devices**
  - Laptop, kiosk hardware, receipt printer (if loaned), any USB security key.
  - On receipt, wipe per device policy; if device cannot be returned, treat as `MALWARE_LOST_LAPTOP.md`.

- [ ] **Document handover**
  - Departing person commits a handover note to `tasks/handover-<initials>.md` covering open issues, key tenant contacts, and where any in-flight work lives.

- [ ] **Final paycheck handling**
  - Payroll → Generate final pay run including: unused leave conversion (per RA 10395 / labour code), 13th-month pro-rata, last full payroll cycle.
  - Authoriser must be someone other than the departing person.
  - Issue COE (Certificate of Employment) and BIR Form 2316 within 30 days.

- [ ] **Confirmation**
  - Departing person signs the offboarding log acknowledging device return and final pay receipt.
  - Founder counter-signs.

## Same-day vs scheduled offboarding

- **Voluntary, with notice:** complete the checklist on the last working day.
- **Involuntary or for-cause:** complete steps 1–5 **before** notifying the person, then steps 6–end after notification. This prevents data exfiltration in the interval between notice and access removal.
