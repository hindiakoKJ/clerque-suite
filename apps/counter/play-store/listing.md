# Clerque Counter — Play Store listing

> Copy/paste source for the Google Play Console listing. Each section is
> length-limited per Play Console rules — character counts noted.
> Reflects the bakery-ready feature set as of v1.0.0.

## App title (max 30 chars)

```
Clerque Counter
```

## Short description (max 80 chars)

```
BIR-ready POS for PH SMBs. Sell, track FEFO inventory, close shifts.
```

## Full description (max 4000 chars)

```
Clerque Counter is the Android companion to Clerque — the cloud point-of-sale, accounting, and payroll platform built for Philippine micro, small, and medium businesses. Coffee shops, bakeries, restaurants, food stalls, small pharmacies, laundromats, and retail counters use it to replace paper logbooks and stripped-down POS apps with one integrated system.

★ AT THE TILL

— 64dp tap targets for one-handed cashier use
— Big product grid with categories + modifiers
— Senior / PWD 20% discount with RA 9994 attestation
— Long-press = void (supervisor PIN required)
— Swipe-left = remove (before order finalizes)
— Acknowledgement Receipt for unregistered tenants, Official Receipt for BIR-registered
— Tendering wizard: Cash · GCash · PayMaya · Card · Split
— GCash + PayMaya brand-correct, never hidden under "Other"

★ INGREDIENT INVENTORY + FEFO

— Recipe-based products with full Bill of Materials
— FEFO (First-Expired-First-Out) batch tracking with 7/3/0-day alerts
— WAC (weighted-average cost) auto-recomputed on every stock-in
— Modifier recipes — "Grande" automatically deducts 12× the slice recipe
— Real-time low-stock badges on the Sell list
— COGS posted automatically to the journal

★ BAKERY FEATURES (Phase 2 + 3)

— Custom cake pre-orders with deposit + balance settlement
— Inscription text printed on the production slip
— Today's pickups card on the cashier dashboard
— Wholesale price lists per customer (auto-resolves at cart time)
— End-of-day markdown discount for near-expiry items
— Production "bake list" — recommended quantity per product based on 7-day rolling sales + tomorrow's pre-orders

★ WORKS OFFLINE

— Sales survive WiFi drops — local SQLite outbox queues every sale
— Drains to Cloud automatically when connectivity returns
— Amber "Working offline" banner (warning, not error)
— Z-read reconciles correctly across offline shifts

★ MULTI-DEVICE WITHOUT MULTI-LOGIN

— Pair a customer-facing TV with a 4-digit code from Settings → Displays
— Same flow for Kitchen / Bar displays (KDS)
— No second account, no second app install

★ SHIFT DISCIPLINE

— Drawer opening float count with denomination breakdown
— Cashier PIN gate before every sale
— Hard-block on Charge until a shift is open
— Z-read with VAT breakdown, voids, discounts, OR / AR range
— Variance reconciliation at shift close

★ HARDWARE

Recommended: Samsung Galaxy Tab A8 10.5″ landscape or any Android 9+ tablet, any Bluetooth ESC/POS thermal printer, any USB-OTG keyboard-wedge barcode scanner. Camera barcode scanning is the fallback.

★ SUBSCRIPTION

This app is a sign-in client for a Clerque tenant account. Subscriptions are sold separately at clerque.cc — Solo Lite ₱199, Solo Standard ₱399, Solo Pro ₱499 monthly. No in-app purchases, no billing inside the app (consumption-only pattern; same as Spotify and Netflix).

Need help? help.clerque.cc or support@hnscorpph.com.
```

## What's new (max 500 chars per release)

```
🎉 v1.0.0 — First release.
• Cashier till for coffee shops, restaurants, bakeries, retail, laundry, pharmacies
• Bakery pack: pre-orders, wholesale price lists, EOD markdown, bake list
• FEFO ingredient inventory with 7/3/0-day expiry alerts
• Modifier recipes — size scaling + add-on ingredients
• BIR-compliant Z-read (Official Receipt or Acknowledgement Receipt)
• Tendering: Cash, GCash, PayMaya, Card, Split
• Customer display + KDS pairing — no second login
• Offline outbox; sync resumes when WiFi returns
```

## App category

- **Primary:** Business
- **Secondary:** Productivity

## Tags (Play Console no longer has free tags — these are search keywords already worked into the long description)

`pos`, `point of sale`, `bir`, `philippines`, `cashier`, `retail`, `bakery`,
`fnb`, `coffee shop`, `pharmacy`, `laundry`, `receipt`, `thermal printer`,
`gcash`, `paymaya`, `inventory`, `FEFO`

## Pricing

Free download. In-app purchases: **none**. The app is a sign-in client
for an existing Clerque subscription sold at clerque.cc.

> 🚨 Important for Play Console review: Clerque Counter qualifies for
> the "consumption-only app" exemption from Google Play Billing because
> it does not sell digital goods in-app. The Clerque subscription is a
> SaaS service (not in-app digital content) sold separately for use
> across web + this Android client. Same model as Spotify, Netflix,
> Audible. If asked: cite the **Play Console policy "Consumption-only
> apps" exception under Payments**.

## Contact info

- Developer name: HNS Corporation Philippines
- Email: support@hnscorpph.com
- Website: https://clerque.cc
- Privacy policy: https://clerque.cc/legal/privacy

## Target audience + content

- Target age: 18+ (business / professional tool)
- Children's app: **No**
- Designed for families: **No**

---

## Content rating questionnaire

Answer these in Play Console > Policy > Content rating.

| Question | Answer |
|---|---|
| Violent imagery | **No** |
| Sexual content | **No** |
| Controlled substances | **No** (we sell food / dry-cleaning / etc.; we don't enable user-to-user purchase of regulated goods) |
| Gambling | **No** |
| Collect or share user location | **No** |
| Contains cryptography | **Yes** — standard HTTPS for API; exempt under Note 4 of ENC §740.13(e) (no custom crypto, no encryption beyond what Android system provides) |
| Real-money transactions | **No** — it processes cash/card sales for the tenant business; not in-app purchases from the end user |
| User-generated content | **No public sharing** — content is scoped to a single tenant |
| Age rating target | **Everyone** |

Expected rating: **PEGI 3 / IARC Everyone / ESRB E**.

---

## Data safety form

Play Console > App content > Data safety.

### Data the app COLLECTS and sends to Clerque cloud servers

| Data type | Purpose | Required | Shared with 3rd parties? | Encrypted in transit | User can delete |
|---|---|---|---|---|---|
| Email address | Account sign-in | Yes | No | Yes (HTTPS) | Yes (via web admin) |
| Name | Cashier attribution on receipts + audit log | Yes | No | Yes | Yes |
| User IDs (tenant + user CUID) | Multi-tenant data scoping | Yes | No | Yes | Yes |
| Purchase history (orders rung at the till) | Core POS function | Yes | No | Yes | Yes |
| Financial info (price-list rates, payment method aggregates) | Owner-entered for the tenant business; not personal | Yes | No | Yes | Yes |

### Data the app DOES NOT collect

- Location
- Photos & videos (camera is used for barcode scanning only; nothing is stored or transmitted)
- Audio
- Contacts
- Calendar
- Messages
- Health & fitness
- Web browsing history
- Search history
- Installed apps
- Device or other advertising IDs

### Security practices

- Data is encrypted in transit (HTTPS, TLS 1.2+).
- Users can request data deletion via dpo@hnscorpph.com (within 30 days per RA 10173).
- The app does not use advertising SDKs.
- No data is sold to any third party.

---

## Ads

| Field | Answer |
|---|---|
| Contains ads | **No** |

---

## Graphic assets to upload

| Asset | Repo path | Dimensions |
|---|---|---|
| App icon | `play-store/icon-512.png` | 512 × 512 PNG (32-bit) ✅ generated |
| Feature graphic | `play-store/feature-1024x500.png` | 1024 × 500 PNG ✅ generated |
| Phone screenshots | capture from running app → `play-store/screenshots/phone/` | 1080 × 1920, 2–8 of them |
| Tablet screenshots | capture from running app → `play-store/screenshots/tablet/` | 1200 × 1920, 2–8 of them |

### Screenshots to capture (in order)

Use the demo tenant. Optionally stage realistic data first:

1. **Phone — Sign in** with the purple Clerque logo + brown CTA
2. **Phone — Dashboard** showing today's gross-sales hero card
3. **Phone — Sell list** with category chips + a few coffee/bread products
4. **Phone — Cart drawer** with 2–3 lines + discount + customer rows
5. **Phone — Tendering Step 1** (method picker with the 5 methods)
6. **Phone — Receipt** showing a paid sale with OR / AR number visible

Optional but recommended (better for review):

7. **Tablet — Terminal** showing the 3-pane layout (categories | products | cart)
8. **Tablet — Z-Read closing** with totals and tender breakdown

How to capture: open Counter on the device, take a native screenshot
(power + volume-down), pull to your computer, drop into the matching
folder, upload via Play Console.
