# Owner Actions — Step-by-Step Runbook

> A detailed companion to `docs/OWNER_ACTIONS.md`. For every audit finding that
> cannot be closed in code, this gives you the exact clicks, URLs, form fields,
> and verification commands. Print this. Stick it next to your laptop. Tick
> each box only when you've **verified** the result, not when you've intended to.
>
> Order: Critical → High → Medium. Within each tier, easiest-first so you can
> rack up quick wins.

---

## TIER 1 — CRITICAL (30-day SLA)

### ☐ D1-06 — Enable R2 Object Lock on the backups bucket

**Goal:** Make ransomware mathematically unable to delete your backups for 30 days, even if they steal your R2 API credentials.

**Prereqs:** Cloudflare account access, R2 bucket already exists and is named something like `clerque-backups`.

**Steps:**
1. Open `https://dash.cloudflare.com` → log in.
2. Left sidebar → **R2 Object Storage**.
3. Click your backups bucket (likely named `clerque-backups` or similar).
4. Top tab bar → **Settings**.
5. Scroll to **Object Lock** section → click **Enable Object Lock**.
6. Confirmation dialog appears. Read it. It says enabling is **irreversible**. That's the point.
7. Click **Enable**.
8. After enabling, you see two settings:
   - **Mode**: choose **Compliance** (not Governance). Compliance means *nobody* — not even you, not even Cloudflare support — can shorten the retention. Governance lets root-account users override, which defeats the purpose against a credential-theft attacker who has your root creds.
   - **Default retention period**: set to **30 days**.
9. Click **Save**.

**Verify:**
1. In R2 dashboard → your bucket → pick any existing backup file.
2. Click the file → top-right **Delete** button.
3. You should get an error along the lines of `Object is locked and cannot be deleted (retention period not yet expired)`.
4. If the delete succeeds, Object Lock is NOT active. Go back to step 5.

**Gotcha:** Object Lock only applies to objects **created AFTER** you enable it. Objects already in the bucket from previous backups are still mutable. You don't need to do anything — tomorrow's backup at 02:00 UTC writes a new object, which is locked. Within 30 days the entire 30-day retention window is fully Object-Locked.

---

### ☐ D4-04 — Enable GitHub branch protection on master

**Goal:** Prevent any single commit from going straight to production without review.

**Prereqs:** GitHub repo admin access (you own the org or are an owner of `hindiakoKJ/clerque-suite`).

**Steps:**
1. Open `https://github.com/hindiakoKJ/clerque-suite` → **Settings** (top-right tab, requires admin).
2. Left sidebar → **Branches**.
3. Click **Add branch ruleset** (newer GitHub UI) or **Add rule** (older UI).
4. **Ruleset name**: `master-protection`.
5. **Enforcement status**: Active.
6. **Target branches**: click **Add target** → **Include by pattern** → enter `master` → Add.
7. Scroll down to **Branch protections**. Tick:
   - ✅ **Restrict deletions**
   - ✅ **Require linear history**
   - ✅ **Require a pull request before merging**
     - Required approvals: **1**
     - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ **Require status checks to pass**
     - Add status check: (whatever your CI workflow name is, likely `build` or `test`)
     - ✅ Require branches to be up to date before merging
   - ✅ **Block force pushes**
8. **Bypass list**: leave empty. Specifically do NOT add yourself. The whole point is the rule binds you too.
9. Click **Create**.

**Verify:**
```cmd
cd /d "E:\AI Projects\app-suite"
echo test > test-branch-protection.txt
git add test-branch-protection.txt
git commit -m "test: should be blocked"
git push origin master
```
You should get an error: `remote: error: GH013: Repository rule violations found... Required approvals not met`. Then:
```cmd
git reset --hard HEAD~1
del test-branch-protection.txt
```

**For emergency hot-fixes:** Edit the ruleset → toggle **Enforcement status** to **Disabled** → push the fix → flip back to **Active**. Log every such bypass in your team chat with the reason. This is the "break-glass" pattern.

---

### ☐ D7-03 — Designate DPO and register with NPC

**Goal:** Meet RA 10173 §21 obligation. Without a registered DPO, a breach today triggers regulatory penalties on top of the breach itself.

**Prereqs:** Decide who the DPO is. For a one-person company, that is **you**. You can later replace yourself with a hired DPO; first registration just needs *someone*.

**Steps — Appointment letter:**
1. Open `docs/DPO_APPOINTMENT.md` from this repo.
2. Fill in the placeholders:
   - Company legal name: e.g., `HNS Corp PH Inc.` or whatever appears on your SEC registration.
   - DPO name: yours.
   - DPO email: a *role* email like `dpo@clerque.ph` is preferred over a personal one (survives DPO turnover). Create the mailbox if it doesn't exist.
   - Effective date: today.
3. Sign it (digital signature is fine for NPC purposes).
4. Save the signed PDF somewhere you'll find again — recommend `docs/DPO_APPOINTMENT_SIGNED_<YYYYMMDD>.pdf` (don't commit if it contains personal info; add to `.gitignore`).

**Steps — NPC registration:**
1. Open `https://privacy.gov.ph/npc-registration/` in your browser.
2. Click **Register Now** (or whatever the current CTA is — NPC redesigns occasionally).
3. Choose **Personal Information Controller (PIC) — New Registration**.
4. Fill out:
   - **PIC Name**: your company legal name (matches SEC registration).
   - **Business Address**: your registered business address.
   - **TIN**: your company's BIR TIN.
   - **Industry**: choose **Information & Communication / Software Publishing**.
   - **Estimated number of data subjects**: realistic count of customers + employees you handle PII for. For pre-launch, an estimate like "less than 500" is fine.
   - **Categories of personal information processed**: tick at least
     - Personal info (name, address, contact)
     - Sensitive personal info (TIN, salary, banking)
     - Government IDs (SSS, PhilHealth, TIN)
5. **DPO section**:
   - Upload the signed appointment letter (PDF).
   - DPO name + email + phone.
6. **Data processing systems**: list "Clerque SaaS platform — multi-tenant POS, Ledger, Payroll".
7. **Cross-border transfers**: tick **Yes** (you use Cloudflare R2 + Anthropic + Resend — all have non-PH infrastructure). Attach a one-page note describing each.
8. **Security measures**: paste a short summary from `docs/SECURITY_POLICY.md` (the "controls in place" section).
9. Submit. NPC issues a **Registration Number** within 10-15 business days via email.

**Verify:**
1. Receipt email arrives from `npc@privacy.gov.ph` within 1 hour confirming submission.
2. Registration Number arrives within 2 weeks.
3. Save the Registration Number in three places:
   - `docs/DPO_APPOINTMENT.md` — at the bottom under "NPC Registration".
   - `docs/VENDORS.md` — top of the file as a header.
   - `docs/INCIDENT_RESPONSE.md` — Section C (data breach), under "Notification address" — so you have it ready during an incident.

**Gotcha:** the NPC will email you annually for a re-registration. Don't lose that email; you have 30 days to confirm. Set a calendar reminder for one year from issuance.

---

### ☐ D10-A — Conduct ransomware tabletop exercise

**Goal:** Practice the playbook from `docs/INCIDENT_RESPONSE.md §A` before you ever need it for real.

**Prereqs:** D9-02 (secondary technical contact identified) — they must be the second participant. You can't tabletop alone; the whole point is communication.

**Steps:**
1. Schedule a 2-hour block. Lock it on the calendar. Don't accept other meetings.
2. Read `docs/INCIDENT_RESPONSE.md §A — Ransomware` aloud to your secondary contact. Time: ~15 min.
3. Pick a **scenario script** (write this beforehand and don't share with the participant in advance):
   - 2026-XX-XX, 08:42 — UptimeRobot pings you: "clerque.cc is down."
   - You log in and find a vendor invoice file in R2 has been replaced with a `README_TO_DECRYPT.txt` demanding 5 BTC.
   - You check `/admin/backups` — last successful backup was last night 02:00 UTC.
   - The attacker has your R2 access key (somehow). They're threatening to delete all snapshots.
4. Walk through the playbook **out loud**:
   - Who do you notify first? (Answer: secondary contact, then customers via status page)
   - How do you stop the bleeding? (Rotate R2 keys via Cloudflare dashboard NOW)
   - Are backups safe? (If D1-06 is done: YES — Object Lock refuses deletes. If not done: maybe not.)
   - How do you restore? (Walk through `/admin/backups/:slug/restore` against staging tenant)
   - When do you notify NPC? (Within 72 hours from the moment a data breach is confirmed)
   - When do you tell customers? (Same — 72 hours, written notification per RA 10173)
5. Time how long each step takes. Add the timings to the playbook so future-you has a realistic estimate.
6. Document the exercise in a 1-page after-action report:
   - Date conducted
   - Participants
   - Scenario used
   - Issues found in the playbook (every tabletop finds at least one — a missing step, a wrong assumption)
   - Action items + owners + due dates
7. Save the report at `docs/TABLETOP_<YYYYMMDD>_RANSOMWARE.md`. Commit.

**Verify:**
- The 1-page report exists.
- At least ONE issue was found in the playbook (if you found none, you didn't take it seriously — try again).
- The action items are in your task list with due dates.

**Cadence:** repeat every 6 months. Rotate scenarios (data breach, founder unavailable, vendor outage).

---

### ☐ D6-03 — Engage a third-party penetration test

**Goal:** A real outside-in security assessment, not a code review.

**Prereqs:** D1-02 (staging environment) should be up so the pentest can hammer staging without affecting customers.

**Steps — Vendor selection:**
1. Solicit quotes from **3 firms**. Suggested PH boutiques:
   - **Pwndepot** (`pwndepot.com`) — local team, strong web-app focus
   - **Secuna** (`secuna.io`) — managed bug-bounty + pentest
   - **Sec Consult Manila** (`sec-consult.com/ph`) — European-headquartered, PH office
2. Provide each with:
   - Scope: Clerque API + web, all roles (BUSINESS_OWNER, ACCOUNTANT, AP_ACCOUNTANT, CASHIER, etc.)
   - Authentication: 2 test accounts on staging tenant (you create these and share)
   - Engagement type: black-box (no code access) preferred, grey-box (read-only repo access) acceptable
   - Constraints: no DoS attacks, no social engineering of real staff
   - Deliverables: written report with CVSS-scored findings + remediation guidance + retest after fixes
3. Compare quotes on:
   - Price (expect PHP 150-300k for a focused web-app engagement, 1-2 weeks)
   - Tester credentials (OSCP, CEH minimum)
   - Past reports — ask for a redacted sample
   - Retest included? (must be — otherwise you can't verify your fixes work)

**Steps — Pre-engagement:**
1. Sign NDA.
2. Sign Statement of Work specifying scope, dates, deliverables.
3. Kickoff call: provide auditor with staging URL, 2 test logins (BUSINESS_OWNER + CASHIER), copy of `docs/ARCHITECTURE.md`.
4. Set an engagement window (typical: Mon 9am — Fri 5pm of one week).

**During the engagement:**
1. Monitor your staging error logs daily — testers WILL trigger errors; that's the point. Don't panic.
2. If they hit production by accident, escalate immediately to their lead and pause.
3. Daily check-in calls (15 min) recommended.

**After the engagement:**
1. Receive draft report → review → request clarifications.
2. Triage findings into Critical/High/Medium/Low — same bucketing as the internal audit.
3. Fix all Critical + High within 30 days; document the fixes.
4. Schedule the retest engagement (2-3 weeks after delivery is typical).
5. Receive final report (with retest section noting "Fixed / Persists").
6. File the final report at `docs/PENTEST_REPORT_<YYYYMMDD>.pdf` — do not commit if it contains live URLs or PII; share via password-protected dropbox.

**Verify:**
- Final report on file.
- All Critical/High findings either fixed (preferred) or accepted-risk with written justification.
- Retest section confirms fixes are effective.

**Cadence:** annually for high-revenue years; every 18 months minimum.

---

## TIER 2 — HIGH (90-day SLA)

### ☐ D1-02 — Stand up staging environment

**Goal:** A second deploy target so schema migrations and risky changes get rehearsed before hitting customers.

**Steps:**
1. **Railway side:**
   - `https://railway.app` → New Project → **Empty Project** → name `clerque-staging`.
   - Add service → **PostgreSQL** plugin → wait for it to provision.
   - Add service → **GitHub Repo** → connect `hindiakoKJ/clerque-suite` → set branch to a new branch `staging`.
   - Service settings → **Deploy** → set start command (same as prod) → **Variables** copy all prod env vars EXCEPT `DATABASE_URL` (which is set automatically by the Postgres plugin).
   - Override on staging: `NODE_ENV=staging`, `S3_BUCKET=clerque-backups-staging` (separate bucket so staging snapshots don't contaminate production).
2. **Vercel side:**
   - `https://vercel.com` → Add New → Project → import `clerque-suite` (it's already imported for prod — go to Settings → Git instead).
   - Or: in the existing project, **Settings → Git → Production Branch** stays `master`. Vercel auto-creates preview deployments for non-master branches → the `staging` branch gets `clerque-suite-git-staging-<your-team>.vercel.app`.
   - Add Vercel Domain alias `staging.clerque.cc` → CNAME to the preview URL.
3. **Seed staging with anonymised production data:**
   - On prod: trigger a manual backup via `POST /admin/backups/run` → wait for the new snapshot in R2.
   - Download it: `GET /admin/backups/<tenant-slug>/download` → save the JSON.
   - Anonymise it (Python one-liner):
     ```python
     import json
     d = json.load(open('snapshot.json'))
     for t in d.get('tenants', []):
       for u in t.get('users', []):
         u['email'] = f"user-{u['id']}@example.test"
         u.pop('passwordHash', None)
         u.pop('twoFactorSecret', None)
       for c in t.get('customers', []):
         c['tin'] = None
         c['contactEmail'] = None
         c['contactPhone'] = None
     json.dump(d, open('snapshot-anon.json', 'w'))
     ```
   - Upload to staging via `POST /admin/backups/restore` against the staging tenant.
4. **Wire CI to deploy staging on push to `staging` branch:**
   - `.github/workflows/staging.yml` — copy your existing prod deploy workflow but trigger on `staging` branch only. Most teams just let Railway auto-deploy; no GitHub Action needed.

**Verify:**
- `https://staging.clerque.cc` loads the login page.
- You can log in with a known staging user.
- `/api/v1/health` returns OK.

**Cost:** ~$5/month (Railway Hobby) + free (Vercel preview deployments).

---

### ☐ D8-02 — Configure UptimeRobot

**Goal:** Push alert within 5 minutes when production is down.

**Steps:**
1. `https://uptimerobot.com` → **Register for free**.
2. Verify email → log in.
3. **Add New Monitor** (top-right green button).
4. Settings:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: `Clerque API`
   - **URL**: `https://api.clerque.cc/api/v1/health` (use whatever your actual API host is; check by curling it now)
   - **Monitoring Interval**: 5 minutes (free tier minimum)
   - **Monitor Timeout**: 30 seconds
5. Click **Create Monitor**.
6. Repeat for the web app:
   - Friendly Name: `Clerque Web`
   - URL: `https://clerque.cc`
7. **My Settings → Alert Contacts → Add Alert Contact**:
   - E-mail: your primary email
   - Add a second: e-mail or webhook to your phone (free SMS in some regions; otherwise Telegram bot)
8. For each monitor → **Edit → Alert Contacts To Notify** → tick both contacts → **Threshold: alert after 2 consecutive failures** (avoids one-blip pages).
9. Save.

**Verify:**
- Wait 10 minutes → dashboard should show 2 monitors with green "Up" status.
- **Test alerting**: temporarily change one URL to something invalid like `/health-FAKE` → within 10 min you should get an email "Clerque API is DOWN". Change it back.

**Cost:** free (free tier handles 50 monitors at 5-min intervals).

---

### ☐ D8-03 — Configure Sentry (API + web)

**Goal:** Stream every unhandled exception with stack trace + breadcrumb + release-tag to a searchable inbox.

**Steps — Sentry account:**
1. `https://sentry.io` → Sign up (free Developer tier = 5k events/month, sufficient pre-launch).
2. Create organization: `hnscorpph` (or similar).
3. Sentry asks "what are you building" → choose **Node.js** for the first project.

**Steps — API integration:**
1. Sentry dashboard → **+ Create Project** → platform **Node.js** → framework **NestJS**.
2. Project name: `clerque-api`. Click **Create Project**.
3. Sentry shows you a **DSN** like `https://abc123@o456.ingest.sentry.io/789`. Copy it.
4. Railway → API service → **Variables** → add:
   - `SENTRY_DSN=<the DSN you copied>`
   - `SENTRY_ENVIRONMENT=production`
   - `SENTRY_RELEASE=$RAILWAY_GIT_COMMIT_SHA` (Railway auto-substitutes)
5. The Sentry SDK is already installed (`@sentry/node` is in `apps/api/package.json`). Confirm initialization in `apps/api/src/main.ts` — should have a `Sentry.init({ dsn: process.env.SENTRY_DSN, ... })` block. If missing, add:
   ```ts
   import * as Sentry from '@sentry/node';
   if (process.env.SENTRY_DSN) {
     Sentry.init({
       dsn: process.env.SENTRY_DSN,
       environment: process.env.SENTRY_ENVIRONMENT,
       release: process.env.SENTRY_RELEASE,
       tracesSampleRate: 0.1,
     });
   }
   ```
6. Redeploy Railway.

**Steps — Web integration:**
1. Sentry dashboard → **+ Create Project** → platform **Next.js**.
2. Project name: `clerque-web`. Click **Create Project**.
3. Copy the DSN.
4. Vercel → project → **Settings → Environment Variables** → add:
   - `NEXT_PUBLIC_SENTRY_DSN=<the DSN>` (must have `NEXT_PUBLIC_` prefix to be visible to the browser)
   - `SENTRY_AUTH_TOKEN` (Sentry → User Settings → Auth Tokens → create one with `project:releases` + `org:read` scope)
   - `NEXT_PUBLIC_BUILD_SHA=$VERCEL_GIT_COMMIT_SHA` (also fixes the "dev/local" badge in the sidebar)
5. If the Next.js Sentry SDK isn't wired, run in `apps/web`:
   ```cmd
   npx @sentry/wizard@latest -i nextjs
   ```
   Follow prompts. It edits `sentry.client.config.ts`, `sentry.server.config.ts`, `next.config.ts`.
6. Redeploy Vercel.

**Verify:**
1. Sentry → each project → **Issues** tab.
2. In the API, hit a route that throws. Sentry dashboard should show the exception within 30 seconds.
3. In the web, open browser console → run `throw new Error('test sentry')` → reload — Sentry should capture it.
4. **Set alert rule**: Sentry → project → Alerts → New Alert → "When 10 events happen in 5 minutes" → Action: email + Slack (if connected).

**Cost:** free for the first 5k events/month. Each event = one new unique exception OR one performance trace (with `tracesSampleRate: 0.1`, only 10% of requests sampled).

---

### ☐ D1-04 — Cloudflare in front of API + WAF

**Goal:** Edge DDoS, OWASP rules, IP rate limiting before requests reach Railway.

**Prereqs:** You already have `hnscorpph.com` on Cloudflare (web app is presumably there).

**Steps:**
1. Cloudflare dashboard → `hnscorpph.com` zone → **DNS** tab.
2. Find the `api.clerque` (or whatever your API hostname is) record. If it's a CNAME pointed at Railway:
   - Click the cloud icon → toggle from **grey** (DNS only) to **orange** (proxied through Cloudflare).
   - Save.
3. **SSL/TLS** → **Overview** → encryption mode: **Full (strict)**. (Railway already serves valid TLS.)
4. **Security → WAF**:
   - **Managed rules** → enable **Cloudflare Managed Ruleset** → Action: Managed Challenge (less aggressive than block; reduces false positives).
   - Toggle on **Cloudflare OWASP Core Ruleset**. Sensitivity: **Medium**. Action: Managed Challenge.
5. **Security → Settings → Bot Fight Mode**: ON.
6. **Rules → Rate Limiting Rules** → Create Rule:
   - Name: `auth-endpoint-bruteforce`
   - When incoming requests match: URL Path `contains` `/api/v1/auth/`
   - Rate: 20 requests / 10 seconds, same IP
   - Action: Block for 30 minutes
   - Save.
7. **Page Rules** (optional): Add a rule for `*.clerque.cc/*` → **Browser Cache TTL: Respect Existing Headers**, **Cache Level: Bypass** (your API responses shouldn't be CDN-cached).

**Verify:**
1. `curl -I https://api.clerque.cc/api/v1/health` → look for response header `cf-ray:` (proves Cloudflare proxied it).
2. Run 30 quick auth attempts:
   ```cmd
   for /L %i in (1,1,30) do curl -X POST https://api.clerque.cc/api/v1/auth/login -d "{}" -H "Content-Type: application/json"
   ```
   After ~20 requests you should start getting 429 responses.
3. WAF stats: Cloudflare → Security → Events → confirm rules are firing.

**Gotcha:** if your existing app uses real client IP for rate limiting / audit logging, configure the API to trust the Cloudflare `CF-Connecting-IP` header. NestJS: `app.set('trust proxy', 1)` plus a middleware that reads `req.headers['cf-connecting-ip']`. Add this to the verification: log a login attempt and check `LoginLog.ipAddress` shows the original client IP, not `127.0.0.1`.

---

### ☐ D2-02 — Restore drill on staging

**Goal:** Prove you can recover a wiped tenant from R2 snapshot end-to-end before you have to do it for real.

**Prereqs:** D1-02 staging done. Pick a non-production tenant ID on staging to be the victim.

**Steps:**
1. **Pre-snapshot row counts** (staging, target tenant):
   ```sql
   SELECT 'orders' AS table, COUNT(*) FROM orders WHERE "tenantId" = '<id>'
   UNION ALL SELECT 'journal_entries', COUNT(*) FROM journal_entries WHERE "tenantId" = '<id>'
   UNION ALL SELECT 'products', COUNT(*) FROM products WHERE "tenantId" = '<id>'
   UNION ALL SELECT 'ar_invoices', COUNT(*) FROM ar_invoices WHERE "tenantId" = '<id>'
   UNION ALL SELECT 'ap_bills', COUNT(*) FROM ap_bills WHERE "tenantId" = '<id>';
   ```
   Save this output.
2. **Fetch the snapshot** (use any admin token):
   ```cmd
   curl -H "Authorization: Bearer <admin-token>" ^
     "https://staging.clerque.cc/api/v1/admin/backups/<tenant-slug>/download" ^
     -o snapshot-before.json
   ```
3. **Note timestamp**: this is your "before" point.
4. **Wipe the tenant** (admin endpoint):
   ```cmd
   curl -X POST -H "Authorization: Bearer <admin-token>" ^
     -H "Content-Type: application/json" ^
     -d "{\"confirmationToken\":\"<tenant-slug>\"}" ^
     "https://staging.clerque.cc/api/v1/admin/tenants/<tenant-id>/wipe-data"
   ```
   (Adjust to the actual admin-wipe endpoint your code exposes; if none exists, manually `DELETE` from the major tables in staging Postgres via Railway DB console.)
5. **Verify wiped**: re-run the row-count SQL → all zeros.
6. **Restore**:
   ```cmd
   curl -X POST -H "Authorization: Bearer <admin-token>" ^
     -H "Content-Type: application/json" ^
     -d "{\"confirmationToken\":\"<tenant-slug>\"}" ^
     "https://staging.clerque.cc/api/v1/admin/backups/<tenant-slug>/restore"
   ```
7. **Post-restore row counts**: re-run the SQL.
   - If counts match pre-snapshot → success.
   - If counts differ → there's a bug in the restore endpoint. STOP, file bug, do NOT mark this drill done.
8. **GL balance reconciliation**: log in to staging as the BUSINESS_OWNER, generate Trial Balance, confirm Total Debits = Total Credits and matches what it was before the wipe.
9. **Document timing**: write down (a) snapshot fetch duration, (b) wipe duration, (c) restore duration, (d) verification duration. Total RTO should be under 1 hour for an SMB tenant.
10. **File the report**: `docs/DRILL_<YYYYMMDD>_RESTORE.md` with all numbers + screenshots. Commit.

**Verify:**
- Row counts match.
- Trial Balance balances.
- Report exists.

**Cadence:** every 6 months. Rotate which tenant gets wiped each drill.

---

### ☐ D6-02 — Commit to dependency patching cadence

**Goal:** Dependabot detection is automated (D1-05 done); now you need an **operational SLA** for triaging the PRs it opens.

**Steps:**
1. Open GitHub → repo → **Pull Requests** → filter by `author:dependabot[bot]`.
2. Mental model:
   - **CRITICAL severity** (Dependabot labels these explicitly) → patch within 7 days.
   - **HIGH severity** → patch within 14 days.
   - **MEDIUM/LOW** → batch-merge at end of every month.
3. For each PR Dependabot opens:
   - Read the CVE summary (linked in the PR).
   - If the affected package is in `dependencies` (runtime): treat at the listed severity.
   - If only in `devDependencies` (build-time): one tier lower.
   - Run the test suite locally against the PR branch.
   - If green → merge.
   - If red → comment on the PR, leave open with `needs-investigation` label.
4. Calendar reminder: every Friday morning, 15 minutes — review the Dependabot inbox.

**Verify:**
- No CRITICAL Dependabot PR is older than 7 days at any point.
- Calendar reminder is set and recurring.

**Cost:** ~15 min/week of your time.

---

### ☐ D9-02 — Identify a secondary technical contact

**Goal:** Reduce bus-factor from 1 to 2.

**Steps — Selection criteria:**
1. Candidate list — anyone you'd answer the phone for at 3am:
   - Former colleague who knows web stack
   - Contracted developer you've worked with on past projects
   - A technical co-founder candidate if Clerque grows
2. Minimum competence: can read TypeScript, has shipped production code, understands DB migrations.
3. Trust criteria: signs NDA, has a clean track record, lives somewhere reachable.

**Steps — Onboarding:**
1. Sign mutual NDA (cover source code + customer data + financial info).
2. Grant access (READ-ONLY initially):
   - **GitHub**: add as collaborator with `Read` role on `hindiakoKJ/clerque-suite`.
   - **Railway**: invite to project as `Viewer`.
   - **Cloudflare**: invite to `hnscorpph.com` zone as `Reader`.
   - **Vercel**: invite to team as `Viewer`.
3. **Walkthrough call** (1 hour): screen-share `docs/ARCHITECTURE.md` and `docs/INCIDENT_RESPONSE.md`. Show them how to access each console.
4. **Communication tree update**: edit `docs/DISASTER_RECOVERY.md` → section "Communication Tree" → add their name, phone, email, hours-of-availability.
5. **Escalation policy**: write a 1-paragraph "if I can't be reached within 30 minutes during a P1, you have authority to do X, Y, Z" — sign it, share with them.

**Verify:**
- They can log in to all 4 consoles independently.
- They've read both docs.
- The communication tree is updated.

**Cadence:** quarterly — confirm they still have access, still want the role, contact info is current.

---

### ☐ D9-03 — Schedule 8-hour shadow review for secondary engineer

**Goal:** Have your secondary actually understand the codebase so they can act in your absence.

**Prereqs:** D9-02 done.

**Steps:**
1. Pay them for 8 hours at their rate (~PHP 8-20k for a senior).
2. **Deliverable they produce**: a 1-page `docs/CODEBASE_QUICKSTART.md` written by them, for their future self. Format:
   - Where do I look first when an incident hits?
   - What are the 3 most fragile/risky parts of the code?
   - What are the 5 most-touched files?
   - How do I run the project locally?
   - Who owns each module?
3. Send them:
   - Repo access (already done from D9-02)
   - `docs/ARCHITECTURE.md`
   - `docs/INCIDENT_RESPONSE.md`
   - List of "modules" you want them to skim: `accounting/`, `ar/`, `ap/`, `auth/`, `backup/`
4. They spend 8 hours reading, asking you questions (have 2 × 30-min Q&A slots prepared).
5. They write `docs/CODEBASE_QUICKSTART.md`.
6. You review it. Anything they got wrong = bad documentation on your end; fix the underlying doc.

**Verify:**
- `docs/CODEBASE_QUICKSTART.md` exists, is in their words.
- You feel comfortable they could open a known issue and find the relevant file within 5 minutes.

---

## TIER 3 — MEDIUM (180-day SLA)

### ☐ D8-01 — Forward Railway logs to managed platform

**Goal:** 90-day searchable log retention (Railway free tier gives 7 days; Hobby gives 30).

**Options compared:**
| Platform | Free tier | Setup time |
|---|---|---|
| Better Stack | 1GB/month, 7-day retention | 15 min |
| Axiom | 500GB/month, 30-day retention | 20 min |
| Self-hosted Loki on Hetzner | unlimited (~$5/mo VM) | 2 hours |

**Steps (Axiom recommended for the free tier):**
1. `https://axiom.co` → Sign up.
2. Create dataset: `clerque-prod`.
3. **Settings → API tokens** → generate token with `Ingest` scope. Copy.
4. Railway → API service → **Settings → Logs → Log Drains → Add Drain**.
5. Drain type: **HTTP**. URL: `https://api.axiom.co/v1/datasets/clerque-prod/ingest`. Headers: `Authorization: Bearer <token>`, `Content-Type: application/x-ndjson`.
6. Save. Railway starts streaming.

**Verify:**
- Axiom dashboard → dataset → see logs appearing within 1 minute.
- Run a known query: `app.name = "clerque-api" | count`.

---

### ☐ D8-04 — Add 3 anomaly alerts

**Prereqs:** D8-01 done (need a log platform first).

**Steps (Axiom):**
1. Create monitor → trigger when query matches:
   - Alert 1: `action = "LOGIN_FAILED" | aggregate count() by ip | where count > 10 within 5m`
   - Alert 2: `app.name = "clerque-api" | where message contains "AccountingEvent" and message contains "FAILED" | count within 1h > 5`
   - Alert 3: Sentry-side. In Sentry → Alerts → "More than 10 errors of severity:error in 5 minutes".
2. Action: email + Sentry/Slack webhook.

---

### ☐ D1-03 — Move throttle ledger to Redis

**Trigger only when:** you enable Railway Replicas > 1 OR migrate to a multi-region setup.

**Steps:**
1. Railway → Add Plugin → Redis → wait for provisioning.
2. Copy `REDIS_URL` to your API service env.
3. In `apps/api/src/auth/supervisor-pin.service.ts` (or wherever the throttle ledger lives), swap the in-memory `Map` for an ioredis-backed counter:
   ```ts
   const key = `pin-attempts:${tenantId}:${userId}`;
   const count = await redis.incr(key);
   if (count === 1) await redis.expire(key, 60 * 5);
   if (count > 5) throw new TooManyAttemptsException();
   ```
4. Add jest spec covering both branches.

**Verify:**
- Set Railway replica count to 2.
- Brute-force one user via direct hits to instance A then instance B alternately — should still get blocked at the same total count, not 2x.

---

## Reference

- `docs/OWNER_ACTIONS.md` — original high-level checklist (this file extends it)
- `docs/INCIDENT_RESPONSE.md` — playbooks referenced by D10-A tabletop
- `docs/DISASTER_RECOVERY.md` — recovery scenarios
- `docs/DPO_APPOINTMENT.md` — fillable template for D7-03
- `docs/RECOVERY_SLA.md` — public SLA referenced in D2-03

**When in doubt, prioritise: D1-06 → D4-04 → D8-02 → D8-03 → D7-03.**
That's an afternoon of work and closes 3 of 4 Critical-tier items + 2 High-tier.
