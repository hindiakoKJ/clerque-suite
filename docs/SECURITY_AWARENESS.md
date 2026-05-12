---
title: Security Awareness — Staff Handbook
audience: tenant business owners, to share with their staff
status: active
last-reviewed: 2026-05-12
audit-finding: D9-01
---

# Security Awareness — Staff Handbook

Hand this to every person who logs into Clerque on your behalf. It is
written for non-technical staff. The owner remains accountable for what
their team does with the system — this handbook helps them not get burned.

## 1. Phishing — how to spot a fake email or message

Filipino businesses are aggressively targeted. Watch out for:

- **BIR-themed scams.** "Your TIN has been flagged" / "Pay BIR penalty
  via this link." The real BIR never collects payment by email link. If
  in doubt, log into eFPS directly.
- **Fake Clerque emails.** We only send from `@clerque.ph` and
  `@hnscorpph.com`. Anything else (`@clerque-support.com`,
  `@clerque.help`, free Gmail) is fake. We will **never** ask for your
  password.
- **Supplier-impersonation bills.** Someone emails an "updated bank
  account" for a vendor you actually pay. Always confirm by phone using
  the number on the vendor's *previous* invoice, not the one in the new
  email.
- **Urgency + threats** are the tell. Real institutions give you days,
  not minutes.

When unsure: forward to **support@clerque.ph** and do nothing else.

## 2. Password hygiene

- **Use a passphrase, not a password.** Four random words is stronger
  than `P@ssw0rd!` and easier to remember. Example: `mango-staple-river-eight`.
- **At least 12 characters.** Anything shorter is brute-forceable.
- **Never share.** Not with your boss, not with "Clerque support," not
  with your cousin who knows computers. Sharing a password means
  sharing the legal liability.
- **One password per service.** Use a password manager (Bitwarden,
  1Password, the built-in browser one is acceptable). If you reuse a
  password and one site leaks, attackers try it everywhere.
- **Enable MFA (two-factor)** in Settings → Security & 2FA. This is the
  single biggest reduction in account-takeover risk you can make.

## 3. Supervisor PIN — treat it like a key

The supervisor PIN authorises voids and over-threshold discounts at the
POS. It is 4–8 digits and therefore short. Rules:

- Never write it on a sticker on the register.
- Never tell a cashier "just punch in mine."
- Rotate it every **quarter** (3 months) and any time a manager leaves.
- Do not use `1234`, `0000`, or your birthday.

If you suspect the PIN is known by someone who shouldn't have it,
change it the same day from Settings → Security.

## 4. Lost or stolen device — first 30 minutes

If a phone, tablet, or laptop logged into Clerque is lost or stolen:

1. **Email the business owner immediately.** Mention what device, last
   location, what was logged in.
2. **Mass-revoke all sessions** from Settings → Security → "Sign out
   all devices." This invalidates every JWT, forcing re-login everywhere.
3. **Change the password** of every account that was signed in on that
   device.
4. **Change the supervisor PIN** if the device was a POS or had POS
   access.
5. File a police blotter for insurance / liability — yes, even for a
   tablet. It is cheap and creates a paper trail.

## 5. Bring-your-own-device (personal phone / laptop)

If you log into Clerque on a personal device:

- **Lock screen on.** Auto-lock after 1 minute. PIN, fingerprint, or face.
- **Full-disk encryption on.** iPhone and modern Android: on by default.
  Windows: turn on BitLocker. Mac: turn on FileVault.
- **Do not install random APKs or browser extensions.** Those are the
  most common malware vectors in PH.
- **No screenshots of customer data** sent to personal chats.

If a personal device is later sold, traded, or repaired: sign out of
Clerque first, and factory-reset before handing it over.

## 6. Public WiFi

Avoid logging into Clerque from coffee-shop or mall WiFi. If you must:

- Use your phone's **hotspot** instead. It's almost always faster anyway.
- Or use a reputable **VPN** (Mullvad, ProtonVPN, the one in 1Password
  / Apple Private Relay).
- Never on an unencrypted "Free WiFi" with no password.

## 7. Sensitive data on screen

- **Lock the screen when you step away.** Even for a coffee run.
  Windows: `Win + L`. Mac: `Ctrl + Cmd + Q`.
- **Don't leave Clerque open on a shared computer.** Sign out fully.
- **Don't print reports to a shared printer** without picking them up
  immediately. BIR books and payroll registers belong in a locked
  drawer, not on the printer tray.
- **Customer TIN, names, and contact info are SENSITIVE PII** under the
  Data Privacy Act (RA 10173). Treat them with the same care as cash.

## When in doubt

Email **support@clerque.ph** before you click, share, or pay. We would
rather answer a hundred "is this real?" emails than clean up one breach.
