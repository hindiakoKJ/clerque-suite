# Clerque Counter — Privacy Policy

_Last updated: 2026-05-17_

Clerque Counter ("the app", "we") is a front-of-house Android client for
Clerque Cloud, a multi-tenant SaaS POS + accounting platform operated by
**HNScorpPH Inc.** (the "Operator"). This document explains what data
the app accesses, how it's used, and your rights as a user / tenant.

## 1. Who is the data controller?

The **tenant** (the business that subscribes to Clerque at clerque.com)
is the data controller for any personal information processed via the
app. HNScorpPH Inc. acts as the data processor on the tenant's behalf,
under the Service Agreement accepted by the tenant at clerque.com signup.

## 2. What data the app accesses

### From the device

- **Bluetooth** — to discover and connect to BIR-accredited thermal
  receipt printers. The app never broadcasts data over Bluetooth and
  never connects to non-printer peripherals.
- **Camera** — only when the cashier opens the barcode-scanner sheet
  to scan a product or a customer's loyalty QR. Frames are processed
  on-device; no image leaves the device.
- **Network state + Internet** — to detect online/offline status and
  sync queued sales to Clerque Cloud.
- **No location** access is requested.
- **No microphone** access is requested.
- **No contacts** access is requested.

### From the Clerque Cloud account

- The cashier's email + tenant ID (used to authenticate)
- The cashier's role + PIN hash (used to authorise actions at the till)
- Cart line items, prices, modifiers, discounts (what's being sold)
- Customer name + phone + TIN (only when the cashier explicitly
  adds a customer to the cart; e.g. for B2B receipts or Sr/PWD ID
  capture per RA 9994)
- Senior / PWD ID number + owner name (only when the cashier applies
  the Sr/PWD discount; required by BIR regulation)
- Pharmacist's PRC license number (only for tenants using the
  pharmacy vertical, captured per RA 9165 §61)
- Tenant business name + TIN + address (printed on receipts per BIR
  CAS regulation)

## 3. What we store on the device

- The cashier's JWT and refresh token, in **expo-secure-store** (the OS
  keychain — encrypted at rest)
- A short-lived cached copy of the tenant's product catalog so the app
  can ring up sales offline
- An offline outbox of queued sales (SQLite), drained automatically
  when connectivity returns
- For paired-mode devices (customer-facing TVs, KDS): a long-lived
  device pairing token in expo-secure-store. The token has no user
  identity attached — it can only read the cashier's display stream;
  it cannot modify any data.
- Cache TTL: 7 days. After 7 days without a successful `/auth/me`
  refresh, the app forces re-login.

## 4. What we transmit to the Cloud

Every cart submission is transmitted to api.clerque.com with the
cashier's JWT in the `Authorization` header. The payload contains:

- Line items (productId, qty, modifiers, computed prices)
- Payment entries (method, amount, reference number)
- Discounts (kind, percent, authorised-by user id)
- Customer reference (if any was added)
- Cashier id + tenant id (from the JWT, not the payload body)

All traffic is HTTPS / TLS 1.2+ end-to-end.

## 5. What we do NOT do

- The app does NOT serve ads.
- The app does NOT integrate any third-party analytics SDK (no Firebase
  Analytics, no Segment, no Amplitude, no Sentry session replay).
- The app does NOT track activity outside the app.
- The app does NOT sell or share personal data with third parties.
- The app does NOT process payments in-app (Play Billing not used;
  subscriptions sold separately at clerque.com).

## 6. Data sharing

The Operator processes data only on instruction from the tenant. We
share data with third-party sub-processors strictly for service
delivery:

- **Vercel** — hosts the web back-office (clerque.com)
- **Railway** — hosts the API + database
- **Resend** — transactional email delivery
- **Cloudflare** — DNS + DDoS protection
- **Google Play Services** — push notifications (future; not used in V1)

We do not share data with marketing, advertising, or analytics vendors.

## 7. Data retention

- JWT / refresh token: deleted on sign-out OR after 7 days idle.
- Cached catalog: cleared on sign-out OR when stale (>7 days).
- Offline outbox: deleted automatically as each entry drains; manual
  reset available from drawer → Pending Sync → "Clear outbox".
- Cloud-side retention is governed by the tenant's Service Agreement.

## 8. Your rights (per RA 10173 — Data Privacy Act of the Philippines
and equivalent foreign regulations)

You may:

- Request a copy of the personal data we hold about you
- Request correction of inaccurate data
- Request deletion of your data (subject to the tenant's BIR
  record-retention obligations, which override individual deletion
  requests for 10 years on sales records per BIR rules)
- Withdraw consent (closes your Clerque account; the app will sign you
  out on next launch)
- Lodge a complaint with the National Privacy Commission

To exercise any of these rights, contact privacy@clerque.com or the
tenant's Data Protection Officer.

## 9. Children

Clerque Counter is a business tool intended for use by employees aged
18+. We do not knowingly collect data from children under 18.

## 10. Changes

We will notify the tenant of material changes to this policy via the
admin email on file with at least 30 days' notice. Continued use of
the app after the notice period constitutes acceptance.

## 11. Contact

- **Operator:** HNScorpPH Inc.
- **Email:** privacy@clerque.com
- **Postal:** [registered address per SEC]
- **Data Protection Officer:** dpo@clerque.com

---

This policy is governed by the laws of the Republic of the Philippines,
without regard to conflict-of-law principles.
