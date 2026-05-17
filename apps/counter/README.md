# Clerque Counter (Android)

Native Android tablet POS — the front-of-house companion to **Clerque Cloud**
(the web back-office at clerque.com). Same Clerque subscription powers both;
this app never sells anything in-app (Play Store consumption-only model,
identical to Spotify / Audible).

Built with **Expo SDK 54** + React Native 0.81 + React Navigation v7 +
react-native-paper (MD3 themed) + Zustand + @tanstack/react-query.
Primary device: Samsung Galaxy Tab A8 10.5″ landscape (1920×1200).

---

## Device modes

On first launch the app asks "How will this device be used?" — pick once,
the choice persists. To change later: drawer footer → "Change device mode".

| Mode | Login | Surface |
|---|---|---|
| 🛒 Cashier till | Tenant + email + password + cashier PIN | Full POS flow — terminal, modifiers, tendering, receipt, shift, Z-read |
| 📺 Customer-facing display | None — pairing code from cashier | Read-only mirror of the cashier's cart + GCash/PayMaya QR |
| 🍳 KDS Kitchen / Bar | None — pairing code | Order queue, tap-to-bump, tone by wait time |
| 👀 Owner spot-check | Owner login | Read-only multi-branch dashboard |

The pairing flow: cashier opens **Settings → Displays → Generate code** →
4-digit code + QR appear → the secondary device redeems via Counter's
pairing screen (or via web `clerque.com/pair?code=XXXX&tenant=<slug>`).
Token persisted in SecureStore; survives reboots; revocable from the
cashier's Displays page.

---

## Development

### Prerequisites

- **Node 20+** (LTS recommended)
- **Expo CLI** — `npm i -g expo` (optional; `npx expo` works too)
- **Android Studio** (for emulator + USB-debug installs) — only needed if
  you don't want to use Expo Go on a real device
- An Android tablet (Galaxy Tab A8 recommended) with **Expo Go** from the
  Play Store, OR a development build from EAS

### First-time setup

```bash
cd apps/counter
npm install
```

The first `npm install` pulls React Native, gorhom, paper, all expo-* —
expect 3-4 minutes. After it finishes:

```bash
npx expo install --fix
```

This corrects any expo-* package versions that don't match the installed
SDK (54). Re-run after major dep changes.

### Run on a tablet (Expo Go — fastest iteration loop)

```bash
npx expo start
```

Scan the QR with Expo Go on the tablet. Hot-reload works for JS changes.
**Limitation:** Bluetooth printer + camera barcode scanner DO NOT WORK
in Expo Go — they require a development build (next section).

### Run a development build (needed for BT printer + camera)

```bash
# One-time setup (creates EAS project)
npx eas-cli login
npx eas-cli build:configure

# Build the dev client APK (~10 min in Expo cloud)
npx eas-cli build --profile development --platform android
```

EAS prints a QR / URL when the build finishes. Install the APK on the
tablet (you'll need to allow installs from unknown sources once).
Then `npx expo start --dev-client` and scan the QR — same hot reload,
but native modules (Bluetooth, camera) now work.

### Brand assets

`assets/icon.svg`, `assets/adaptive-icon.svg`, `assets/splash.svg` are
the source-of-truth artwork. Expo needs PNGs at build time. Cheapest
options to convert:

```bash
# Option A — use sharp (Node, fast, no external tools)
npm i -D sharp
node -e "require('sharp')('assets/icon.svg').png().resize(1024,1024).toFile('assets/icon.png')"
node -e "require('sharp')('assets/adaptive-icon.svg').png().resize(1024,1024).toFile('assets/adaptive-icon.png')"
node -e "require('sharp')('assets/splash.svg').png().resize(2048,2048).toFile('assets/splash.png')"
```

Then add the icon/splash entries back to `app.json`:

```json
"icon": "./assets/icon.png",
"splash": { "image": "./assets/splash.png", ... },
"android": { "adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png", ... } }
```

Defer this until you're ready for the Play Store internal-track build —
Expo's defaults work fine for dev.

---

## Producing the Play Store build (AAB)

1. **Tag the version.** Bump `expo.version` in `app.json` (semver) and
   commit. EAS auto-increments the Android version code.

2. **Build the release bundle.**
   ```bash
   npx eas-cli build --profile production --platform android
   ```
   ~12-15 min in Expo's cloud. Output is a signed `.aab` ready for the
   Play Console.

3. **Download the AAB** from the EAS build page.

4. **Play Console upload.**
   - Go to your app in [Play Console](https://play.google.com/console/)
   - **Internal testing → Create new release**
   - Upload the AAB
   - Add release notes (auto-pulled from latest git commit subject if
     you set `--release-notes` on the build)
   - **Review** → **Roll out to Internal testing**
   - Add tester emails on the Testers tab — they get the install link
     within minutes

5. **Promote to Production** once internal testers confirm the build
   works on real hardware:
   - Internal testing → **Promote release → Production**

### Play Store metadata

See `play-store/listing.md` for the listing copy (short description, full
description, what's new), `play-store/privacy-policy.md` for the required
privacy policy text, and `play-store/screenshots/README.md` for the
screenshot capture checklist.

---

## Architecture quick map

```
src/
  api/                 — fetch client (auto-attaches JWT from SecureStore)
  auth/                — AuthProvider, SignIn, CashierPin, SupervisorPin
  device-mode/         — first-launch picker + pairing + paired-display screens
  shell/               — drawer + top bar + sync pill + DisplaysScreen
  terminal/
    fb/                — F&B 3-pane terminal + modifier sheet
    retail/            — scan-first dense table + 18+ banner
    laundry/           — customer-required + Fleet screen
    pharmacy/          — search + batch FEFO + Rx + S2 interstitial
    cartStore.ts       — Zustand cart shared across verticals
    TerminalRouter.tsx — boots the right vertical from tenant.businessType
  payment/             — Tendering modal (Cash/GCash/PayMaya/Card/Split)
  receipt/             — BIR-compliant receipt + printer interface
  shift/               — Shift open + Z-read close
  offline/             — SQLite outbox + NetInfo + sync drain + amber banner
  components/          — shared atoms (Money, Pill, IconButton, LineItem)
  theme/               — design tokens + Paper MD3 theme
  types/               — domain types (CartState, TenantConfig, PlanFeatures)
```

`apps/counter/design-source/` (gitignored) holds the Claude Design HTML/JSX
mockups that drove the visual design. Re-download from the design URL if
you need them.

---

## Backend dependency

This app talks to the Clerque Cloud API (NestJS, deployed on Railway).
The base URL is set in `app.json`:

```json
"extra": { "apiBaseUrl": "https://clerque-suite-production-93b1.up.railway.app" }
```

Change for self-hosted or staging:
- **Local dev** → `http://10.0.2.2:3001` (Android emulator → host loopback)
- **LAN tablet** → `http://<your-laptop-IP>:3001`

Endpoints used:
- `POST /auth/login` + `/auth/me` + `/auth/refresh`
- `POST /auth/cashier-pin`, `/auth/supervisor-pin`
- `GET /tenant/profile`, `/tenant/branches`
- `GET /products/pos` (catalog)
- `POST /orders` (cart submission with offline-queue idempotency key)
- `GET /customer-display/state` + `POST /customer-display/state`
- `GET /kds/stations/:id/queue` + `POST /kds/items/:id/bump`
- `POST /display-pairing/redeem`, `GET /display-pairing/whoami` (no auth — device-token flow)

---

## Hardware support

| Peripheral | Status | Notes |
|---|---|---|
| Bluetooth thermal printer (ESC/POS) | ✅ via `react-native-bluetooth-classic` | Standard 58mm / 80mm receipt printers; BIR-accredited models work fine. Needs dev-build (not Expo Go). |
| USB-OTG barcode scanner | ✅ via keyboard wedge (no driver) | Most cheap PH scanners emulate a keyboard. Focus the search field, scan, done. |
| Camera barcode scanner | ✅ via `expo-camera` | Fallback when no USB scanner is plugged in. Needs dev-build. |
| Cash drawer | ✅ via the printer | ESC/POS printers usually have a 6P6C jack that triggers the drawer on a specific byte sequence. Wired by default. |

---

## Common questions

**"Do my customers need to install this app?"**
No. The Counter app is for the cashier device only. The customer-facing
display is a paired browser tab on any TV / second tablet / Chromecast —
they open `clerque.com/pair` and type a 4-digit code from your Settings.

**"Can I run two cashier accounts on the same tablet?"**
Yes — use the drawer footer **Switch cashier** to log a different
cashier PIN. The tenant session stays alive; each cashier gets their
own shift + sales.

**"Does the app work offline?"**
Yes — sales go to a local SQLite outbox and drain to the Cloud when
connectivity comes back. Z-read still reconciles correctly. The amber
"Working offline — sales will sync" banner appears when the network
is down.

**"What about iOS?"**
Out of scope for V1. The same React Native codebase will run on iOS
with minimal changes (mostly the BT printer module — `react-native-
bluetooth-classic` supports iOS but printer model compatibility varies),
but we're shipping Android-first to match the PH SMB device reality
(₱9k Galaxy Tab A8s outnumber iPads 100:1).
