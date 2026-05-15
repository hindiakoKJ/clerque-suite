# Clerque Counter (Android) — Mobile Build Kickoff

> Paste the contents of this file as the first message in a new Claude Code session when you're ready to build Counter mobile. The session is intentionally separate from web/API development so the mobile build doesn't pollute (or get polluted by) the existing NestJS / Next.js work.

---

## You are starting a new project: Clerque Counter for Android

Clerque Counter is the **mobile tablet POS companion** to Clerque Cloud (the existing web SaaS at `clerque.com`). It is **NOT a standalone product** — it is a sign-in client for a Cloud subscription the customer already paid for on the web.

This session is a clean slate. Do not assume any context from prior sessions.

## Mission

Build an Android tablet POS app that:
- Native Expo / React Native (NOT a Capacitor / TWA / webview wrap)
- Authenticates against Clerque Cloud's existing JWT auth
- Pulls down the tenant's products, customers, settings on first login
- Writes sales to local SQLite immediately (works offline indefinitely)
- Drains a sync outbox to Cloud API when online
- Prints BIR-compliant receipts via Bluetooth thermal printer
- Never sells anything in-app (Play Store compliance — consumption-only app pattern)

## Workspace boundaries — STRICT

- **Your workspace**: `apps/mobile-counter/` (does not exist yet — create it in your first commit)
- **DO NOT TOUCH**:
  - `apps/api/` (Clerque Cloud NestJS API — belongs to the web/api session)
  - `apps/web/` (Clerque Cloud Next.js web app — belongs to the web/api session)
  - `packages/db/prisma/schema.prisma` (Cloud DB schema)
  - `packages/shared-types/` (web/api shared types — Counter has its own)
  - `apps/landing/` (HNScorpPH landing — different session entirely)

If you need a new Cloud API endpoint (e.g., for sync), stop and request it from the web session — don't add it yourself. The boundary is the architecture.

## Tech stack — LOCKED

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Expo (managed workflow, SDK 53+)** | Fast iteration on Android, EAS Build handles signing |
| UI | **Native React Native components + Nativewind** | NOT a webview; native feel, 60fps |
| Local DB | **`op-sqlite`** (NOT `expo-sqlite`) | 10-50× faster at POS volumes |
| State | **Zustand** | Same as Clerque Cloud web for cognitive consistency |
| Auth | **Existing Clerque Cloud JWT** — no Play Billing, no Google account dependency | Cloud is system of record |
| Printing | **`react-native-thermal-printer`** (Bluetooth) | 58mm + 80mm |
| Barcode | **`expo-barcode-scanner`** | Camera-based |
| Navigation | **Expo Router** (file-based) | Type-safe |
| Sync | **Custom outbox pattern** | Offline-first; drain to Cloud API when online |

**Do not propose Capacitor, TWA, Flutter, native Kotlin, or any wrap pattern.** This decision was made and locked.

## Architecture — LOCKED

### Product model: ONE subscription, TWO surfaces

- **Cloud (web)**: signup, billing, back-office work (build products, set prices, manage staff, reports, BIR exports)
- **Counter mobile (this app)**: front-of-house (ring up sales, take payments, print receipts)

Same subscription unlocks both surfaces. Same data. Same backend.

### Billing model: NO in-app purchases

- Subscription is sold ONLY on `clerque.com/welcome/pos` via Clerque's existing billing
- Counter mobile is a **free download** from Play Store
- Login screen as entry — no "Subscribe" button, no in-app upgrade flow
- Play Store listing copy: "Subscription sold separately at clerque.com" (anti-steering compliant)
- Cache entitlement locally; 7-day TTL; if no sync in 7 days, lock until reconnect

This avoids Google Play's 15% billing fee on every peso of revenue.

### Data model: offline-first with sync outbox

1. On first login → fetch tenant products, customers, settings; store in SQLite
2. Sales write to local SQLite **immediately** — fully offline workflow
3. Each write also appends to a `sync_outbox` table
4. Background sync drains the outbox to Cloud's API when online
5. Pull updates from Cloud (e.g., product changes made on web) at idle moments

### Authentication

- JWT from Clerque Cloud's existing `/auth/login` endpoint (already exists in `apps/api`)
- Refresh token rotation already supported in the API
- The mobile session ID counts as a Clerque User session (multi-device-same-user is already supported)

## Required reading (in this order, before any code)

These four docs are your entire briefing. They were written specifically for this kickoff:

1. `docs/COUNTER_FREEMIUM.md` — *NOT applicable* — outdated; the new model is "one subscription unlocks both surfaces"
2. `docs/COUNTER_EXPORT_FORMAT.md` — *partially applicable* — the XLSX format is still relevant for one-off owner exports; not used for sync
3. `docs/COUNTER_VS_CLOUD.md` — *NOT applicable* — outdated; Counter IS the mobile surface of Cloud now
4. `docs/OWNER_ACTIONS_STEP_BY_STEP.md` — Section on Google Play developer account (required before Play Store submission)

The current canonical plan lives at `C:\Users\user\.claude\plans\please-perform-a-comprehensive-binary-parrot.md` — read the "Counter mobile build — locked architecture for the next session" section.

## Surface responsibilities split

What the mobile app DOES (front-of-house):

| Capability | Mobile | Web |
|---|:---:|:---:|
| Sign up + pay subscription | — | ✓ |
| Daily sales / tendering | **✓** | — |
| Print receipts | **✓** | — |
| Cashier PIN switching at till | **✓** | — |
| Cashier shift open/close | **✓** | — |
| End-of-day Z-read | **✓** | — |
| Build product catalog | view only | ✓ (primary) |
| Configure modifiers, prices, tax modes | view only | ✓ |
| Build recipes (ingredient COGS) | view only | ✓ |
| Configure inventory (FEFO, batches) | view + receive stock | ✓ |
| Add customers | quick-add at till | full management |
| Manage employees + PINs | — | ✓ |
| Review reports / dashboards | basic daily only | ✓ (primary) |
| BIR XLSX exports | — | ✓ |
| Receipt customization (logo, header, footer) | — | ✓ |
| Subscription management | — | ✓ |

## Phased build (~10-12 weeks)

### Phase 1 — Scaffold (1 week)
- Create `apps/mobile-counter/` in the monorepo
- Expo init with TypeScript template
- Wire `op-sqlite` + Nativewind + Zustand + Expo Router
- Sign-in screen (POST `/auth/login` to existing Cloud API)
- After login: store JWT + tenant info in secure storage
- Test on Samsung Galaxy Tab A8 emulator + real device

### Phase 2 — Sync API on Cloud (2 weeks) — REQUIRES WEB SESSION COOPERATION
You will need new endpoints on `apps/api`:
- `GET /sync/products?since=<timestamp>` — incremental product sync
- `GET /sync/customers?since=<timestamp>` — incremental customer sync
- `GET /sync/settings` — tenant settings (tax mode, OR prefix, receipt config)
- `POST /sync/sales-batch` — bulk-upload offline sales (idempotent by client-generated UUID)
- `GET /sync/entitlement` — current subscription state + expiry

Do NOT build these yourself. Request them from the web/api session. Coordinate via a shared spec doc.

### Phase 3 — Core POS UI (3-4 weeks)
- Product grid with search + barcode scan
- Cart with line items, quantity adjust, line discount
- Modifier picker (predefined groups from settings)
- Tendering screen: cash, GCash, PayMaya, GrabPay, card, split payment
- Receipt rendering: PDF for screen, thermal-print via Bluetooth
- Order history with re-print

### Phase 4 — Loyverse-parity features (2 weeks)
- Open tickets / hold sale
- Refunds + voids with supervisor PIN
- Cash management (cash in/out, shift open/close, drawer count)
- Senior/PWD discount with ID capture
- VAT mode handling (VAT-12 / Exempt / Zero / Non-VAT)

### Phase 5 — Offline sync + entitlement (1-2 weeks)
- `sync_outbox` table + drain logic
- Conflict resolution: client-generated UUIDs make sales effectively idempotent
- Entitlement TTL (7 days); lockout screen on expiry
- Periodic background sync (every 15 min when online)

### Phase 6 — Play Store submission (1-2 weeks)
- Icon (1024×1024 + adaptive)
- Feature graphic + 6 phone/tablet screenshots
- Listing copy ("Subscription sold separately at clerque.com" — required phrase)
- Privacy policy URL (hosted at `clerque.hnscorpph.com/legal/counter-privacy`)
- DPA disclosure (RA 10173 compliance — Data Privacy Act)
- EAS Build → AAB upload to Play Console internal testing track

## Success criteria for shipping V1

- A coffee-shop owner installs from Play Store internal testing, signs in with their Cloud credentials, completes first sale, prints receipt — **within 3 minutes**
- 60fps frame rate during cart operations on Samsung Galaxy Tab A8
- Cold-start < 2 seconds on same hardware
- Sales workflow works in airplane mode after initial sync
- 10 sales offline → reconnect → all 10 appear on web back-office within 30 seconds
- A pilot café runs a full week of sales on it without major incidents

## What "done" looks like for the whole project

- App is live on Google Play (internal testing → closed beta → production)
- At least one real café pilot has run a full month
- Sync round-trip verified end-to-end (mobile sale → Cloud → web report shows it)
- DPA disclosure live + reviewed
- Privacy policy live

## Plan first — required before any code

Do NOT scaffold immediately. First:

1. Read the four sections above + verify against current main-plan-file state
2. Spend ~10 min confirming Expo SDK 53 + op-sqlite versions are compatible
3. Write `apps/mobile-counter/PLAN.md` covering Phase 1 in concrete detail (file list, schema SQL, component tree)
4. Get owner approval on that plan before scaffolding
5. After each phase ships, write `apps/mobile-counter/PHASE_<N>_REPORT.md` to coordinate back to the web/api session

Now read the canonical plan file and confirm understanding before proposing Phase 1.
