# Play Store Launch Playbook

> What we learned shipping Clerque Counter to Google Play. Use this as a
> checklist for any future Expo / React Native app that needs to clear
> Google Play review and survive real cashier / customer use on day one.
>
> Each section follows the order things should happen in. The painful
> bugs we hit are written down at the bottom under **Architecture
> Pitfalls** — read those before writing offline-first code.

---

## Phase 0 — Decide if you're shipping Expo Managed or bare RN

We chose **Expo managed (SDK 54)** with **EAS Build** + **expo-updates**
for OTA. Pros: no Xcode / Android Studio on dev machines, faster
iteration. Cons: any native module not in Expo SDK requires a custom
dev client.

Modules that drove our stack choice:
- `expo-secure-store` — credential vault (auth tokens, paired printer id)
- `@react-native-async-storage/async-storage` — non-credential cache
- `expo-sqlite` — local outbox + (future) sales table
- `react-native-bluetooth-classic` — ESC/POS thermal printer (NOT in Expo Go — needs dev client)
- `@react-native-community/netinfo` — online/offline transitions
- `@gorhom/bottom-sheet`, `react-native-paper`, `react-native-gesture-handler`, `@tanstack/react-query`, `zustand`

If your app needs Bluetooth, USB-OTG, or custom hardware → **you cannot
test in Expo Go**. Build a dev client APK early or you'll waste a week
debugging "works in Expo Go, crashes on real device".

---

## Phase 1 — Build configuration (do this once, get it right)

### `app.json`

```jsonc
{
  "expo": {
    "owner": "<your-expo-org>",                // org account, NOT personal
    "name": "Clerque Counter",                 // ≤ 30 chars
    "slug": "clerque-counter",
    "version": "1.0.0",                        // user-visible
    "orientation": "default",                  // unless you mean it
    "scheme": "clerque-counter",               // deep-link scheme
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,                    // Fabric + TurboModules
    "icon": "./assets/icon.png",
    "splash": { ... },
    "android": {
      "package": "com.clerque.counter",        // NEVER change after first upload
      "versionCode": 1,                        // local seed only — EAS overrides
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#8B5E3C"
      },
      "permissions": [...]                     // see Phase 4 — Data Safety
    },
    "plugins": [
      "expo-font", "expo-secure-store", "expo-sqlite",
      ["expo-camera", { "cameraPermission": "<exact text shown to user>" }]
    ],
    "extra": {
      "apiBaseUrl": "https://...",             // your prod API
      "webOrigin":  "https://...",
      "eas": { "projectId": "<from `eas init`>" }
    },
    "runtimeVersion": { "policy": "appVersion" },
    "updates": { "url": "https://u.expo.dev/<projectId>" }
  }
}
```

**Gotchas:**
- `package` (Android) and `bundleIdentifier` (iOS) are **permanent**.
  Once an AAB is uploaded with `com.clerque.counter`, that's the app's
  identity for life. Plan the namespace before first upload.
- `versionCode` in `app.json` is ignored if `eas.json` uses
  `"appVersionSource": "remote"` — EAS auto-bumps from its own
  dashboard counter. Recommended for teams.

### `eas.json`

```jsonc
{
  "cli": { "version": ">= 12.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal",              // QR install, no Play Store
      "android": { "buildType": "apk" }
    },
    "production": {
      "distribution": "store",
      "autoIncrement": true,                   // bumps versionCode every build
      "android": { "buildType": "app-bundle" } // .aab for Play Store
    }
  },
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./play-store-key.json",
        "track": "internal",
        "releaseStatus": "draft"
      }
    }
  }
}
```

---

## Phase 2 — Brand assets (script everything)

Don't hand-export PNGs from Figma. Write a Node script that rasterizes
from SVG sources via `sharp`. Re-run after every brand change.

Required assets:

| Asset | Size | Use |
|---|---|---|
| App icon | 1024 × 1024 PNG, 32-bit | Expo build → Android launcher |
| Adaptive icon foreground | 1024 × 1024 PNG, transparent | Android home screen (clipped per OEM) |
| Splash | 1242 × 2436 PNG, centered, brand bg | Cold-start splash |
| Play Store icon | 512 × 512 PNG | Play Console listing |
| Feature graphic | 1024 × 500 PNG | Play Store header banner |
| Phone screenshots | 1080 × 1920 (9:16), 2–8 of them | Play Store listing |
| Tablet screenshots | 1920 × 1080 (16:9), 2–8 | Play Store listing (required if tablet-first) |

**Adaptive icon math** — the OS clips the 1024×1024 foreground into a
circle/squircle/rounded-square. The **safe area is the inner 66%** —
anything outside that gets cut. Center your mark.

**Feature graphic math** — left half is often covered by the app icon
overlay on the listing card. Put your visual on the left, text on the
right. Stack the wordmark on two lines if it overflows.

**Screenshots** — Play Console requires:
- At least 2 phone screenshots
- For "Designed for tablets" badge: tablet shots required (both 7" and 10" slots — same files OK)
- Each side between 320 and 3840 px; for promotion eligibility, ≥ 1080 px on the long edge

We generated **simulated** screenshots (SVG → PNG, branded UI mockups)
for the initial Play submission, with a plan to replace with real
device captures before production rollout. Play accepts simulated shots
for internal testing — production review may flag them if they
misrepresent the app, so make the simulation faithful to what shipped.

---

## Phase 3 — Legal pages BEFORE you start the Play Console wizard

Play asks for these URLs early. Have them live on your domain before
clicking "Create app":

| Page | Required by | Notes |
|---|---|---|
| `/legal/privacy` | Always | What you collect, how you use it, third parties, user rights |
| `/legal/terms` | If subscriptions / sign-up | Acceptance, plan terms, dispute resolution |
| `/legal/account-deletion` | If app allows user accounts | Play Console rejects an email-only contact — needs a dedicated URL |
| `/legal/sla` | If you advertise uptime | Required by some enterprise customers |

**Account-deletion URL is non-negotiable** as of 2024. The URL must
explain:
1. How to request deletion (clear email + subject template)
2. What gets deleted vs retained (with legal references)
3. Timeline (we used 24h ack / 7d sign-in disable / 30d purge)

For PH apps, retention is forced by:
- BIR records — 10 years (NIRC §235)
- AMLA records — 5 years (RA 9160 / BSP Circular 950)
- Payroll / labour — 3 years (Labor Code)

These MUST be disclosed on the deletion page or the legal copy is
incomplete.

---

## Phase 4 — Play Console setup walkthrough

### Create app
- App name: ≤ 30 chars
- Default language: pick the primary market's locale
- App or game: App
- Free or paid: Free (subscriptions are sold outside Play if you use the consumption-only pattern)
- Accept declarations

### App access
- Choose **"All or some functionality in my app is restricted"**
- Add instructions with:
  - Test credentials (username + password) that ACTUALLY WORK
  - Step-by-step sign-in instructions for the reviewer
  - Note about subscriptions sold externally (cite "consumption-only" pattern; same as Spotify/Netflix)
- **Critical**: seed the demo account on production DB before submitting. Reviewers can't sign up themselves — they need a working pre-seeded account.

### Ads
- Contains ads: No (unless you actually have an ad SDK linked)

### Content rating
- Run the questionnaire. For a B2B / business tool:
  - No violence, sexual content, controlled substances, gambling
  - No location
  - Standard HTTPS cryptography → exempt under ENC §740.13(e) Note 4
  - No user-generated public content
  - Expected: **Everyone / PEGI 3 / ESRB E**

### Target audience and content
- 18+ (business tool)
- Not children's app
- Not designed for families

### Data Safety form
This is the biggest time-sink. Have your `listing.md` data-safety table
ready. Standard answers for a multi-tenant SaaS POS:

| Category | What we tick |
|---|---|
| Location | None |
| Personal info | Name, Email, User IDs |
| Financial info | Purchase history only |
| Photos, Audio, Files, Calendar, Contacts, Messages, Health, Web history | None |
| App activity, App info, Device IDs | None |

For each ticked data type:
- Collected: **Yes**
- Shared: **No**
- Required: **Yes**
- Ephemeral: **No** (it's in your Postgres)
- Purposes: **Account management** + **App functionality** (never Advertising)

### App content category
- Pick **Business** (NOT Finance — triggers fintech review). Even if
  you handle money for the merchant, you're a business tool, not a
  consumer fintech.

### Financial features (separate step)
- For POS: tick **"My app doesn't provide any financial features"**.
  This section is for fintech apps that move money between users / are
  lenders / trade crypto. POS apps just record sales.

### Store listing
- App name: ≤ 30 chars
- Short description: ≤ 80 chars (this shows in search results — make it count)
- Full description: ≤ 4000 chars (we used ~2500). Structure:
  - One-line value proposition
  - Star-headed feature blocks (★ AT THE TILL, ★ INVENTORY, etc.)
  - Hardware compatibility
  - Subscription notes
  - Support contact
- Upload icon, feature graphic, screenshots

---

## Phase 5 — Pre-AAB checklist

Before kicking off the production build, verify locally:

```bash
# Type check (Counter)
cd apps/counter && npx tsc --noEmit

# Type check (API — Railway runs this in build, but cheaper to fail locally)
cd apps/api && npx tsc --noEmit && npm run build

# Regenerate brand assets if SVGs changed
cd apps/counter && node scripts/build-store-assets.js

# Confirm migrations up to date
cd packages/db && DATABASE_URL=... npx prisma migrate status
```

If anything fails, fix locally. Don't burn a remote build slot to
discover a missing enum case.

**Commit + push** the API + DB migration changes FIRST. Railway should
have the new schema live before the AAB lands on testers' phones.
Then build the AAB.

---

## Phase 6 — Build the AAB

```bash
cd apps/counter
eas build --profile production --platform android --non-interactive
```

What happens:
1. EAS compresses your local source (respects `.easignore`)
2. Uploads to Expo CDN
3. Picks a worker, pulls source, runs `npm install`
4. Runs `prebuild` (generates `android/` if needed)
5. Auto-bumps `versionCode` (remote source)
6. Runs Gradle: `assembleRelease` then `bundleRelease`
7. Outputs `.aab` to a download URL

Timing: 12–18 minutes typical. First build of a project is slower (no
cache).

### Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| "Worker ran out of memory" | Metro JS bundler OOM on large apps | Add `org.gradle.jvmargs=-Xmx4096m` to `android/gradle.properties` (eject) OR retry — EAS workers vary |
| "We've lost connection to the worker" | Infra flake on Expo side | Just retry. ~5–10% of Android prod builds hit this |
| Build succeeds but app crashes on launch | Native module not in dev client | Use `expo prebuild` + dev client; never test prod builds first time |
| Wrong icon in Play Store but right icon in the app | App icon != Play Store icon. Upload 512×512 separately | Keep them in sync via the regen script |

---

## Phase 7 — Upload to Play Console

1. Play Console → your app → **Internal testing** → Create new release
2. Upload AAB
3. Add release name (default = versionCode is fine)
4. Add release notes (max 500 chars per locale)
5. Save → Review release → Roll out to Internal testing

### Internal vs Closed vs Open vs Production

| Track | Max testers | Review SLA | Recommended use |
|---|---|---|---|
| Internal | 100 | None — instant | Smoke test on your team's devices |
| Closed (Alpha) | Configurable | Hours–1 day | Pilot customers |
| Open (Beta) | Unlimited | 1–3 days | Public beta opt-in |
| Production | Everyone | 3–7 days first time, hours after | Final |

For Clerque Counter we started with Closed Alpha (the bakery pilot)
and stayed there for the first 2 weeks.

### Setting up Internal testers
- Create an email list (e.g. `clerque-internal-testers@googlegroups.com`)
- Add to the track
- Share the opt-in URL with testers
- They click → "Become a tester" → install via Play Store

---

## Phase 8 — Smoke test the AAB on a real device

Before promoting to wider rollout, manually walk every primary flow.
Our flow for a POS app:

1. **Cold install** from Play Internal track
2. **Sign in** with demo credentials → lands on dashboard
3. **Open shift** → count drawer → save
4. **Force-quit + reopen** → still in same shift (persistence test)
5. **Ring a sale** for each tender type:
   - Cash → counts change correctly
   - GCash → captures reference number
   - PayMaya → captures reference number
   - Card → captures slip number
   - QR PH → captures InstaPay reference
6. **Apply Senior 20%** → ID capture sheet pops → cart math is right
7. **Print receipt** → if Bluetooth printer paired, actually prints
8. **Add customer** → search works → customer attached to next order
9. **Close shift** → Z-read totals match the sales rung
10. **Print Z-read** → real ESC/POS bytes go to printer
11. **Sign out** → land on sign-in screen
12. **Lose WiFi mid-sale** → outbox queues the order → reconnect → drains

If any step fails, capture screenshot + logcat, file bug, fix, build
next AAB. Don't promote until every step passes.

---

## Phase 9 — Promote to production

When internal testing is clean for ≥ 1 week:

1. Internal track → menu → **Promote release** → choose Production
2. Start with **5% staged rollout**
3. Watch crash-free rate in Play Console for 24h
4. If clean, ramp 5% → 25% → 50% → 100% over 3–5 days
5. If crash rate spikes > 1%, halt rollout, investigate

---

## Architecture Pitfalls — read these BEFORE writing offline-first code

These are the categories of bugs that cost us days. None of them
showed up in unit tests — only in real-device usage with real users.

### 1. Don't mix local React state and Provider state for the same domain object

Symptom: cashier opened shift on Shift tab; cart still said "Open
shift first" because cart read from a Provider that didn't know about
the local state.

Rule: **one source of truth per domain concept**. If a global Provider
exists, screens MUST push their optimistic mutations into it. Don't
create a parallel `useState` for the same data.

### 2. Server CUIDs vs local fake IDs — pick one path

Symptom: opened a shift → app generated `shift_${Date.now()}` as
local ID → submitted orders carrying that ID → server's
`/shifts/active` aggregation joined on `Order.shiftId = '<real CUID>'`
which never matched → Z-read always showed ₱0 cash sales.

Rules:
- If an operation **can be done online**, do it online **first** and
  use the server ID. Offline is the fallback, not the default.
- Never invent IDs that look like server IDs. If you must fake one,
  prefix it (`local_`, `pending_`) so it's clear at every site.
- When the outbox drains a fake-ID record, the server must accept it
  and return the real ID, AND the client must reconcile (update
  cached records from fake → real ID).

### 3. Outbox dispatch needs handlers for every enqueued kind

Symptom: we enqueued `shift.open` but `dispatchOutbox()` had no `case`
for it. Every row sat marked "unknown kind" forever. The Pending Sync
banner showed counts that never went down.

Rules:
- Every `enqueueOutbox(kind, ...)` site has a paired `case` in
  `dispatchOutbox`. Lint rule or test enforces this.
- Provide a **one-shot purge** for legacy kinds when you remove or
  rename one. Older app installs still have those rows queued.

### 4. AsyncStorage keys must be scoped by tenant + user

Symptom: cashier A signs out, cashier B signs in on the same device,
inherits cashier A's open shift.

Rule: scope every persisted blob by
`<tenantId>:<branchId>:<userId>`. Or clear all of them on sign-out
(`SecureStore.deleteItemAsync` + `AsyncStorage.clear()` selectively).

### 5. Enum mismatches between Counter UI and server PaymentMethod enum

Symptom: Counter sent `mapMethod('CARD') = 'QR_PH'` because server
enum had no `CARD`. UI showed Card; DB stored QR_PH. Z-read column
labelled "Card" actually contained QR PH transactions.

Rules:
- Enums representing real-world concepts (payment rails, discount
  types, BIR statuses) belong in the **shared-types package**, single
  source of truth.
- Counter and API should both depend on the same TypeScript union or
  Prisma enum — never two parallel definitions.
- When mapping required (e.g. UI label → enum value), centralize the
  mapping in **one** function. Don't scatter `switch` statements.

### 6. Discount + VAT math is BIR-regulated — get the rules in code, not in comments

For VAT-registered tenants:
- **Senior / PWD line**: VAT-exempt, 20% off the **net-of-VAT** amount
- **MARKDOWN (e.g. bakery EOD)**: VAT still applies on the discounted amount
- **No discount**: 12% VAT extracted from VAT-inclusive price

For non-VAT tenants: no VAT, discount applies directly.

The math MUST be implemented per-line, not order-level — different
lines may have different discount kinds.

```ts
function linePricing(line, isVatRegistered) {
  const exempt = isVatRegistered && (line.discount.kind === 'SENIOR' || line.discount.kind === 'PWD');
  if (exempt) {
    const netOfVat       = Math.round(line.gross / 1.12);
    const discount       = Math.round(netOfVat * 0.20);
    return { discount, vat: 0, final: netOfVat - discount, taxType: 'VAT_EXEMPT' };
  }
  const discount   = Math.round(line.gross * (pctFor(line.discount) / 100));
  const discounted = line.gross - discount;
  const vat        = isVatRegistered ? Math.round(discounted - discounted / 1.12) : 0;
  return { discount, vat, final: discounted, taxType: isVatRegistered ? 'VAT_12' : 'VAT_EXEMPT' };
}
```

### 7. PWD / Senior ID capture is mandatory before applying the discount

RA 9994 (Senior) and RA 10754 (PWD) require:
- **Cardholder name** (as printed on the ID)
- **OSCA / Senior ID number** OR **PWD ID number**

Both must appear on the OR (Official Receipt). Without them, BIR can
disallow the VAT-exemption + 20% during audit.

Implementation rule: **the discount cannot be applied to the cart
without the capture sheet completing.** Don't show the option then
prompt for ID after — the cashier will rush and skip it.

### 8. Receipt-vs-Z-read math must reconcile with server-side aggregation

The Z-read at end of shift sums what was rung. The server's
`/shifts/:id` summary sums what was stored. If they don't match, the
cashier blames the system.

Rule: the cart store, the order-submit payload, and the server's
aggregation MUST agree on what counts as "VATable sales", "VAT-exempt
sales", "discounts", and "voids". Test with unit tests on at least
the three cases: VAT-registered + Senior discount, VAT-registered + no
discount, non-VAT + Senior discount.

### 9. "Sales survive WiFi drops" claim needs more than outbox queuing

We advertised offline POS in our store listing. The outbox queues
mutations — but the **Z-read aggregator reads server-side data only**.
So if the cashier rings 10 sales offline, the Z-read shows 0 sales
until sync.

For a real offline-first POS, you need a **local sales table** that
the Z-read can read alongside the server's data. That's bigger work —
schedule it for a follow-up sprint and don't claim full offline
support in marketing copy until it ships.

### 10. Print stubs become silent regressions

We had `handlePrint = console.log(...)` in the Z-read screen. The
button looked fully wired but produced no paper. BIR-compliant
cashiers will look for a printed Z-read at end of shift and call
support when it doesn't appear.

Rule: **never ship a print button that doesn't print.** Either wire
it to a real backend (ConsolePrinter is fine for dev), or hide the
button until it's wired.

---

## Reusable Scripts

These are in `apps/counter/scripts/` and can be copied to any future
Expo app:

| Script | What it does |
|---|---|
| `build-store-assets.js` | SVG → PNG for icon, adaptive icon, splash, Play Store icon, feature graphic |
| `build-screenshots.js` | Generates phone screenshots (1080 × 1920) from SVG templates |
| `build-tablet-screenshots.js` | Generates tablet screenshots (1920 × 1080) from SVG templates |

Re-run after every brand change. They're idempotent.

---

## When something goes wrong in production

### App is crashing on launch
1. Play Console → Quality → Android vitals → Crashes & ANRs
2. Click the stack trace → Filter by versionCode
3. Common: native module missing, JS bundler missing dep, Hermes vs JSC issue
4. Hotfix path: rebuild with the fix → upload → roll out to Internal first

### Wrong data being shown
1. Check the server-side aggregation endpoint manually (curl)
2. Compare to what the device shows
3. If mismatch → client bug
4. If match but wrong → server aggregation bug

### Reviewer rejects the app
1. Read the rejection email — they usually cite a specific policy section
2. Common reasons:
   - **Data Safety inaccurate** → re-fill the form
   - **Missing account deletion URL** → create the page
   - **Misleading screenshots** → replace with accurate ones
   - **Crashes during review** → fix + resubmit
3. Reply with a fix + a new AAB. Don't argue policy unless you're sure.

### A specific tenant's sales are missing from reports
- Check `Order.shiftId` is non-null
- Check `Order.tenantId` matches the tenant
- Check `Order.status != 'VOIDED'`
- Check the shift wasn't auto-closed (server auto-closes shifts at end of business day if cashier forgot)

---

## Checklist — Day-of-launch

- [ ] All migrations applied to prod DB
- [ ] API deploy is green
- [ ] Demo / test tenant seeded with sample data
- [ ] App access declaration has working credentials
- [ ] All Play Console sections show ✓ (no red asterisks remaining)
- [ ] Privacy policy URL returns 200
- [ ] Account deletion URL returns 200
- [ ] AAB versionCode is greater than any previously uploaded
- [ ] Internal testing track is OPEN (not Closed)
- [ ] Internal testers added by email
- [ ] Smoke test passed on at least 2 different physical devices
- [ ] You have a rollback plan if production rollout shows crashes

If every box is ticked, promote to production with 5% staged rollout
and watch the dashboard.
