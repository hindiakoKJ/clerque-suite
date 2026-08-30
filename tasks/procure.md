# Clerque Procure — independence

**Goal (KJ, 2026-08-30):** Procure becomes the single door stock walks through.
Nothing enters inventory by someone typing a number. Every receipt matches a
request by control number; requested vs received is compared; any difference
needs an owner override. Physical count and reconciliation live here, and are
the basis for believing the numbers.

**Why now:** Cafe Carolina is the first paying client. Everything below is
scoped to an F&B tenant buying for cash from the wet market and the grocery —
no vendors, no credit terms, no POs.

---

## Deferred until we take on another business type

These also add stock, and they were deliberately left in POS. Each is bound to
a vertical Carolina is not, and each carries rules Procure does not model yet.
Revisit when a client in that vertical signs — not before.

- [ ] **Pharmacy — Product Lots** (`/pos/pharmacy/lots`)
      Lot + expiry tracking is FDA-mandated. Procure has no lot or expiry
      concept; folding it in now would mean modelling regulated data for a
      client who does not exist.
- [ ] **Pharmacy — Deliveries** (`/pos/pharmacy/deliveries`)
      Receives against a lot, not an ingredient. Same reason.
- [ ] **Fuel — Tank dips** (`/pos/fuel/tank-dips`)
      This IS a physical count, but of a tank, with temperature and evaporation
      variance rules that have nothing to do with counting a shelf.
- [ ] **Fuel — Pumps** (`/pos/fuel/pumps`)
      Meter readings, not receipts.
- [ ] **Serialized units** (`/pos/serialized-units`)
      One row per physical unit with a serial. Retail/electronics.
- [ ] **Purchase Orders** (`/pos/purchase-orders`, `/admin/purchase-orders`)
      Vendor + credit terms + approval chain. Carolina pays cash and has no
      credit vendors, which is exactly why Procure exists as a separate,
      simpler flow. When a retail client needs POs, decide then whether POs
      become a Procure request type or stay separate.
- [ ] **Product-level stock** (retail finished goods, not ingredients)
      Procure is ingredient-shaped today. Retail buys the thing it sells.

**Rule for revisiting:** do not generalise Procure speculatively. Wait for the
second vertical, then look at what two real clients actually share.

---

## Open decisions

## Room-to-room transfers — RESOLVED (KJ, 2026-08-30)

The shop has **three locations today — stockroom, bar, kitchen** — and is
already sending "trans in" reports by hand. A fourth (a pickleball court bar)
is coming.

### Rooms cannot be branches. One fact decides it.

**An order consumes from more than one room.** A customer orders a latte and a
rice bowl on one ticket: the latte's ingredients live in the bar, the rice
bowl's in the kitchen. A sale deducts from ONE branch and `maxProducible` is
computed per branch — so with bar and kitchen as separate branches, that order
could not be costed or deducted at all, and every POS tile would read 0 for
whichever room the till was not assigned to.

Making rooms branches also drags in everything else a branch means: its own
Z-read, its own shifts, its own staff assignment, its own line in every report.
A three-room cafe would look like three shops to the BIR.

### The shape: Tenant → Branch (venue) → Location (room)

A **branch is a venue** — the accounting and BIR unit, one till, one Z-read.
A **location is a room inside it**, and rooms exist only for *where the stock
physically is*.

  - Valuation, COGS and `maxProducible` keep rolling up to the BRANCH. Selling
    does not change at all, which is what makes this safe to add.
  - **Counting** becomes per location — you count the bar fridge, not "the
    branch", which is what a person actually does.
  - **Transfers** become room-to-room within a branch: quantity moves, and
    **no journal entry is posted**, because no value leaves the business. That
    is the difference from a branch transfer and the reason this is cheap.

- [ ] `StockLocation` model (tenantId, branchId, name, isDefault) and a
      nullable `locationId` on `RawMaterialInventory`. **Needs a migration**,
      plus a backfill giving every existing row a "Main" location per branch so
      nothing changes on deploy.
- [ ] Transfers UI switches from branch→branch to location→location, with
      branch→branch kept for the multi-venue case.

### The pickleball court bar — RESOLVED (KJ, 2026-08-30)

KJ: the court sits a few metres from the cafe and **will be registered
separately**.

**So it is not a room, and the distance is irrelevant.** BIR counts
establishments, not metres — a place that rings its own sales and hands the
customer its own invoice is its own registered establishment even if it shares
a wall. Rooms exist for stock that has no till.

Which of the two it becomes turns on **whose TIN is printed on the customer's
receipt**. That is an entity question for their accountant, and it has two
different answers here:

| The court is registered as… | In Clerque | Stock moving cafe → snack bar |
|---|---|---|
| A **different TIN** — a corporation, or a different person | a separate **TENANT**: own books, own VAT return, own subscription | a **SALE**. Invoice, output VAT on the cafe, input VAT on the court. Not a transfer. |
| The **same TIN**, second business name / branch code — the usual shape, since a sole proprietor can only hold one TIN | a separate **BRANCH** in this tenant: own Z-read, own invoice series, own registered POS, consolidated books | a **branch transfer**: quantity moves, no P&L effect. |

**The trap is the same in both columns: the supply line.** "The cafe just sends
over cups and beans" is what breaks the books. Under separate TINs those
informal moves understate the cafe's sales and leave the court holding stock
with no purchase document behind it. Under one TIN it is harmless — but only
if it is recorded as a transfer instead of quietly vanishing.

**Consequence for this build: none, and that is the point.** A snack bar is a
branch or a tenant, and both exist today. `StockLocation` stays exactly the
three rooms — stockroom, bar, kitchen. When the court opens it gets its own
rooms underneath (back stock, front bar), which the shape already allows. The
migration does not grow.

- [ ] **Name the limiting ingredient** in `maxProducible`. It is already
      computed and thrown away. Naming it is what routes "we are out of X" to
      the person who can fix it.

---

## Counter PIN — audit findings (2026-08-30)

The owner reported guessing PINs and getting in. Audited adversarially, then
re-checked by a defender pass so the report is not overstated.

**Not true:** you cannot PIN into the POS from a cold screen (`/auth/pin-login`
needs company code + email + PIN); rate limiting exists on every route;
supervisor PINs (void/refund co-auth) are bcrypt, not plaintext; `/auth/pin-login`
has a real per-account lockout (5 fails / 15 min).

**True, and fixed:** there was no PIN strength policy at all — `/^\d{4,8}$/` was
the only rule. Now `apps/api/src/auth/pin-policy.ts`, wired into all three
write paths.

**True, still open:**

- [ ] **Existing weak PINs are grandfathered.** The policy runs at write time.
      Anyone already holding `1234` keeps it. Needs a one-off sweep: find them,
      clear them, make the owner re-issue.
      `SELECT id, name, role FROM users WHERE "tenantId" = '<t>' AND "kioskPin" IS NOT NULL;`
- [ ] **`User.kioskPin` is stored plaintext.** Deliberate (migration
      `20260528000000`) because bcrypt broke kiosk lookups and defeated the
      uniqueness index. The stated threat model in `users.service.ts:228` —
      "worst case is one staff member punching another's clock" — is wrong:
      the same value opens a till session and attests Rx dispensing. Fix is a
      keyed HMAC (deterministic, so lookup and uniqueness still work) rather
      than bcrypt.
- [ ] **`/auth/switch-cashier` includes `BUSINESS_OWNER` in its role set** and
      mints a full session, with no per-account failure counter. A guessed PIN
      grants whoever owns it. Decide: drop the owner from the switchable set,
      or require a step-up.
- [ ] **Five PIN-verifying endpoints sit behind only the global 600/min/IP** —
      `/pharmacy/verify-attest`, `POST /orders` (attestPin), order void, item
      refund, `/inventory/adjust`. Only the three auth routes carry the tight
      5/min.
- [ ] **`/auth/pin-login` leaks account existence** — the `KIOSK_ONLY_ACCOUNT`
      403 is thrown at `auth.service.ts:473`, before the PIN compare at `:492`.
      A garbage PIN plus a guessed email is an email-existence oracle.
- [ ] **Demo seeding writes a bcrypt hash into the plaintext column**
      (`tenant.service.ts:487`) — the last un-converted site. Those rows read as
      "PIN set" but can never authenticate, and each burns a slot in the
      uniqueness index.

## Stock-write audit — defects found while mapping (2026-08-30)

Twelve paths increase raw-material stock. Three have real defects:

- [ ] **`POST /purchase-orders/:id/receive` posts NO journal entry.** Stock and
      lots rise; inventory value and AP never reach the books. Also no WAC
      blend, no `recostProductsUsing`, no period lock, and its
      `referenceNumber` is written but never queried — so a double receive
      doubles stock. This is the Purchase Orders item still in the POS sidebar.
- [ ] **`POST /inventory/sub-recipes/:id/batches` has no working idempotency.**
      Its auto-reference is `BATCH-<date>-<last6 of id>`, identical for two
      batches of the same syrup on the same day, and never checked. A
      double-submit silently doubles the yield. Reachable by CASHIER, freely
      backdatable, and has no UI in front of it.
- [ ] **`POST /admin/tenants/:id/seed-coffee-shop-ingredients`** materialises
      opening stock with real cost prices and posts nothing — and it runs
      against live tenants, not just demo ones.

## Google Play app for Procure — the facts

`apps/counter` (Clerque Counter) is Expo SDK 54 / RN 0.81, React Navigation v7,
`com.clerque.counter`, EAS project `63627b26…`, versionCode 1.

The blocker is not the store listing, it is that **Counter shares nothing with
the monorepo** — zero workspace dependencies, no `metro.config.js`. Only ~17%
of it (4,222 of 25,545 lines) is reusable shell.

- **Separate app (`apps/procure`)** — what was asked for. New EAS project, new
  Play listing, new branding. Then either extract ~4,200 lines of shell into
  packages (which touches Counter's auth and login path — that is the
  regression surface, not the new app) or copy-paste it and fix every auth bug
  twice. Plus port ~3,700 lines of web Procure UI to React Native.
- **Feature inside Counter** — same UI porting, zero extraction. But a
  procurement-only user boots into the POS tree: device-mode choice, then
  sign-in, then the cashier-PIN gate. Routing around that means editing the
  login path.
- **PWA install of `/procure`** — no porting at all, but no Play presence, and
  `app/manifest.ts` is one global manifest starting at `/`, so it installs
  "Clerque" pointing at the app selector.

**Recommendation:** not before Carolina is live. The web `/procure` already
works on a phone, and the porting work competes directly with making Procure
the only door stock walks through.
