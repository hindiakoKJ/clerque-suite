# How Clerque is run

For any Claude session working on this repository, on KJ's desktop or in the
cloud. Everything here is true as of 28 September 2026; update it when it
stops being true. Nothing in this file is secret: values live in Railway,
Vercel and the cloud environment, never here.

## 1. What this is, and who it is for

Clerque is POS + Procure + Ledger for Philippine cafes and small shops
(pesos, BIR VAT rules, GCash/Maya, senior/PWD discounts). KJ (an accountant,
a business analyst, not a backend engineer) sells it as a bookkeeper-included
service: the shop's owner and staff use the screens; KJ keeps the books. The
first real client is Cafe Carolina (Naga / General Santos). Ease of use for
owners and staff is the selling point, and the reason most decisions below
look the way they do.

The `cafe-carolina` account on clerque.cc is a **test environment** (KJ's
decision, 2026-09-17). The real Carolina shop gets a new tenant. Never open a
direct connection to the production database; go through the app, or run a
read-only script inside the API container (section 7).

## 2. How KJ wants the work done

- **Push straight to `master`.** No pull request, no "please merge", except
  for a change that carries a **database migration**: that goes on a branch
  with a PR and waits for KJ's word, because `start.sh` runs
  `prisma migrate deploy` on boot and the migration reaches live client data
  the moment it deploys.
- **One next action, not a menu.** KJ is overloaded. Tell him what changed in
  one or two lines and the single thing he has to do, if anything. Do not
  send extra files or offer options he has to choose between.
- **Verify before claiming done.** Type-check, tests, build, and where it can
  be reached, the live thing. `tsc` green is not "works".
- **Enter the client's data as given.** A recipe with no chocolate in the
  Dark Chocolate Latte is the client's recipe. Flag a gap in one line, never
  invent a quantity.
- **Correct by adding an entry, never by unwinding a posted one.** A second
  receipt line is a second lot. Reversal is only for a transaction that never
  happened, and even then a correcting entry beats deleting history.
- **Deliver the main flow.** The kitchen and bar act on PAID orders; changes
  after payment are handled by people talking. Do not engineer every
  void/refund/un-bump permutation.
- **Keep scope literal.** When he says "ingredients only", packaging, recipes
  and reports are off the table until he says otherwise. When a request is
  ambiguous, state the most literal reading in one sentence and build it.
- **KJ's own terminal is Windows CMD.** Commands you give him to run use
  `cd /d "E:\..."` and Windows paths. A cloud session runs Linux; that is
  fine for the session's own work.
- **"Closing steps"** at the end of a session: recap, commit/push/CI state
  with SHAs, build verified, files added, pending items with owners, the
  next anchor, risks. As a tight block.

## 3. Where it runs

| Piece | Where | Deploys how |
|---|---|---|
| API (NestJS, Prisma, Postgres) | Railway project **Clerque** (`ff4d3d0c-87f1-4895-8c10-19796b23c052`), service **clerque-suite**, plus the Postgres service | Every push to `master` builds and deploys. `start.sh` runs `prisma migrate deploy` first. |
| Web (Next.js) | Vercel, **clerque.cc** | Every push to `master`. |
| API URL | `https://api.clerque.cc/api/v1` | Health: `GET /health` returns `{"status":"ok","db":"ok"}`. |
| CI | GitHub Actions on push to `master` and on pull requests | API type-check, API lint, API jest. It does **not** build the web app or run web lint. |
| Telegram | Bot **@ClerqueBot**, webhook `https://api.clerque.cc/api/v1/telegram/webhook`, registered by the API on boot | Each owner/manager links their own phone under Settings → Telegram alerts. |
| Backups | Free nightly dump to the private repo `hindiakoKJ/clerque-backups` (GitHub Actions, two secrets KJ sets) | See the to-do KJ holds. Never press Restore in Railway's Backups tab: on 22 Sept it replaced the live database with an old copy. |

The Counter phone app (`apps/counter`) is not used by any shop. Shops run
the web app on a POS device and Android tablets for the kitchen and bar.

## 4. Variables the API reads on Railway (names only)

`DATABASE_URL`, `DIRECT_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`NODE_ENV`, `APP_URL`, `ALLOWED_ORIGINS`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_BASE`, `ANTHROPIC_API_KEY` (present, unused while the
provider is Gemini).

AI (all set on 23–28 Sept 2026): `AI_FEATURES_ENABLED=true`,
`AI_PROVIDER=gemini`, `GOOGLE_CREDENTIALS_JSON` (the service-account key
file, raw or base64), `GOOGLE_CLOUD_PROJECT=clerque-ai`,
`GOOGLE_CLOUD_LOCATION=global`, `GEMINI_MODEL=gemini-3.8-flash`,
`AI_MONTHLY_BUDGET_USD=50`.

Not set (optional): `RESEND_API_KEY` (no email at all until set),
`SENTRY_DSN`, S3/R2 storage (uploads use the database driver).

Local development files, never committed: `apps/api/.env` (`DATABASE_URL`,
`DIRECT_URL`, `JWT_*`, `PORT`, `ALLOWED_ORIGINS`, `PROVIDER_PHASE`),
`apps/web/.env.local` (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PROVIDER_PHASE`),
`packages/db/.env`. Unit tests need none of them.

## 5. Build and verify (what "green" means here)

From the repository root, Node 18+:

```bash
npm ci
npm run db:generate                      # Prisma client, after any schema change
cd apps/api
npx tsc --noEmit -p tsconfig.json        # types
npx jest --silent                        # ~3,400 tests, ~6 min; 4 suites need a DB and are skipped without one
npx eslint --max-warnings=0 <changed files>
npx nest build                           # what Railway builds
cd ../web
npx tsc --noEmit -p .
npx next build                           # not run by CI; set NEXT_PUBLIC_API_URL=https://api.clerque.cc/api/v1 if the build asks
```

Run tests with the process list clean: on 23 Sept, fifteen orphaned
`nest start --watch` processes from earlier agents ate 24 GB of RAM and
made `tsc` and `jest` die with "Zone Allocation failed".

## 6. Migrations

Rule: branch + PR + KJ's word (section 2). To prove a migration file without
a database:

```bash
git show HEAD:packages/db/prisma/schema.prisma > /tmp/schema_old.prisma
npx prisma migrate diff --from-schema-datamodel /tmp/schema_old.prisma \
    --to-schema-datamodel packages/db/prisma/schema.prisma --script
```

That prints the SQL Prisma would write; the migration file under
`packages/db/prisma/migrations/<timestamp>_<name>/migration.sql` must match
it (comments are fine). With a local Postgres, `npx prisma migrate deploy`
from `apps/api` applies it for real. Known gap: the migration history cannot
build a fresh database from nothing (DEPLOY.md section 6); production is
fine because it applies forward.

## 7. Reaching production from a session

**Without any credential:** health at `https://api.clerque.cc/api/v1/health`;
CI on GitHub; Railway and Vercel deploy on push.

**With the Railway CLI** (KJ's desktop is signed in; a cloud session needs
`RAILWAY_TOKEN`, a project token from Railway → project Clerque → Settings →
Tokens, put in the cloud environment's variables):

```bash
railway variables --service clerque-suite --json          # read (values included: do not paste into chat)
railway variables --service clerque-suite --set "KEY=value"   # changing one redeploys
railway logs --service clerque-suite                        # recent API log
railway deployment list --json                              # status + commitHash of each deploy
railway ssh --service clerque-suite -- "<one quoted command>"   # run inside the container
```

`railway ssh` joins its arguments and runs them through the container's
`sh`, carries about 20 KB per command, and on Git Bash for Windows needs
`MSYS_NO_PATHCONV=1`. Scripts that need the key or the database run inside
the container with `apps/api/scripts/probes/run-in-container.sh`; see
`apps/api/scripts/probes/README.md`. A new deployment is a fresh container.

**The database:** only ever from inside the container, read-only, through
`@prisma/client` (`ai-usage.js` is the pattern). Never a direct connection.

## 8. AI (the receipt reader, the till's paid-out scan, the Ledger helpers)

- Provider **Gemini on Vertex AI**, paid by KJ's $2,000 Google for Startups
  credit (project `clerque-ai`). Not Anthropic (Marketplace usage is not
  covered by the credit) and not the AI Studio key (its free tier trains on
  what it is sent, and it is sent clients' receipts).
- **Location is `global`.** Gemini 3 Flash (3.5 through 3.8) is served to
  this project from the global endpoint only; every 3.x id answers 404 from
  `us-central1`. 2.5 Flash, the only Flash a region serves, retires on
  **16 October 2026**. `gemini-3.8-flash` rejects `thinkingLevel: MINIMAL`;
  `LOW` is the floor and the default.
- Calls go through `apps/api/src/ai/ai.service.ts` → `providers/gemini.provider.ts`.
  The receipt reader passes a response schema (structured output), so
  numbers come back as numbers; the other callers ask for JSON in prose and
  salvage the first `{...}` block, so a code fence around the answer is fine.
- Limits: 1,000 AI uses a month per shop, 50 receipt reads a day, and the
  dollar cap above. Every call is logged in `ai_usage` (model, tokens, cost,
  error). `probes/ai-usage.js` reads it; `probes/ai-models.js` tells you
  which model ids the project can serve when Google changes them; then set
  `GEMINI_MODEL` on Railway.

## 8b. Low stock with no reorder level

Shops are required to type a reorder level for every ingredient. Until they
do, `apps/api/src/inventory/learned-levels.ts` gives each ingredient with no
typed level two days of its own average daily use over the last two weeks
(counted over the days the shop has traded), so the buy list, Check stock and
the 3 am alert work from the first days. A typed level always wins; a prep
keeps its kitchen-set par. An ingredient that is out and needed by a live
recipe is low even with no level; Check stock then asks for one pack of what
was bought last time, or names it (`unpaced`) when nothing is on record.

## 8c. Starting a real shop from its test shop

Console → the new tenant → **Copy setup…** → the test shop's company code.
It copies the whole setup (menu, prices, photos, sizes, add-ons,
ingredients with costs and reorder levels, every recipe including preps',
stations and category routing, discount types, price lists, promotions, the
receipt reader's memory, the closing time and the running settings) and
nothing that happened in the test shop (sales, stock, purchases, journals,
staff, customers, vendors, identity). Only into an empty shop; one
transaction. Code: `apps/api/src/admin/copy-setup.ts`.

A dry run on the live data, rolled back, proves it without writing anything:
`bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/copy-setup-dry-run.js`
(29 Sept on `cafe-carolina`: 129 products, 53 ingredients, 427 recipe lines,
25 categories, 3 stations, 7 photos; exact match; 0 rows kept).

Fix the setup on the test shop BEFORE copying (routing, prices, reorder
levels): whatever it holds at that moment is what the real shop starts with.

## 9. The receipt reader

`apps/api/src/procure/receipt-parser.ts` holds the prompt, the response
schema, the JSON parser, the name matcher, `derivePack` (printed figures →
packs, pack size, price each) and `packSizeFromDescription` ("1KG",
"250ML", "TRAY 30S"). `procure-receipts.service.ts` reads (a suggestion,
nothing written) and posts (an ordinary PurchaseRequest created BOUGHT and
received line by line; fees become simple entries; the photo is a Document).

**Memory** (merged 29 September, PR #32, table `receipt_aliases`):
each line comes back with its barcode; the first time a person tags a line
to an ingredient and posts, the shop files it under `bc:<barcode>` (or
`tx:<normalised text>`) with the pack size; the next receipt from that shelf
comes back tagged and marked "remembered". **Verdict**: the reader also reads
the receipt's own "Total Items", counts lines the way a till does, and the
screen says above Post what must be fixed and what to check against the
paper.

Sample papers for a live check: `apps/api/scripts/fixtures/receipts/`
(fictional stores; regenerate with `make_receipts.py`). Run them through the
deployed reader with `probes/receipt-read.js`. Real client receipts must
never be committed: they carry names and card numbers.

## 10. Security posture (23–28 Sept 2026)

Shipped: cashier discounts need a supervisor PIN; senior/PWD lines need the
card details and are capped at the legal 20%; a sale must be on the caller's
own open shift; cash drops need an active manager who is not the cashier;
paid-outs need approval at or over the threshold, split slips included;
cash-out create/delete audited; purchase costs hidden from staff on every
product route; branch managers get the payroll roster without pay; salary
figures redacted in the audit trail; signup throttled; refresh tokens live 7
days; a departed pairer's tablet reads nothing.

Merged 29 September (PR #33, one nullable column on
`user_sessions`): access tokens carry their session (`sid`) and die with it
at the next request, so one lost device can be signed out alone and "sign
out everywhere" bites at once; refresh tokens are matched by SHA-256 digest
(exact, indexed) instead of a bcrypt loop; a rotated refresh token presented
again is refused within a minute (two tabs racing) and closes every session
of that user after that (a copied token).

Deferred: a rolling life for paired-display tokens (schema), per-user PIN
lockout counters (today the counter is per shop by design), line-level price
validation for POS callers (do **not** flip `enforceServerTotals` for POS:
promos and price lists would break).

## 11. Guides and documents

`node apps/api/scripts/gen-role-guides.js` writes the three PDFs in
`onboarding/` (owner; cashier; kitchen and bar). Their wording is checked
against the screens; keep it that way when a screen changes. `DEPLOY.md` is
the deploy runbook; `tasks/carolina-go-live.md` is the Day-1 runbook and
first-week plan for Cafe Carolina. KJ's personal go-live to-do is a PDF he
keeps outside the repo.

## 12. Open as of 29 September 2026

- Merged 29 September: PR #32 (receipt memory + verdict, table `receipt_aliases`) and
  PR #33 (session security, column `user_sessions.refreshTokenSha`).
- KJ links his phone for Telegram alerts (Settings → Telegram alerts →
  "Make my link" → "Open Telegram" → Start).
- Shop setup on the real Carolina tenant before staff start: supervisor PIN,
  hide costs from staff, ledger mode, staff accounts, stations, reorder
  levels, prep items. About 40 minutes, listed in KJ's to-do.
- The deferred security items above.
- Repository is public; KJ intends to make it private.
