# Data Protection Officer Appointment

**Document ID:** D7-03
**Owner:** Kristian JV Sacdalan (Founder)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11

---

This file contains (a) a fillable Appointment Letter template, and (b) the step-by-step NPC online registration procedure. Under RA 10173 §21 ("Designation of an individual or individuals who shall be accountable for the organisation's compliance with this Act"), every Personal Information Controller must designate a Data Protection Officer (DPO).

Until a separate DPO is appointed, the founder (Kristian JV Sacdalan) acts in the DPO role. This template is the instrument by which a permanent DPO is named.

---

## A) Appointment Letter — fillable template

> Copy this letter into a Word document or PDF, fill the bracketed fields, sign, and retain a wet-signed copy. The same content (or a scan of it) is what you upload to the NPC portal.

```
[Company letterhead — Clerque Technologies]
[Address line 1]
[Address line 2, Philippines]
[Date: YYYY-MM-DD]

APPOINTMENT OF DATA PROTECTION OFFICER

To:    [DPO full name]
       [DPO address]

Pursuant to Section 21 of Republic Act No. 10173 (the Data Privacy Act of
2012) and the Implementing Rules and Regulations issued by the National
Privacy Commission, the undersigned, on behalf of CLERQUE TECHNOLOGIES
(the "Personal Information Controller"), hereby designates and appoints:

       Name:           [DPO full name]
       Position:       Data Protection Officer
       Email:          [dpo@clerque.ph]
       Direct phone:   [+63 ___ ___ ____]
       Office address: [same as company address, or DPO-specific address]

as the Data Protection Officer of Clerque Technologies, effective [date].

The DPO is empowered and required to perform the following functions, in
line with NPC Advisory No. 2017-01 and the IRR of RA 10173:

  1. Monitor the Personal Information Controller's compliance with RA 10173,
     its IRR, issuances by the NPC, and other applicable laws and policies.

  2. Ensure the conduct of Privacy Impact Assessments on programmes,
     systems, or processes that involve personal data.

  3. Advise the Personal Information Controller on complaints and the
     exercise by data subjects of their rights.

  4. Ensure proper data breach and security-incident management, including
     the timely notification of the NPC and affected data subjects in
     accordance with NPC Circular 16-03 and RA 10173 §38.

  5. Serve as the contact person of the Personal Information Controller
     vis-à-vis the data subjects, the NPC, and other authorities in all
     matters concerning data privacy or security issues.

  6. Cooperate with, and coordinate the activities of, the Personal
     Information Controller in relation to the processing of personal
     data, particularly the conduct of regular trainings.

The DPO is granted direct reporting access to the highest level of
management of Clerque Technologies, sufficient resources to discharge
these duties, and the independence required by Section 4(d) of NPC
Advisory 2017-01. The DPO shall not be penalised for performing the
functions of the role.

This appointment remains in effect until revoked or replaced by written
notice issued by the undersigned, with corresponding notice to the NPC.

                                          ___________________________
                                          Kristian JV Sacdalan
                                          Founder, Clerque Technologies
                                          kristianjvsacdalan@gmail.com


Conforme:                                 ___________________________
                                          [DPO full name]
                                          Date: ____________________
```

### Contact-details schema (also recorded in the NPC portal)

| Field | Value |
|---|---|
| Full name | _to fill_ |
| Position | Data Protection Officer |
| Direct email | dpo@clerque.ph |
| Direct phone | _to fill_ |
| Office address | _to fill_ |
| Reports to | Founder, Clerque Technologies |

---

## B) NPC online registration procedure

> The NPC operates a Data Privacy Officer / Personal Information Controller registration portal. As of this writing the canonical entry point is the **NPC Registration System (NPCRS)** linked from https://www.privacy.gov.ph/ → "Registration". The exact URL and screens may change; this procedure documents the stable sequence.

### Step 1 — Pre-registration checklist
- Confirm Clerque Technologies' SEC/DTI registration number is on hand.
- Confirm the signed Appointment Letter (Section A above) is ready as a PDF scan.
- Confirm DPO contact details schema is filled.
- Confirm the privacy impact summary (a one-paragraph description of Clerque's data processing: multi-tenant SaaS POS + ledger + payroll for PH SMEs, processing customer and employee personal data on behalf of tenant businesses).

### Step 2 — Account creation on the NPC portal
1. Go to https://www.privacy.gov.ph/ and click *Registration* in the top navigation.
2. Choose *New Registration* → *Personal Information Controller*.
3. Create an account using `dpo@clerque.ph` as the primary contact. Verify the email.

### Step 3 — Fill the registration form
- **Section 1 — Organisation identity**: Clerque Technologies; SEC/DTI no.; registered address; nature of business (SaaS for SMEs).
- **Section 2 — Data Protection Officer**: paste from the contact-details schema above.
- **Section 3 — Data processing systems**: describe each tenant-facing module (POS, Ledger, Payroll) and the categories of personal data processed.
- **Section 4 — Data subjects**: tenant employees, tenant customers (where collected via POS).
- **Section 5 — Sharing**: list the High and Medium tier vendors from `VENDORS.md` (Anthropic, Cloudflare R2, Railway, Vercel, Resend).
- **Section 6 — Security measures**: reference this directory — encryption in transit/at rest, role-based access, audit logging, off-box backups with Object Lock, breach-response plan.

### Step 4 — Upload supporting documents
- Signed DPO Appointment Letter (PDF).
- SEC/DTI Certificate of Registration.
- Latest General Information Sheet (for SEC-registered entities) or DTI BN registration.

### Step 5 — Submit and track
- Submit the form.
- Save the NPCRS submission reference number to the founder's password manager under "Compliance > NPC".
- Expected processing timeline per NPC SLAs: confirmation email within 1–3 weeks; certificate of registration issued within 4–8 weeks of a clean submission. NPC may request clarifications; respond within the deadline they specify (usually 15 days).

### Step 6 — Post-issuance
- Record the NPC Registration Number in `VENDORS.md` (header) and in this file.
- Renew per NPC's renewal cadence (currently every 2 years; verify the prevailing rule at renewal time).
- Update the registration on any material change: new DPO, new vendor category, new data subject type, new processing purpose.

---

## Change log

| Date | Change | By |
|---|---|---|
| 2026-05-11 | Template created; founder acts as DPO pending appointment | KJV Sacdalan |
