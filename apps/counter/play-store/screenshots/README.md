# Play Store screenshot checklist

Play Console requires:
- **2-8 screenshots per device class**
- 16:9 aspect (tablet landscape) — Counter's native orientation
- Min edge ≥ 1080px, max edge ≤ 7680px

## Capture flow

Boot Counter on a Galaxy Tab A8 with the **demo** tenant seeded (run
`npm run seed` in `packages/db` and sign in as `admin@demo.com` /
`Admin1234!`). Then walk these screens in order — Android's built-in
screenshot tool gives you the right resolution.

1. **Hero — Cashier till with cart** (F&B vertical, cart panel showing
   2-3 items, "Charge ₱X" CTA visible). Tagline overlay: "Sell faster."
2. **Tendering — GCash QR** (open the Tendering modal, tap the GCash
   tab). Tagline: "GCash + PayMaya as first-class payment."
3. **Receipt** (after confirming a sale). Tagline: "BIR-compliant
   receipts with gap-free OR sequence."
4. **Offline banner** (turn airplane mode on, then snapshot — amber
   banner visible). Tagline: "Sales survive WiFi blips."
5. **Customer-display pairing** (open Settings → Displays → generate a
   customer-facing code, screenshot the modal). Tagline: "Pair a TV
   without a second login."
6. **Pharmacy batch picker** (only for the pharmacy listing variant —
   open a drug with multiple batches, screenshot the bottom sheet).
   Tagline: "FEFO batch selection built in."
7. **Z-read** (open Shift → Close shift, snapshot the breakdown).
   Tagline: "Cash variance, tender bars, Non-VAT split — all on one
   page."
8. **Drawer + 4 verticals** (open the drawer, screenshot with sidebar
   visible to show app surface). Tagline: "Built for 4 PH verticals."

## File naming convention

```
01-hero-fb-cart.png
02-tendering-gcash.png
03-receipt-paid.png
04-offline-banner.png
05-displays-pairing.png
06-pharmacy-batch.png
07-zread.png
08-drawer-verticals.png
```

## Feature graphic

Required by Play Store, separate from screenshots.
- 1024×500 px
- Hero image with the Clerque Counter wordmark + tagline
- Suggested copy: "**Clerque Counter** — Sell faster. Close the till."
  on the cream Counter background (#F8F5EE) with electric-blue accent
- Save as `feature-graphic-1024x500.png` in this folder

## Promo video (optional but recommended)

- 30-second screen recording showing the till flow:
  1. Tap 3 items into cart (3s)
  2. Apply Senior discount (3s)
  3. Charge → Cash → Bayad keypad → Sukli computed (8s)
  4. Confirm → receipt prints (5s)
  5. Customer-display tablet mirrors the whole flow (5s)
  6. Fade to logo + clerque.com URL (6s)
- Upload to YouTube as unlisted, paste the URL into Play Console.
