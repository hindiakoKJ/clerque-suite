# Clerque — Infrastructure Setup Guide

Sprint 19. Walks through every external service Clerque needs in production, in priority order.

---

## Required (already configured)

These are already running in production. Listed for completeness.

| Service | What | Status |
|---|---|---|
| **Railway** | Postgres + NestJS API host | ✅ Running |
| **Vercel** | Next.js frontend host (`clerque.cc`, `console.clerque.cc`) | ✅ Running |
| **DNS** | `hnscorpph.com` zone with both subdomains pointing at Vercel + API at `api.hnscorpph.com` | ✅ Configured |

---

## 🔴 Priority 1 — Cloudflare R2 (uploads + backups)

**Why this matters:** Railway's filesystem is ephemeral. Every redeploy wipes `./uploads/`. Today, every product image, receipt logo, and document upload lives there. **The next deploy could wipe everything.** Daily backups are also unconfigured, so there's no recovery path from a database disaster.

R2 fixes both with one bucket.

### Cost

- $0.015 per GB-month storage (≈ ₱0.85)
- $0 egress for the first 10M class-B operations / month — i.e. free reads
- Realistic monthly bill for a 50-tenant pharmacy chain: **~₱20–60/month**

### Setup (10 minutes)

1. **Cloudflare dashboard → R2 → Create bucket**
   - Name: `clerque-prod`
   - Location: `Asia-Pacific` (closer = faster reads)
   - Click Create

2. **Object Lock for ransomware-proof backups**
   - Bucket → Settings → Object Lock → Enable
   - Mode: `Compliance` (cannot be disabled even by root)
   - Default retention: 30 days
   - This makes backups truly immutable — even a stolen API key can't delete them

3. **Lifecycle rule for backup rotation**
   - Bucket → Settings → Lifecycle rules → Add rule
   - Prefix: `backups/`
   - Action: Delete after 90 days
   - Object Lock keeps the most recent 30 days fully immutable; older daily snapshots roll off automatically

4. **Public access for product images** (optional but recommended)
   - Bucket → Settings → Public access → Enable for path `public/`
   - Copy the public URL it gives you (looks like `https://pub-<bucket-id>.r2.dev`)
   - This lets browsers render product images directly without going through the API

5. **Create API token**
   - R2 dashboard → Manage R2 API tokens → Create token
   - Permissions: `Object Read & Write` on bucket `clerque-prod`
   - Copy the **Access Key ID**, **Secret Access Key**, and **Endpoint URL**

6. **Set Railway environment variables** (Railway → API service → Variables)
   ```
   S3_BUCKET=clerque-prod
   S3_ACCESS_KEY_ID=<from step 5>
   S3_SECRET_ACCESS_KEY=<from step 5>
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_PUBLIC_URL=https://pub-<bucket-id>.r2.dev
   ```

7. **Redeploy the Railway service** — variables don't take effect until the next deploy

8. **Verify** — check Railway logs for:
   ```
   Storage driver: S3 (bucket=clerque-prod, endpoint=https://...)
   ```
   If you see `Storage driver: LOCAL`, one of the env vars is missing.

### One-time migration of existing local uploads

If you have product images already stored on Railway's disk (which will be wiped on the next deploy):

```bash
# SSH into the Railway service, OR run locally with DATABASE_URL pointing at prod
cd apps/api
npm run migrate-uploads-to-s3
```

(Script not yet written — let me know if you need it. For now, owners can re-upload product images after the migration.)

---

## 🟡 Priority 2 — UptimeRobot (free)

**Why this matters:** today, you find out about an API outage when a tenant calls you. UptimeRobot pings every 5 minutes and alerts within 60 seconds.

### Setup (5 minutes)

1. Sign up at uptimerobot.com (free tier — 50 monitors, 5-minute checks)
2. Create three monitors:
   - HTTP(s): `https://api.hnscorpph.com/health`
   - HTTP(s): `https://clerque.cc`
   - HTTP(s): `https://console.clerque.cc`
3. Alert contacts: your email + SMS (free tier supports both)
4. Set the alert threshold to 2 consecutive failures (avoids false positives from a single hiccup)

That's it. You'll get an email + SMS within 60 seconds of any outage.

---

## 🟡 Priority 3 — Sentry (free for small teams)

**Why this matters:** errors thrown in production today only surface as 5xx responses to the user. Sentry captures stack traces, request context, user info, breadcrumbs, and source maps — turning a "something broke" complaint into actionable debugging.

### Cost

- Free tier: 5K events/month (plenty for early SaaS)
- Team plan: $26/month (50K events) — only needed at ~100+ paying tenants

### Setup (10 minutes)

1. sentry.io → Create project → Platform: `Node.js (Express)` for API, `Next.js` for web
2. Copy the DSN it gives you
3. Railway env: `SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>`
4. Vercel env: same `SENTRY_DSN` for the web project (or use Sentry's Vercel integration)
5. Sentry → Settings → Source Maps → connect to GitHub for symbolicated stack traces

---

## 🟢 Priority 4 — Resend domain verification

**Why this matters:** if `RESEND_API_KEY` is set but the From domain isn't verified in Resend, all outbound mail (password resets, payslip notifications, console alerts) silently fails.

### Setup (5 minutes)

1. Resend dashboard → Domains → Add domain → `hnscorpph.com`
2. Resend gives you 3 DNS records (SPF, DKIM, DMARC)
3. Cloudflare → DNS → add the 3 TXT records
4. Resend → Verify (takes ~5 minutes for DNS to propagate)
5. Railway env: `MAIL_FROM="Clerque <noreply@hnscorpph.com>"`

---

## 🟢 Priority 5 — Anthropic API (optional)

**Why this matters:** AI-powered features (copilot, smart summarisation) need the Anthropic SDK to actually work. Without `ANTHROPIC_API_KEY`, the AI module silently returns "feature unavailable" responses.

### Setup

1. console.anthropic.com → Settings → API Keys → Create key
2. Railway env: `ANTHROPIC_API_KEY=sk-ant-...`
3. Tenant-level usage caps already enforced via `Tenant.aiQuotaMonthly` (set in Console)

---

## Ongoing — what to monitor

Once everything's set up, the **weekly checks** that keep things healthy:

| Check | Where | Frequency |
|---|---|---|
| Railway disk + memory usage | Railway dashboard → Metrics | Weekly |
| Postgres slow queries | Railway dashboard → Postgres → Insights | Weekly |
| R2 bucket size | Cloudflare dashboard → R2 → bucket | Monthly |
| Daily backup cron ran | Check `backups/<yesterday>/<slug>.json` exists in R2 | Weekly |
| Vercel function invocation counts | Vercel dashboard → Analytics | Monthly (catches unexpected usage spikes) |

Set a Cloudflare Worker / GitHub Action to verify the daily backup ran (alert if `backups/<yesterday>/*.json` is empty for any active tenant). I haven't built this yet — let me know if you want it.

---

## Estimated all-in monthly cost (production)

| Service | Tier | Cost (PHP) |
|---|---|---|
| Railway (API + Postgres) | Hobby → Pro at scale | ~₱700–1,400 |
| Vercel (web) | Hobby → Pro | ~₱0–1,100 |
| Cloudflare R2 | Pay-as-you-go | ~₱25–280 |
| Resend | Free tier (3K emails/mo) | ₱0 |
| UptimeRobot | Free | ₱0 |
| Sentry | Free → Team | ~₱0–1,500 |
| Anthropic API | Pay-as-you-go (per token) | ~₱500–5,000 |
| **Total (early)** | | **~₱700–4,000** |
| **Total (50 tenants)** | | **~₱5,000–10,000** |

Very lean — fits a Philippine SMB SaaS budget cleanly.
