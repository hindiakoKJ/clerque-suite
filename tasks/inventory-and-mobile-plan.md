# Clerque Inventory + one Play app for every shop (plan, 13 Oct 2026)

KJ's direction: a fifth app, Clerque Inventory; the Google Play app rebuilt as one app for every shop that shows features by role, with a camera scanner, label printing and offline work; scan to receive, Counter sells, Inventory updates, Ledger books. First customer: the godfather's Japan-surplus auto-parts shop (tasks/surplus-autoparts-plan.md); cafes such as Carolina after her go-live. Built from a read of apps/counter, the web role logic and the API, plus research on scanners, label printers and offline sync; an architect drafted it and a critic checked it against the code.

## Summary

Yes, this can be built, and most of the plumbing already exists. The API already books every sale, stock-in and write-off into the Ledger, and the Play app already has an offline camera scanner and a Bluetooth printer connection. The Play app keeps its listing (package com.clerque.counter), is renamed "Clerque" and becomes one app for every shop: after sign-in the server says which tiles this person gets, using the web's role rules. A cashier gets the till with a scanner; stock staff get Receive, Tag a part, Take out, Count and Print labels. Work goes API first, then web, then phone. Phase 1 gets the godfather's shop selling each tagged part only once, online, from a phone browser, with no database change. Phases 2 to 4 make the API ready for phones and rebuild the Play app around offline scan-and-sell plus label printing on a Bluetooth Xprinter of about ₱5k. Offline work replays as the person who did it, and a sale that already happened is never refused; a conflict such as a part sold twice becomes an alert to the owner. Cafe Carolina's scan flows come in Phase 5, after her go-live week, and packaged goods need no stickers because they already carry barcodes. Phase 6 is the one migration branch and waits for KJ. Two honest limits: until that migration, "stockroom to bar" is a record and not a stock move, because recipes already take the ingredients off when Ready is tapped; and labels fade outdoors, so the painted number stays the part's real identity. Before the store release, the privacy policy and the Play data-safety form must change, because photos will now leave the phone. KJ builds and submits the store release himself.

## Architecture

FIVE APPS, ONE API, TWO WAYS IN
- Counter is selling, Procure is buying, Inventory (new) is what you have, Ledger is the books and BIR, Sync is payroll.
  - Inventory covers stock of everything, tagged parts with photos, counts and the missing list, owner write-offs, take-outs and transfers.
  - Sync stays on the web and is not touched.
- One API (api.clerque.cc) serves both the web app and the Play app. Every rule that matters lives in the API, so both apps behave the same:
  - who may do what;
  - the sell-by-tag lock;
  - costs hidden from staff;
  - replay safety.
- The web app stays the main app: owner desk work, Ledger, Procure, KDS and customer displays, and Carolina's till.
  - It gains an Inventory card, gated by role the way Procure is. There is no new AppCode or module flag, so no migration (apps/web/lib/app-roles.ts:28-59, apps/web/lib/apps.ts:131-176).
  - The web launcher does not know the shop type today: accessibleApps() takes no businessType (apps.ts:131-134) and the token carries none. Any per-shop-type hiding must read it from the API.

HOW THE PLAY APP PICKS FEATURES (like the web)
- One app for every shop, on the same listing (com.clerque.counter, app.json:23), renamed "Clerque".
- After sign-in it calls a new GET /me/home. The server applies, in order:
  1. the role, from the web's role table moved into packages/shared-types (it is already free of React: app-roles.ts:18-19);
  2. the shop's module switches;
  3. the person's access level;
  4. the shop type, read from the tenant. The token does not carry it (auth.service.ts:723), which is why Counter gives every shop the retail till today (AuthProvider.tsx:53);
  5. whether the shop has more than one branch.
- The phone imports nothing from the web; the server decides the tiles.
- The phone shows only the tiles it gets back:
  - CASHIER: Sell. At a parts shop also Tag a part and Roll call, if KJ picks option A (see decisions). Small shops have one person selling and receiving, and a user has only one role.
  - WAREHOUSE_STAFF: Receive, Count, Tag a part (parts shops) and Take out (cafes).
  - BRANCH_MANAGER: the same, plus Print labels. A manager cannot open a shift (shifts.controller.ts:37), so no cash selling.
  - Owner: everything, plus Waiting for cost, Returns and Write-offs.
- A tablet gets the same home in landscape. There are no device modes; the role decides.
- First-release scope: Pumps, Rentals, Close & Plan, Pickups, laundry Fleet, KDS and customer displays are parked. No shop uses them on the phone.

HOW THE APPS HAND OFF
- Procure receives a delivery: Inventory stock goes up, and the Ledger debits inventory (1051 ingredients, 1050 goods).
- Counter sells:
  - Inventory marks the tag SOLD, or takes the stock down. Cafe ingredients come off at Ready.
  - The Ledger books the sale and its cost of sale.
- Inventory counts and write-offs: the owner approves.
  - Shortages and theft are booked to 5060.
  - Damage and expiry are booked to 5070 Spoilage & Waste (journal.service.ts:1063-1067).
- Take-out (cafe): a record only, until rooms exist.
- No app writes journal entries itself. The API's accounting-event cron posts them every minute (accounting.scheduler.ts:42).

OFFLINE AND ONLINE
- The phone keeps a SQLite copy of its branch's codebook. It never holds costs.
  - Product barcodes and SKUs, with price and stock.
  - Tag numbers, with status and a "sellable" flag (costed, has a photo, IN_STOCK).
  - Ingredient barcodes, with pack size.
- It also keeps the saved cart and an outbox.
- Every action gets its id at the moment it happens. The id is saved with the outbox row in one transaction and replays until the server answers.
- Each outbox row belongs to the person who did the work and replays with that person's own session.
  - Today the server stamps the caller as the cashier (orders.controller.ts:253-254).
  - It refuses a CASHIER ringing on someone else's shift, and replays are not exempt (orders.service.ts:478-486).
  - Replaying under whoever is signed in now would mis-attribute the work or get it refused.
- The server never applies the same id twice:
  - sales, by Order.clientUuid (schema.prisma:1692);
  - stock moves, by the id stamped on the stock log;
  - ingredient receipts, by reference number (inventory.service.ts:1719-1721).
- A sale that already happened offline is never refused for a tag rule (already sold, retired, price changed, no cost or no photo). The sale is kept and the owner gets an alert. Only the live, online sale is refused.
- Works offline (Play app, from Phase 3/4):
  - selling, except engines, half-cuts and frame pieces;
  - tagging a part with labels already printed;
  - receiving, taking out, counting and roll call;
  - photos, which upload later.
- Needs a connection:
  - signing in, switching person, and opening a shift (POST /shifts; a cash sale needs a shiftId, orders.service.ts:286-297);
  - printing number labels (the numbers come from the server);
  - engine, half-cut and frame-piece sales;
  - returns, costing a tag and owner approvals;
  - in Phase 1, every tagged sale on the web till, because the web's offline cache holds no tags.

SCANNING AND PRINTING
- Scanning:
  - The phone camera uses Google ML Kit built into the app, so it works offline from the first install (node_modules/expo-camera/android/build.gradle:31).
  - Keyboard-style USB or Bluetooth scanners also work.
  - Every code is cleaned to one form before lookup. 8-, 12-, 13- and 14-digit retail codes are padded to GTIN-14. UPC-E is expanded to UPC-A first.
  - Shop-made numbers are 6 digits and are looked up as tags before SKUs.
- Printing:
  - Receipts print on a Bluetooth ESC/POS printer (exists).
  - Labels print on a Bluetooth TSPL label printer, through a new command builder on the same Bluetooth module.
  - The app keeps two printer slots, receipt and label. Today it stores one (BluetoothPrinterService.ts:37).
  - From a PC, the web prints labels through the browser's print dialog.

## The Play app: keep or rewrite

Reuse the project and rebuild the app inside it. No shop uses Counter (docs/OPERATIONS.md:65), so nobody is affected while it is rebuilt.

KEEP
- The Play identity and build setup:
  - the package id com.clerque.counter;
  - the EAS profiles and the expo-updates channels (app.json:67-71);
  - the play-store/ assets and scripts.
- src/api/client.ts: the base URL, typed errors and coalesced token refresh.
- The SecureStore token pattern, extended to hold one session per person who has unsent work.
- The money math in orderSubmit.ts (BIR PWD/SC/VAT) and the receiptAuthority mirror.
- The tendering, receipt, shift and Z-read screens.
- The pattern used to open the scanner and PIN sheets from anywhere.
- BluetoothPrinterService.printRaw (connect at :131, write at :181) and EscPosBuilder. A TSPL label builder goes next to them, and a second printer slot is added.
- The outbox idea: SQLite, Idempotency-Key = clientUuid, the X-Replayed-Offline header, and the network/transient/fatal classes.
- The theme tokens.
- PhoneSellScreen, the one till that matches both barcode and SKU (PhoneSellScreen.tsx:96-116). It becomes the base of the single sell screen.

REWRITE
- The shell: the switch on screen size, business type and device mode becomes home tiles from GET /me/home.
- Sign-in:
  - Add the 2FA step (auth.controller.ts:86, login/2fa at :105).
  - Add a logout that revokes the refresh token.
  - Replace the broken cashier PIN gate. Today it posts a cashier's own PIN to a supervisor-only route (auth.service.ts:1289). The replacement is the web's lock-and-switch: POST /auth/switch-cashier (auth.controller.ts:343-376), with PIN login for roles that cannot switch.
  - The supervisor PIN takes 4 to 6 digits and reads userId.
- The offline layer:
  - AsyncStorage blobs, capped at 6 MB, become SQLite tables.
  - Sign-out must never delete unsent sales, which today it does (AuthProvider.tsx:277).
  - Each row replays as its own person.
  - Every queued kind gets a handler.
  - A refused row is parked with the server's reason instead of retried forever.
  - A replay that finds its work already recorded counts as done.
- The scanner:
  - continuous mode;
  - only codes inside the on-screen window count;
  - the GTIN-14 cleanup;
  - a camera restart when reads stop.
- Printing:
  - One printer service with receipt and label slots. Z-read and the morning briefing never reach the printer today (printerService.ts:110-113).
  - Receipts carry the server's order number, not a hash (TenderingHost.tsx:235-245).

NEW
- Every inventory screen.
- Label printing.
- Tag photos kept offline until uploaded.

DELETE
- The four tablet terminals and their mock catalogs. Tablet Retail cannot find a product that has a SKU by its barcode (RetailTerminal.tsx:180).
- Tingi.
- The laundry Fleet mock and the claim-ticket button that does nothing.
- The fake Rx photo.
- The unrendered RefundVoidFlow. Returns are rebuilt as owner-only, by tag, using the supervisorPin contract the API now requires for voids and refunds.
- The dead void loader.
- Device modes, including the OWNER_SPOTCHECK clone of the till.
- RECORD_AUDIO, expo-print and the unused BLUETOOTH_SCAN.
  - The app only reads paired printers (BluetoothPrinterService.ts:115), so BLUETOOTH_SCAN is not needed.
  - The permission list is also duplicated (app.json:30-45).

PARK (not in the first release)
- KDS, customer display and pairing.
- Pumps, Rentals, Close & Plan, Pickups and Approvals.
- Shops run these on the web.

WHY
- The plumbing and the money math type-check and work, and the Play listing must keep its package id.
- Today's bugs all live in the shell and the offline layer:
  - every tablet gets the retail till;
  - 2FA users cannot sign in;
  - cashiers' own PINs fail;
  - unsent sales are wiped on sign-out;
  - receipts print a made-up number.
- There is no inventory code to keep.
- Most of the shell (8.1k lines) and terminal (4.6k lines) folders are replaced.

## Flows

### Tag and print (Parts shop (KJ's godfather). Later, any shop with one-of-a-kind items. Not medical-equipment rental shops, which use tags differently.)

1. The owner or a manager asks for, say, 100 labels: Print labels on the web from a PC (Phase 1) or on the Play app (Phase 4).
- The server hands out the next numbers (000501 to 000600) and logs who printed them.
- The phone prints 40x30 mm labels on the Bluetooth Xprinter: a QR code, the number in big digits and the shop name.
- The PC prints a Code 128 barcode with big digits.
- This step needs a connection.
2. The roll goes to the receiver.
3. The receiver opens Tag a part and scans the next label.
4. The receiver picks the product (type and grade, e.g. 'Headlamp LH Vios 2014-17 Grade A'), by search or by scanning its bin label.
5. For an engine, half-cut or frame piece, the receiver types the engine or chassis number and photographs the stamp. The accessory checklist goes in the notes.
6. The receiver takes the photos and saves.
- On the web in Phase 1 this needs a connection.
- In the Play app it works offline. The photos are kept in the app's own storage and upload after the tag row syncs.
7. The label goes on the part, or a tie-on label on heavy parts.
- The number is painted on the part in two places, plus the month's paint dab.
- Never put a label or paint near the engine or chassis stamp.
8. The owner opens Waiting for cost, checks the photos, and types each tag's cost or splits a lot's landed total over its tags.
- Only then can the part be sold.
- After costing, the photos are locked.
9. A spoiled label is reprinted only with a reason, and the reprint is logged.

**What updates:** When the tag is saved:
- Inventory: a tag row (SerializedUnit, IN_STOCK, the number, notes with the engine or chassis number).
- Inventory: the photos (Document, entityType 'SerializedUnit').
- Audit log: the label run, under the existing action SETTING_CHANGED with entityType 'TAG_LABEL_RUN'. A new audit action would be a migration (schema.prisma:369-401).

When the owner sets the cost:
- Inventory: product stock +1 and a stock-log line (InventoryLog STOCK_IN).
- An accounting event.
- Ledger: Dr 1050 Inventory. The credit depends on the lot (journal.service.ts:961-969):
  - 3010 Owner's Capital, for opening stock or a lot the owner paid for himself;
  - 1020 Bank, for a lot paid from the shop's bank;
  - not 1010 Cash on Hand, unless the drawer really paid that day.
- Counter: the tag becomes sellable.

### Receive by scan (Cafes such as Carolina: ingredients and packaged goods. Parts shop: bin parts and boxed new parts. Tagged parts use Tag and print instead.)

Cafe:
1. A delivery arrives. Staff open Receive and pick the open buy request, or start one.
2. Staff scan each pack. The app reads the barcode Clerque learned from past receipts, or one the owner taught it, and adds e.g. 'Emborg Full Cream Milk, 1 L x 1'. Scanning again adds another pack.
3. An unknown barcode asks the owner to teach it once: pick the ingredient and the pack size.
4. Staff photograph the supplier receipt and tap Mark bought.
- The phone sends the total packs per line, not +1 per scan, so a replay cannot double them.
- Staff never see prices.
5. Anne checks the price Clerque filled in and posts it to stock, as she does today.

Parts shop and packaged goods:
1. Scan the product or bin label.
2. Type how many and save. This works offline.
3. Valuation and books:
- Without a typed cost, today's stock-in values the stock at the product's catalog cost, not its last cost, and credits Owner's Capital by default (inventory.service.ts:1045, 1062-1066).
- So a staff receive is valued at catalog cost on Owner's Capital, and the owner can correct the cost.
- A delivery bought on a purchase order is received against that order instead, and the order carries how it was paid.

**What updates:** - Procure (cafe): the request lines and status (BOUGHT, then received) and the receipt photo.
- Inventory: ingredient stock and a lot (cafe), or product stock plus a stock-log line (products).
- Ledger:
  - Cafe: Dr 1051 Raw materials, plus input VAT for a VAT shop. Cr whichever paid: 1010 Cash, 1020 Bank, 1063 Advance deposits or 3010 Owner's Capital.
  - Products received by staff without a purchase order: Dr 1050 at catalog cost, Cr 3010 Owner's Capital.

### Stockroom to bar (Cafes (Carolina first). The parts shop's version, moving a tag between racks, stays owner-only.)

1. A barista takes milk from the stockroom, opens Take out and scans each carton (4 scans = 4 cartons). From: Stockroom. To: Bar. Send. This works offline.
2. Nothing else happens at the bar. Each drink still takes the milk off when Ready is tapped.
3. On Friday the owner sees, for each ingredient, what left the stockroom against what the recipes used. A big gap means waste, a wrong recipe or theft.
4. After the Phase 6 migration, the same scan moves the cartons from the Stockroom count to the Bar count, and each room is counted on its own.

**What updates:** Now:
- Inventory: a record only (who, what, when, from, to) in the audit log, under the existing action SETTING_CHANGED with entityType 'STOCK_TAKEOUT'.
- No stock change and no books. Recipes already deduct at Ready (tasks/carolina-go-live.md:9), so deducting again would double-count.

After Phase 6:
- Inventory: stock moves between two locations of one branch.
- Ledger: unchanged. The value stays in 1051.

### Sell by scan (Parts shop: tags and bins. Cafes: packaged goods; drinks are still tapped.)

Parts shop:
1. The cashier opens Sell and scans the part's label, or types the number.
2. The screen shows the intake photo, the product and the list price. The cashier checks them against the part.
3. A price below list needs the owner's PIN.
4. Some sales need a connection:
- an engine, half-cut or frame piece, which also needs the buyer's name and address;
- in Phase 1, every tagged sale on the web till.
5. Payment:
- cash, with an open shift, or
- the shop's business GCash/Maya QR, with the reference typed in. Personal wallets are refused.
6. For ₱500 or more, the cashier writes the BIR booklet invoice and types its number in.
7. The receipt prints the tag and engine numbers.
- In the Play app, it prints on the Bluetooth receipt printer.
- On a phone browser in Phase 1, Bluetooth printing works only where Chrome's Web Serial reaches the printer (apps/web/lib/pos/printer.ts:445). Otherwise the receipt is shown on screen and the booklet invoice is the paper.
8. A second person matches the painted number to the receipt at the gate.

Cafe:
1. Scan a bottled drink or packaged snack with the phone camera, or with a USB scanner on the web till, which already matches barcodes (terminal/page.tsx:150-175).
2. Tap drinks as usual.

**What updates:** - Counter: the order, its lines (with 'Tag 000457 / Engine No.' in the notes) and the payments.
- Inventory: the tag goes from IN_STOCK to SOLD, and product stock -1. Cafe ingredients come off at Ready.
  - Online, if two phones try, only one wins.
  - A replayed offline sale whose tag is already sold, retired or not sellable is kept, and the owner is alerted.
- Ledger, within about a minute:
  - Dr 1010 Cash or 1031 e-wallet; Cr 4010 Sales, plus 2020 output VAT for a VAT shop.
  - Dr 5010 Cost of sales, Cr 1050 at the tag's own cost (Cr 1051 at recipe cost for drinks).
- The owner's Telegram: a sale alert with the list price, the sold price and who approved any discount. No buyer name or address goes to Telegram.

### Count by scan (Parts shop: blind roll call of tags plus bin counts. Cafes: the weekly ingredient count.)

Parts shop:
1. The counter opens Roll call. The scope is all engines, half-cuts, frame pieces and the locked cabinet daily, or a zone the owner picks weekly.
2. The counter scans every label found, or types the number. The expected list is never shown.
3. Send. This works offline. Staff see only 'sent'.
4. For a bin, the counter scans the bin label and types the count. This is blind too, and records when it was counted.

Cafe:
1. Scanning a pack jumps to that ingredient's line.
2. The counter types the packs plus any loose amount. Blind.
3. The owner approves, as the weekly count works today.

**What updates:** Tags:
- The server compares the found numbers with the tags in stock at that branch at the time of the count.
- The 'missing' alert to the owner's Telegram waits until the branch's phones report an empty outbox, so a part sold offline before the count is not reported as stolen.
- The audit log keeps the roll call.
- The books do not change.

Bins:
- The difference is worked out against movements up to the count time.
- Sales are dated by the order's own time, not by when their stock line was written. Today sale stock lines carry the server's time at sync (orders.service.ts:950-962; InventoryLog.createdAt default now(), schema.prisma:1592).
- After the owner approves, an ADJUSTMENT with reason COUNT_CORRECTION is posted. A shortage books Dr 5060 Inventory write-off, Cr 1050; a surplus reverses it (journal.service.ts:964, 1066).

Cafe:
- As the weekly count does today (station-count.service.ts:24-27, 243-251).

### Return (Parts shop: owner-only returns by tag. Cafes: rare; they stay on the web as today.)

1. The customer brings the part and the receipt.
2. The owner opens Returns and scans the part's label.
3. If the tag is SOLD, the app shows the sale and the intake photos. The owner checks the painted number, the hidden number and the paint dab.
4. The owner refunds or exchanges with his PIN. This needs a connection.
5. If the tag was never sold, the return is refused and the owner gets an immediate alert: 'Tag 000457 returned but never sold: possible off-book sale', with when it was last seen in a roll call.

**What updates:** - Counter: a refund (or void) on the original order. The tag is found by its number and its soldOrderId, so a partial refund on a multi-tag order knows which tag came back.
- Inventory: that tag goes from SOLD back to IN_STOCK, and product stock +1.
- Ledger:
  - The sale is reversed: Dr 4010 Sales (and 2020 VAT), Cr 1010 Cash or 1031 e-wallet. The POS refund path debits 4010, not 4116 (journal.service.ts:688-692).
  - Its cost goes back to inventory at the tag's own cost: Dr 1050, Cr 5010.
- Telegram: an alert on a never-sold tag.

### Write-off (owner) (Parts shop: damaged, defective or lost tagged parts. Any shop: product write-offs.)

1. Staff report the problem.
2. The owner opens the tag, photographs the actual numbered part, picks a reason (damaged, defective, lost or stolen) and enters his PIN.
- His own approval is allowed, because he is the final authority, but it is logged as SELF_APPROVAL, an audit action that already exists.
3. The part goes into the locked scrap cage.

**What updates:** - Inventory: the tag goes to RETIRED, a status that already exists (schema.prisma:6295-6301), and stock -1.
- Ledger, at the tag's own cost, with the reason kept (journal.service.ts:1063-1067):
  - damaged or defective: Dr 5070 Spoilage & Waste, Cr 1050;
  - lost or stolen: Dr 5060 Inventory write-off, Cr 1050.
- Audit: the approver and the reason.

## Hardware

| For | Item | Price | Why |
|---|---|---|---|
| Parts shop: one unit, used from the owner's phone and from a PC on opening day | Xprinter XP-P323B portable label printer (Bluetooth + USB, 20-76 mm media) | ₱4,568-6,936 on Shopee (https://ph.biggo.com/s/xprinter+xp+p323b/) | It speaks TSPL, which is plain-text label commands, so the Play app can print over the Bluetooth module it already has, with no new library. It also has USB, so a laptop can print the opening-day rolls through the browser with the Windows driver.  Before paying, check three things: - it pairs as classic Bluetooth (SPP); - it answers a TSPL SIZE/PRINT test; - it can be switched to label (gap) mode and calibrated to 40x30 mm. Specs: https://www.xprintertech.com/portable-usb-receipt-printer-xp-p323b |
| Parts shop: parts under a roof, the locked cabinet, bins | Synthetic (topcoated polypropylene) direct-thermal labels, 40x30 mm, plus tie-on tag stock | Not found in this research; ask the printer seller | They resist water and grease better than paper, but the print still fades in sun and heat (https://shop.peaktech.com/products/labels-and-supplies/polypropylene-labels/zebra-direct_thermal-1). So the painted number stays the part's identity and the label is a convenience. |
| Cafes (repacked or house-made items, bins) and the parts shop's indoor bins | Plain 40x30 mm direct-thermal paper label rolls | ₱212-683 per roll (https://ph.biggo.com/s/phomemo+m110/, https://ph.biggo.com/s/niimbot+b1/; generic 40x30 rolls fit Xprinters) | Cheap, and stock turns over fast, so fading does not matter. Keep labels away from the espresso machine and steam, because heat darkens them. |
| Parts shop counter, once it sells from the Play app | 58 mm Bluetooth ESC/POS receipt printer (classic Bluetooth/SPP) | Not researched; check before buying | The theft plan relies on the customer getting a receipt with the tag number on it. Swapping the label printer's roll all day is not practical. Counter already prints ESC/POS receipts over Bluetooth. The app will keep a separate slot for the label printer, because today it remembers only one printer (BluetoothPrinterService.ts:37).  On a phone browser in Phase 1, printing to it depends on Chrome's Web Serial over Bluetooth, so test it on the shop's phone before relying on it. |
| Parts shop: one per person who sells or counts. Cafes: optional. | Shop-owned Android phones with an autofocus camera, cases and power banks | Not quoted | Camera scanning works offline with ML Kit built into the app (https://developers.google.com/ml-kit/vision/barcode-scanning/android).  If a phone is shared, every person still uses their own login. The phone locks with a PIN, and switching person needs a connection.  Test the cheapest phone against a printed label before buying more. |
| Carolina's web till for packaged goods; any PC till | USB 2D barcode scanner (an imager, not a 1D laser) | ₱1,100-3,200 on Shopee (https://ph.biggo.com/s/2d+barcode+scanner+usb/) | It types the code into the till's search box, which the web till already matches. It reads both QR and barcodes; a 1D laser scanner cannot read QR (https://kestronics.co.uk/blogs/blog-3/can-a-standard-barcode-scanner-read-qr-codes). |
| Cafes that repack or label house-made items in the stockroom | Xprinter XP-365B desktop label printer (optional) | ₱3,035-3,435 USB + Bluetooth on Shopee (https://ph.biggo.com/s/xprinter+xp-365b/) | Cheap, and sold as a label plus receipt printer. No official page confirms TSPL, so test SIZE/PRINT first. Not needed for packaged goods, which already carry barcodes. |
| Parts shop yard (engines, half-cuts and body panels outdoors) | Later, only if labels fade in the yard: Xprinter XP-TT426B thermal-transfer printer, resin ribbon, polyester labels or tie-on tags | Printer ₱8,200-14,399, or ₱20,238+ for the Bluetooth version (https://ph.biggo.com/s/xprinter+tt426b/). Resin ribbon 110 mm x 100 m about ₱650. Polyester labels from ₱822 a roll (https://ph.biggo.com/s/resin+ribbon+polyester+label/). | Zebra rates polyester thermal-transfer labels up to 3 years outdoors (https://www.zebra.com/us/en/resource-library/faq/what-are-thermal-labels.html), and resin ribbons resist motor oil and petrol (https://www.carl-valentin.de/it/nastri-termici/materials/resin-near-edge/). Buy it only after a month shows the cheaper labels failing, and check that the ribbon core matches the printer. |
| Parts shop | Matte label-protection tape (e.g. 3M Scotch 821), optional | Not quoted | Glossy tape glares and can stop a scan (https://www.3m.com/3M/en_US/p/d/b40068365/). |
| Everyone | Do not buy: Niimbot or Phomemo label printers | ₱1,046-2,688 (cheap, but a dead end) | They have no official SDK, their protocols are reverse-engineered, and they work over Bluetooth Low Energy only. Niimbot also needs its own chipped rolls (https://www.newegg.com/niimbot-b1-printer/p/36J-00WU-00082). Supporting them would need a new Bluetooth library, and that library has an open Expo SDK 56 issue (https://github.com/dotintent/react-native-ble-plx/issues/1339). |

## Phases

### Phase 1: The parts shop sells by tag (API + web, no migration)

The godfather's shop tags every part with a printed number label and sells each one only once, only by its number, at its own cost, online, from an Android phone browser.

The new rules fire only on products that carry tags, and not at medical-equipment rental shops. So Carolina's till, and any rental shop, runs the same path as today.

- [api, medium, no database change] Tag intake route, replacing today's bare add:
- Real validation: cost not negative, number digits only, and the branch must belong to the shop.
- Open to CASHIER and WAREHOUSE_STAFF as well as managers and owners (decision A). Today only BRANCH_MANAGER and BUSINESS_OWNER may add tags.
- ENG-, HC- and FRM- products need the engine or chassis number, written once into the notes. There is no edit route.
- The owner sets each tag's cost once, through a new owner-only route that works only while the cost is blank and only once the tag has a photo.
  - Costing books 1 unit into stock as STOCK_IN and skips the ±50% guard.
  - Payment is OWNER_FUNDED, BANK or OPENING_BALANCE. The journal already handles BANK; the adjust DTO allows only CASH and OWNER_FUNDED. CREDIT stays out, because it needs a vendor bill.
- The tag list hides cost from staff. Non-owners look up one exact number instead of browsing the list.  _Evidence: apps/api/src/rentals/rentals.controller.ts:24, 34 (POST is BRANCH_MANAGER/BUSINESS_OWNER only); rentals.service.ts:74-101 (writes only the tag row; no branch check; no stock or books); apps/api/src/inventory/dto/adjust-stock.dto.ts (paymentMethod CASH|OWNER_FUNDED); apps/api/src/accounting/journal.service.ts:961-969 (OPENING_BALANCE→3010, BANK→1020, CASH→1010); inventory.service.ts:953-968 (±50% guard); tasks/surplus-autoparts-plan.md:303-311_
- [api, medium, no database change] Number labels instead of tag books:
- The owner or manager reserves the next N 6-digit numbers, starting after the highest 6-digit number ever used or printed by this shop. A Postgres advisory lock stops two people getting the same numbers.
- Each run (who, from, to, when) is recorded in the audit log with the existing action SETTING_CHANGED and entityType 'TAG_LABEL_RUN'.
- A reprint needs a reason and is logged.
- At a shop that uses label runs, a tag can only be created with a printed, unused number.  _Evidence: A new number sequence would be a migration (SequenceType enum, schema.prisma:3851-3874). AuditLog.action is an enum with no tag value (schema.prisma:369-401, 834), so a new action would be a migration; entityType is free text. shifts.service.ts:474-478 records the same way. Tag numbers are unique per shop (schema.prisma:6329)._
- [api, small, no database change] Tag photos with no new table:
- Saved as Documents with entityType 'SerializedUnit'.
- Only intake roles may upload them, and only before the tag is costed. After costing they are locked, and only the owner may add or delete one.
- The live sale refuses a tag with no photo.
- WAREHOUSE_STAFF may upload, for this entity type only.
- Before go-live, confirm production stores uploads in R2/S3. Without the S3 settings the server falls back to Postgres BYTEA, and thousands of part photos would bloat the database.  _Evidence: schema.prisma:4029-4053 (entityType free text, no client id); apps/api/src/documents/documents.controller.ts:38-45 (CASHIER and others may upload to any entity; WAREHOUSE_STAFF may not); apps/api/src/storage/storage.service.ts:8-14, 98-126 (driver chosen at boot; DB fallback); docs/ARCHITECTURE.md:46 (R2 intended)_
- [api, large, no database change] The sell-by-tag lock, inside the sale save:
- The cart line carries the tag's id.
- One conditional update moves the tag from IN_STOCK to SOLD and sets soldOrderId. Unless exactly one row changes, a live sale fails.
- Quantity must be 1.
- A plain line for a product that has tags is refused, except at MEDICAL_EQUIPMENT shops, which rent their tags.
- On a live sale, a tag with no cost, no photo or a below-list price outside the PIN-gated discount is refused.
- On a replayed offline sale (X-Replayed-Offline), the same problems, or a tag already SOLD or RETIRED, keep the sale and raise an owner alert instead.
- The tag's own cost becomes the cost of sale, first in the cost waterfall.
- A void or refund puts that same tag back to IN_STOCK, found by the order and the tag number.  _Evidence: schema.prisma:6303-6333 (status and soldOrderId exist; nothing sets them); rentals.service.ts:120-132 (rentals use the same tags, and check-then-write, which should not be copied); apps/api/src/orders/orders.service.ts:749-781 (line write), :1578-1598 (cost waterfall, no tag cost today), :1768+ (void), :2122+ (refund), :2361-2402 (bulkSync); orders.controller.ts:208-257 (X-Replayed-Offline); tasks/surplus-autoparts-plan.md:313-328_
- [api, medium, no database change] Paperwork rules on tagged sales:
- Engines, half-cuts and frame pieces need the buyer's name and address.
- Personal GCash/Maya is refused, and GCash, Maya and QR Ph lines need a reference number.
- A sale of ₱500 or more needs the BIR booklet invoice number while Clerque prints an Acknowledgement Receipt.
- The server writes 'Tag 000457 / Engine No. ...' into the line notes, so the receipt and the Telegram alert print it.
- The alert shows the list price, the sold price and who approved any discount. It never shows the buyer's name or address.  _Evidence: schema.prisma:227-237 (personal wallets), :1691 (Order.notes), :1708-1712 (buyer), :1806 (OrderItem.notes), :1923 (reference optional); packages/shared-types/src/tenant.ts:304-337 (receiptAuthority); apps/api/src/telegram/telegram-alerts.service.ts:36 (sale alert)_
- [api, small, no database change] One 'what is this code?' lookup that takes any code and a branch:
- Clean the code first: 8-, 12-, 13- and 14-digit codes become GTIN-14, and UPC-E is expanded first.
- A 6-digit number is checked as a tag before SKUs.
- Then products, by barcode or SKU, with stored values compared in cleaned form.
- Tags, by number: status, photo, product and price; never cost for staff.
- Ingredients, by a remembered barcode.
- The result also says what this person may do with it.  _Evidence: apps/api/src/products/products.service.ts:667-678 (barcode only, findFirst); products.controller.ts:94-99; schema.prisma:5962-5991 (ReceiptAlias); apps/api/src/procure/receipt-parser.ts:203-219 (8-14 digits stored as printed)_
- [web, medium, no database change] An Inventory card and /inventory pages, gated by role the way Procure is (no AppCode, no module flag):
- Tags: the owner's list with cost; staff look up one exact number.
- Waiting for cost, with the photos shown.
- Print labels.
- Stock on hand (re-exported).
The launcher has no shop type today, so in Phase 1 the card goes only to owners and managers, plus stock staff at shops that have run labels. Carolina's owner sees the card, but nothing on her till changes.
Also fix the tag cost shown 100 times too large.  _Evidence: apps/web/lib/apps.ts:17, 131-176 (accessibleApps takes no businessType), 179-186; apps/web/lib/app-roles.ts:28-59; apps/web/middleware.ts:179-187, 210 (an unlisted path has no role gate); apps/web/app/procure/layout.tsx:34-53; apps/web/app/pos/(pos)/serialized-units/page.tsx:170_
- [web, medium, no database change] Phone till:
- Show the retail cart and the Charge button below 1024 px, reusing the food-and-drink till's floating cart.
- A 'type or scan the tag number' box shows the photo, product and price.
  - Scanning means a Bluetooth keyboard-style scanner.
  - Chrome's built-in BarcodeDetector may work as a camera option, but only after feature detection on the shop's phone.
- Tagged lines cannot be queued offline, because the web's offline cache has no tags.
- Prompts for the buyer's details and the booklet number.  _Evidence: apps/web/app/pos/(pos)/terminal/RetailTerminal.tsx:309 (cart rail 'hidden lg:flex'); terminal/page.tsx:371-408 (saveOffline queues any sale), 524-547, 617-652; apps/web/components/pos/PaymentModal.tsx:91-93, 260-262; https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API_
- [web, small, no database change] A label print page for a PC with a USB label printer:
- 40x30 mm through @page.
- The number in big digits plus a Code 128 barcode, digits only, about 33 mm wide at 0.375 mm bars.
- The barcode is drawn as SVG by about 60-100 lines of our own code. No new library.  _Evidence: No barcode code in apps/web/lib/pos/printer.ts; https://voussoir.net/writing/css_for_printing; WebUSB on Windows does not work for shops (https://zadig.akeo.ie/)_
- [shop, small, no database change] Setup, following the surplus plan:
- Settings: owner-only returns ON, staff purchase costs OFF, selling when out of stock OFF.
- Every person gets their own CASHIER login. The owner holds the only supervisor PIN and links his Telegram.
- Buy one XP-P323B, test it, and print the opening-day labels from a laptop.
- Tag everything at or above the ₱500 line.
- Test whether the shop's phone can print a receipt from Chrome (Web Serial over Bluetooth). If not, Phase 1 receipts are on-screen plus the booklet.  _Evidence: tasks/surplus-autoparts-plan.md:330-350; apps/web/lib/pos/printer.ts:4, 445 (Web Serial, else window.print)_

**Done when:** All of these are true:
- On an Android phone browser, tag 000457 sells once. A second sale of 000457 from another phone is refused.
- The receipt (on screen or printed) and the owner's Telegram both show 'Tag 000457'.
- The sale's cost of sale in the Ledger equals that tag's own cost.
- A refund puts 000457 back in stock.
- A plain sale at a medical-equipment test shop and at Carolina's test shop behaves as before.
- The normal API test gate passes once.

### Phase 2: The API is ready for phones (no migration)

Everything a phone needs to work offline and scan safely:
- the home-screen answer;
- an offline codebook;
- stock moves that cannot double up;
- counts that respect late-synced sales;
- take-outs and write-offs.
Every route is new and additive; existing web screens do not change.

- [api, small, no database change] GET /me/home, open to every role, returns:
- the shop type, read from the tenant;
- the vertical pack;
- the apps and tiles this person may open;
- the branches.
The POS, Ledger and Procure role sets move from apps/web/lib/app-roles.ts into packages/shared-types, with INVENTORY_ROLES added. The web re-exports them, so its behaviour does not change.  _Evidence: apps/api/src/auth/auth.service.ts:723 (no businessType in the token); apps/counter/src/auth/AuthProvider.tsx:53; app-roles.ts:18-19, 54-59; tenant.controller.ts:61-65 (/tenant/profile refuses warehouse staff)_
- [api, medium, no database change] A codebook feed that sends what changed since the phone's last pull:
- It merges the updatedAt of Product, InventoryItem (where stock lives), SerializedUnit and ReceiptAlias.
- It includes deactivated rows, so the phone can drop them.
- It also offers a full refresh, used weekly or when a delta looks wrong.
- Contents: product barcodes and SKUs with price and stock; tag numbers with status and a 'sellable' flag; ingredient barcodes with pack size.
- Never costs.  _Evidence: schema.prisma:1484-1508 (InventoryItem.quantity, updatedAt), 1252-1280 (Product.isActive, updatedAt), 6320, 5982; Counter's AsyncStorage cache is capped at 6 MB (node_modules/@react-native-async-storage/async-storage/android/config.gradle:85)_
- [api, medium, no database change] Stock moves that cannot double up:
- /inventory/adjust and the new tag, count and take-out routes accept a clientEventId (add it to AdjustStockDto).
- It is stored on the stock log as referenceId 'dev:<id>' and checked under an advisory lock in the same transaction.
- Ingredient receipts use the reference number 'SCAN-<id>', which already blocks duplicates permanently.
- Photo uploads carry the client id in the filename and are skipped if already stored.  _Evidence: inventory.service.ts:1020-1032 (log written without referenceId), :1719-1721 (reference duplicate block); apps/api/src/inventory/dto/adjust-stock.dto.ts:36-118 (no client id field); idempotency.interceptor.ts:42 (24-hour cache); schema.prisma:1579-1599, 4029-4053_
- [api, small, no database change] Refuse duplicate barcodes and SKUs when a product is saved, comparing the cleaned GTIN-14 form. Give the owner a list of the duplicates that exist today.  _Evidence: schema.prisma:1242-1245 (comment says unique), :1305-1306 (index only); apps/api/src/products/dto/create-product.dto.ts:61-70_
- [api, medium, no database change] Blind roll call and blind count:
- Staff send the tag numbers or bin counts they found, with the time of the count. Staff see only 'sent'.
- Expected stock at the count time dates sales by Order.paidAt or completedAt, not by when their stock line was written.
- The owner's 'missing tags' alert and count approval wait until every phone in the branch reports an empty outbox, or 24 hours pass.
- On approval, a bin difference posts COUNT_CORRECTION (a shortage books 5060).  _Evidence: orders.service.ts:950-962 (sale stock line has no device time); schema.prisma:1592 (createdAt default now()); orders.service.ts:709-738 (paidAt from the device); station-count.service.ts:24-27, 243-251; journal.service.ts:964, 1066_
- [api, medium, no database change] An owner-only tag write-off:
- A photo is required, and the tag moves to RETIRED.
- Damage books to 5070; loss or theft to 5060; the reason is kept.
Fix product write-offs:
- keep the reason and the approver;
- value them at average cost, not catalog cost;
- check the PIN with lock-out;
- refuse staff self-approval; an owner's own approval is allowed and logged as SELF_APPROVAL.  _Evidence: schema.prisma:6295-6301, 400 (SELF_APPROVAL exists); inventory.service.ts:911-937 (PIN loop, no lock-out), :1040-1045 (catalog cost used); journal.service.ts:1063-1067; orders.service.ts:2428-2471 (PIN with lock-out to reuse)_
- [api, small, no database change] A take-out record (stockroom to bar, cafes):
- It records who took what, from where, to where and when, in the audit log (SETTING_CHANGED, entityType 'STOCK_TAKEOUT').
- No stock change and no books.
- A weekly 'taken out vs used by recipes' list per ingredient.
- Open to cafe staff roles (CASHIER, GENERAL_EMPLOYEE, WAREHOUSE_STAFF).  _Evidence: schema.prisma:369-401 (AuditAction enum), 831-851; no stock location in schema.prisma (tasks/todo.md:332-336; the tick at tasks/procure.md:82-87 is stale); tasks/carolina-go-live.md:9_
- [api, small, no database change] Teach a barcode to an ingredient (owner, manager or MDM). It writes the same ReceiptAlias row ('bc:<code>' plus pack size) that the receipt reader already learns from, with the code in cleaned form.  _Evidence: schema.prisma:5962-5991 (unique per shop at :5987); apps/api/src/procure/procure-receipts.service.ts:297-361_
- [api, small, no database change] Device clocks:
- A sale or stock move dated ahead of the server's clock is set to the server's time.
- One that syncs more than a day late is listed in the owner's daily summary.
- Nothing is refused, except by the existing closed-period lock.  _Evidence: orders.service.ts:314 (period lock on device time), 709-738, 1515_
- [api, small, no database change] Widen access for stock staff:
- WAREHOUSE_STAFF may look up tags (never cost) and run roll calls.
- At parts shops, CASHIER may run roll calls and tag intake (decision A).  _Evidence: apps/api/src/rentals/rentals.controller.ts:24, 34; inventory.controller.ts:225-232_
- [web, small, no database change] Roll call, bin count and write-off screens in web Inventory, using typed numbers or a USB 2D scanner. The parts shop can then count before the Play app is ready.  _Evidence: apps/web/app/pos/(pos)/terminal/RetailTerminal.tsx:84-86, 139-144 (keyboard scanners type into search)_

**Done when:** All of these are true:
- The same stock-in replayed 3 times, two days apart, raises stock once.
- /me/home returns the right tiles for an owner, a cashier and a warehouse staff member, at a retail test shop and at a coffee-shop test shop.
- A roll call missing one tag reaches the owner's Telegram, and a tag sold offline before the roll call is not reported as missing.
- No web screen outside /inventory has changed.

### Phase 3: One Play app: sign in, home by role, sell offline (mobile, no migration)

Rebuild apps/counter into 'Clerque':
- The server decides the tiles.
- A cashier at any shop gets one till that sells online and offline, with a camera scanner, and prints the real receipt number.
- Offline work replays as the person who did it.
KJ can install an internal APK. The store waits for Phase 4.

- [mobile, medium, no database change] Platform first:
- Try the Expo SDK upgrade from 54, time-boxed to 2 days. If the Bluetooth module fails under the New Architecture, stay on SDK 54, which meets Play's API 36 rule today, and redo the upgrade before the 2027-02-01 16 KB rule. The camera frame-stall fix is not in a stable SDK yet, so the watchdog stays either way.
- Turn off RECORD_AUDIO (recordAudioAndroid: false).
- Remove BLUETOOTH_SCAN and the duplicated permission entries.
- Remove expo-print and declare expo-constants.
- Install expo-dev-client, or turn off developmentClient.
- Add a Counter type-check to CI.
- Rename the display name to 'Clerque'; keep the package id.
- Confirm the EAS owner: app.json says clerque-app, while KJ's account notes list Clerque under hindiakokj1, whose 30-builds-a-month quota has run out before.  _Evidence: apps/counter/app.json:3-6, 23-24, 30-45, 53; eas.json:8; package.json:27-42; BluetoothPrinterService.ts:72-73, 115 (reads paired devices only); https://docs.expo.dev/versions/latest/ (latest stable SDK 57); https://github.com/expo/expo/releases/tag/expo-camera%4058.0.9; https://developer.android.com/guide/practices/page-sizes (2027-02-01)_
- [mobile, large, no database change] Sign-in and the shared phone:
- Password or PIN sign-in, the 2FA step, and a logout that revokes the refresh token.
- Shop type and tiles come from /me/home.
- The broken cashier PIN gate becomes a lock-and-switch screen using POST /auth/switch-cashier. Anyone can unlock their own session; the switch target may only be CASHIER or SALES_LEAD. Other roles switch with PIN login. Auto-lock after a few idle minutes.
- A small session vault in SecureStore keeps each person's refresh token while they have unsent work, so each outbox row replays as that person.
- Full sign-out is refused while that person has unsent work, unless the owner overrides.
- Switching person needs a connection.
- The supervisor PIN takes 4 to 6 digits and reads userId.  _Evidence: AuthProvider.tsx:53, 243-250, 277, 317-326; apps/api/src/auth/auth.controller.ts:86, 105, 294-376; auth.service.ts:36 (7-day refresh), 656-659 (switch targets), 1275, 1289, 1338; orders.controller.ts:253-254 (bulkSync uses the caller as cashier); orders.service.ts:478-486 (NOT_YOUR_SHIFT, no replay exemption); CashierPinScreen.tsx:30; SupervisorPinModal.tsx:47_
- [mobile, medium, no database change] Shell:
- One home screen with tiles from /me/home: Sell, Tag a part, Receive, Take out, Count, Print labels, and the owner-only Waiting for cost, Returns and Write-offs.
- Phone and tablet share it.
- Device modes are removed.
- KDS, customer displays, Pumps, Rentals, Close & Plan, Pickups and Approvals are parked out of the first release.  _Evidence: apps/counter/src/shell/RootNavigator.tsx:98-109; AppDrawer.tsx:62-77, 163-164; shell/PhoneTabNavigator.tsx:103-104; device-mode/DeviceMode.tsx:94-96; terminal/TerminalRouter.tsx:49, 97-104_
- [mobile, large, no database change] Offline store in SQLite:
- Tables: the codebook keyed by the cleaned code, a stock snapshot, the saved cart, and a typed outbox (sale, tag, stock-in, take-out, count, roll call, photo).
- Outbox rows carry dependencies: a photo waits for its tag's server id, and a sale waits for its tag and photo.
- WAL mode, and one exclusive transaction for each local change plus its outbox row.
- A crypto UUID made at the moment of the action (new dependency: expo-crypto).
- Each row stores its person.
- Every kind has a handler.
- A business refusal is parked with the server's reason. An 'already recorded' answer counts as done.
- Photos are copied out of the camera cache, which Android may clear, into app storage or SQLite until uploaded, then deleted.
- Synced rows are deleted, so buyer names and addresses do not stay on the phone.  _Evidence: apps/counter/src/offline/db.ts:23-33, 92-95; SyncProvider.tsx:57-106; PendingSyncScreen.tsx:61; api/uuid.ts:7-13 (Math.random); api/queries.ts:123-190; apps/web/lib/pos/sync.ts:4, 58-117; procure.service.ts:911-990 ('bought' refuses staff a second go at a line); https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/_
- [mobile, large, no database change] One sell screen, built on PhoneSellScreen:
- Tap or scan to add. Modifiers come from the catalog.
- Tag lines show the photo; quantity is 1; only tags flagged sellable can be added offline.
- Discounts need a supervisor PIN. A cashier's manual discount without an authorizer gets 403 today.
- Keep the tendering screens and the money math in orderSubmit.ts.
- Engines, half-cuts and frame pieces are refused offline. Prompts for the buyer and the booklet number.
- Opening a shift needs a connection; the app warns before going offline without one.
- Receipts print the server's order number. Offline, they print a clearly marked local reference and can be reprinted after sync.
- One printer service everywhere.
- Delete the four tablet terminals and their mocks, tingi, the Fleet mock, the fake Rx photo and the dead void loader.  _Evidence: apps/counter/src/shell/phone/PhoneSellScreen.tsx:96-116; RetailTerminal.tsx:29, 43-50, 119-121, 151-161, 180; FBTerminal.tsx:184-196; payment/TenderingHost.tsx:235-245; receipt/printerService.ts:110-113; apps/api/src/orders/orders.service.ts:286-297 (cash needs a shift), 2551 (order number format)_
- [mobile, medium, no database change] Scanner, keeping expo-camera:
- Continuous mode: a repeat of the same code within 1.5 s is ignored, each read beeps and buzzes, and a running list builds up.
- Only codes inside the on-screen window count, filtered by corner points.
- The camera restarts after a few seconds with no read.
- Codes are cleaned to GTIN-14, with UPC-E expanded.
- Keyboard-style scanners work on every scan screen.
- Never use launchScanner().  _Evidence: apps/counter/src/components/BarcodeScannerSheet.tsx:93-101, 154-164, 179, 201-212; node_modules/expo-camera/android BarcodeAnalyzer.kt:34, 43-67, 73; https://developers.google.com/ml-kit/vision/barcode-scanning/android_
- [mobile, small, no database change] Card payments go out the way KJ decides (see decisions), so Counter and the web book cards the same way and every card sale can be settled.  _Evidence: apps/counter/src/api/orderSubmit.ts:84 (CARD); apps/web/components/pos/PaymentModal.tsx:69 (QR_PH); apps/api/src/settlement/settlement.service.ts:104, 343_

**Done when:** On KJ's phone (internal APK from the EAS preview profile):
- A cashier at a retail test shop and a cashier at a coffee-shop test shop each see their own till.
- Cashier A opens a shift online, goes into airplane mode, rings 3 sales and force-closes the app. The app reopens offline with the 3 sales still queued.
- Back online, the phone locks and Cashier B unlocks with a PIN while A's sales are still unsent.
- The server ends with exactly 3 orders, none twice, all under Cashier A, and the receipts reprint with ORD numbers.

### Phase 4: Scan, tag, print and count from the phone (parts shop), then the first store release

Stock staff and the owner do the parts shop's daily work in the Play app:
- print number labels on the Bluetooth label printer;
- tag parts with photos;
- sell by scan;
- roll call, write-offs and returns.
KJ then builds and submits.

- [mobile, medium, no database change] A TSPL label builder next to EscPosBuilder (SIZE, GAP, CLS, QRCODE at level H, TEXT, PRINT), sent through printRaw.
- Printer settings get two slots, Receipt and Label.
- Two layouts: the tag label (QR, the number in big digits and the shop name) and the bin or product label (name, price and code).
- Printing needs a connection, because the numbers come from a server label run.  _Evidence: apps/counter/src/receipt/EscPosBuilder.ts:44-110 (no barcode, QR or label commands); BluetoothPrinterService.ts:37 (one paired id), 131, 165-200 (printRaw); TSPL manual https://fs.tscprinters.com/system/files/31-0000001-00_tspl_tspl2_programming_3_0.pdf_
- [mobile, medium, no database change] Tag a part:
- Scan the label, pick the product, type the engine or chassis number when needed, take the photos (queued offline), save.
- The owner's 'Waiting for cost' list, with the photos.  _Evidence: tasks/surplus-autoparts-plan.md:104-117_
- [mobile, medium, no database change] Roll call and bin count with continuous scanning.
Owner-only write-off with a photo.
Owner-only returns by tag:
- They use the supervisorPin contract that voids and refunds now require.
- A tag that was never sold is refused and alerts the owner.  _Evidence: tasks/surplus-autoparts-plan.md:46, 211-218, 240; orders.service.ts:1768+, 2122+_
- [mobile, small, no database change] Receive by scan for bin products and packaged goods:
- Scan, type the quantity, save (a stock-in with a clientEventId).
- Valued at catalog cost on Owner's Capital unless the owner types a cost. Deliveries bought on a purchase order are received against that order.  _Evidence: apps/api/src/inventory/inventory.controller.ts:225-232; inventory.service.ts:1045, 1062-1066; purchase-orders.controller.ts:67-80_
- [mobile, medium, no database change] Store preparation, stopping before the store:
- Bump the version and write listing text that says 'Clerque', for every shop, claiming only features that exist.
- Rewrite play-store/privacy-policy.md:
  - Today it says no camera image leaves the device and no microphone is requested. Tag photos will now be uploaded, and RECORD_AUDIO is currently requested.
  - Fill in the missing postal address.
- Data-safety answers: photos, buyer name and address, and staff account data, collected and stored on Clerque's servers and encrypted in transit.
- Permission reasons: camera for scanning and part photos, Bluetooth for printers, no microphone, no location.
- New screenshots from scripts/build-screenshots.js.
- Check 16 KB page alignment on the built AAB.
- Check whether the listing already has production access. A personal developer account created after 13 Nov 2023 needs a 12-tester, 14-day closed test first.
KJ runs eas build and uploads the AAB in Play Console himself.  _Evidence: apps/counter/play-store/privacy-policy.md:21-30, 140; apps/counter/README.md:115-141; eas.json:25-27, 35-36; https://support.google.com/googleplay/android-developer/answer/14151465_
- [shop, small, no database change] Test the printer:
- It pairs as classic Bluetooth (SPP).
- It prints a TSPL SIZE/PRINT test in label mode.
- Print 20 labels from a phone.
- Test-scan a QR label and a Code 128 label with the cheapest shop phone.
- Then choose the label stock.  _Evidence: https://ph.biggo.com/s/xprinter+xp+p323b/_

**Done when:** With the real printer, at the shop or on a test shop:
- Staff print 20 labels from a phone while online, then tag 20 parts with photos while offline. All 20 sync with their photos once back online.
- The owner costs them.
- 5 are sold by scan.
- A part hidden on purpose shows as missing in the owner's Telegram roll call.
- The privacy policy and data-safety answers match what the app does.
- KJ holds a signed AAB ready to upload.

### Phase 5: Cafe flows, after Carolina's go-live week

Carolina and the next cafes scan where it saves work:
- packaged goods sold by scan;
- deliveries recorded by scan;
- stock leaving the stockroom recorded by scan;
- the weekly count by scan.
Old screens stay where they are; moved screens keep redirects.

- [shop, small, no database change] No code needed:
- Fill in barcodes on the packaged products.
- Plug a USB 2D scanner into the web till, which already matches barcodes.
This touches no screen, so it can be done any time.  _Evidence: apps/web/app/pos/(pos)/terminal/page.tsx:150-175_
- [web, small, no database change] An owner page for teaching barcodes:
- Scan or type a pack's barcode, then pick the ingredient and pack size.
- See the barcodes Clerque already learned from receipts.  _Evidence: The Phase 2 teach route; schema.prisma:5962-5991_
- [web, medium, no database change] Turn on the Inventory card for cafe staff, reading the shop type from the API (/me/home). Move Stock on hand, the weekly count and cycle counts under /inventory, and keep the old /pos and /procure addresses as redirects.  _Evidence: apps/web/app/procure/stock/page.tsx, transfers/page.tsx and cycle-counts/page.tsx re-export POS pages; apps/web/app/pos/(pos)/inventory/page.tsx:432-449; apps/web/lib/apps.ts:131-134_
- [mobile, medium, no database change] Receive by scan into Procure:
- Open or pick a request.
- Scan the packs. Each barcode becomes ingredient x pack size; an unknown one asks the owner to teach it.
- Lines are sent as totals.
- Photo of the receipt, then Mark bought.
- Anne still posts to stock, as today. Staff see no prices.  _Evidence: apps/api/src/procure/procure.controller.ts:59-60, 205-206, 255-258, 278-279 (staff roles), 295-297 (receive: owner, manager or MDM); procure.service.ts:494-531 (addLine sets an absolute quantity), 896-990 (staff record packs without price)_
- [mobile, small, no database change] Two more screens:
- Take out of the stockroom by scan. It stays a record only until rooms exist.
- The weekly count by scan: a scan jumps to that ingredient's line, the counter types packs and any loose amount, it stays blind, and the owner approves as today.  _Evidence: apps/api/src/procure/station-count.controller.ts:31-99; station-count.service.ts:24-27_
- [mobile, small, no database change] These screens are JavaScript only, with no new native module, so they can reach installed phones as an over-the-air update on the production channel, for the same app version.  _Evidence: apps/counter/app.json:67-71 (runtimeVersion policy appVersion plus the updates URL); eas.json channels_

**Done when:** At Carolina:
- A milk delivery is recorded by scanning 12 cartons, and Anne posts it.
- A barista takes 4 cartons to the bar by scan.
- Friday's list shows milk taken out against milk used by recipes.
- A bottled drink sells by scan on the web till.

### Phase 6: One migration branch (waits for KJ's word)

The changes that need new database columns, on one branch with one PR. It waits until Carolina is stable and the godfather has answered the costing and dealer questions.

- [api, large, DATABASE CHANGE: branch + KJ's word] Rooms inside a shop: stock locations (stockroom, bar, kitchen, yard, cabinet), with stock per location for both ingredients and products. A take-out becomes a real move. It posts no books, the same way a branch transfer posts none.  _Evidence: schema.prisma has no StockLocation (tasks/todo.md:332-336; the tick at tasks/procure.md:82-87 is stale)_
- [api, medium, DATABASE CHANGE: branch + KJ's word] Barcodes:
- Several barcodes per product and per size variant (case vs piece, old vs new pack).
- A unique (shop, cleaned code) index.
- A proper barcode link for ingredients, beyond receipts.  _Evidence: schema.prisma:1305-1306 (index only), :1336-1351 (variants have no barcode), :1372-1397 (ingredients have no barcode)_
- [api, small, DATABASE CHANGE: branch + KJ's word] Unique client event id columns on the stock log and on Document. They replace the app-level checks from Phase 2.  _Evidence: schema.prisma:1579-1599, 4029-4053_
- [api, large, DATABASE CHANGE: branch + KJ's word] The surplus plan's Phase 3 set:
- Tag fields: asking and floor price, kind, engine and chassis number, zone, lot, parent.
- Statuses: AWAITING_PRICE, HELD, DISMANTLED, SCRAP, OUT_ON_TEST.
- OrderItem.serializedUnitId.
- Lots.
- Stored roll calls.
- AuditAction values for label runs, take-outs and tag events.
- An AUTO_PARTS business type.
- A TAG number sequence.  _Evidence: tasks/surplus-autoparts-plan.md:392-422; schema.prisma:68-88, 369-401, 3851-3874, 6295-6333_
- [api, small, DATABASE CHANGE: branch + KJ's word] Inventory as its own AppCode, plus a Tenant module flag. Only when Inventory is sold separately.  _Evidence: schema.prisma:49-53, 507-509_

**Done when:** KJ says yes, and the branch's migration applies cleanly on a copy of production. The app-level checks from Phases 1 and 2 then read the new columns, with no change on screen.

## Risks

- Carolina's sales go through the same sale code the tag lock changes (orders.service.ts), so a mistake there reaches her till. The tag rules fire only for products and lines with tags. Run the normal API test gate once before pushing, and push outside her busy hours.
- Two offline phones can sell the same ordinary tag. That is caught only after sync, as a 'tag sold twice' alert. That is why engines, half-cuts and frame pieces sell only online, and why every tagged sale on the web till in Phase 1 is online-only.
- Direct-thermal labels fade in sun and heat, and adhesive fails on greasy metal. The painted number stays the identity, and heavy parts get tie-on labels. Never put a label or paint near an engine or chassis stamp: altering them is a crime under RA 10883 (https://lawphil.net/statutes/repacts/ra2016/ra_10883_2016.html).
- The Bluetooth printer library is a stale release candidate (1.73.0-rc.17), Classic only and written for the old architecture. An Expo SDK upgrade, which brings the New Architecture only, may break it. The fallback is to stay on SDK 54 for now, or write a small in-repo Bluetooth serial module.
- Cheap phones may scan slowly. Test the cheapest phone with real labels before buying more.
- Until Phase 6, protection against a doubled stock move is an app-level check (an advisory lock plus a referenceId lookup), not a database rule. InventoryLog.referenceId has no index, which is fine for one shop and slower later.
- Barcode mismatches: Android reads UPC-A as 12 digits, while receipts store codes like 04806503950622 (schema.prisma:5955-5956). Every code must be cleaned the same way everywhere, or scans silently miss. Until the save check and the owner's cleanup land, duplicate barcodes in today's catalog mean the first match wins.
- A take-out that also took stock off would double-count Carolina's ingredients, because recipes already deduct at Ready. Take-out must stay a record only until rooms exist.
- Letting CASHIER and WAREHOUSE_STAFF tag parts and upload photos weakens the theft controls, unless:
- only the owner prints label runs;
- only the owner sets costs, and only after seeing the photos;
- photos lock after costing;
- staff never see costs.
- A lost or stolen shop phone holds unsent work and the catalog in plain SQLite. Encryption needs SQLCipher in a native build. Costs never go to the phone, and synced rows and uploaded photos are deleted from it.
- An offline sale dated in a month the owner has already closed is still refused by the existing period lock (orders.service.ts:314). That cuts against 'never refuse a sale that already happened'. Watch it on the first month-end.
- Effort: the Play app rebuild (Phases 3 and 4) is the largest piece and competes with Carolina's fixes. The godfather is served on the web first, so the rebuild cannot delay his theft controls.
- tasks/procure.md:82-87 marks the StockLocation migration as done, but it is not in schema.prisma. Correct that note so nobody builds on it.
- Critic: Offline replays post as whoever is signed in at sync time.
- bulkSync stamps the caller as cashier (orders.controller.ts:253-254).
- A CASHIER ringing on someone else's shift is refused, and replays are not exempt (orders.service.ts:478-486).
- So 'switch person keeps unsent work' alone would get those sales refused or mis-attributed.
Added: a per-person session vault, so each row replays as its own person. Switching person needs a connection, and sign-out is refused while that person has unsent work.
- Critic: The plan contradicted itself: 'never refuse an offline sale', yet Phase 1 refused tagged lines with no cost or photo, or below list. Fixed:
- These refusals apply only to live sales. Replays are kept and alerted.
- The phone sells offline only tags flagged sellable.
- Critic: Two Ledger accounts were wrong.
- POS refunds debit 4010 Sales, not 4116 (journal.service.ts:688-692).
- Damaged or defective write-offs go to 5070 Spoilage & Waste; only theft, loss and count shortages go to 5060 (journal.service.ts:1063-1067).
- Critic: Crediting 1010 Cash on Hand when a tag is costed, days after the lot was paid, would misstate the drawer. Use 3010 (owner-funded or opening stock) or 1020 Bank. The journal supports BANK (journal.service.ts:966), but AdjustStockDto allows only CASH and OWNER_FUNDED, so the new costing route must accept it. CREDIT stays excluded, because it needs a vendor bill.
- Critic: 'Valued at the last cost' was wrong. A stock-in without a typed cost is valued at catalog costPrice and credits Owner's Capital by default (inventory.service.ts:1045, 1062-1066). The flows now say so, and point purchase-order deliveries at the purchase-order receive.
- Critic: AuditLog.action is a Prisma enum (schema.prisma:369-401). 'TAG_LABEL_RUN' and take-out records must use an existing action (SETTING_CHANGED, as shifts.service.ts:474-478 does) with a free-text entityType. New actions belong in Phase 6.
- Critic: 'Count against movements up to the count time' would misread late-synced offline sales. Their stock lines get the server's time at sync (orders.service.ts:950-962; InventoryLog.createdAt default now()). Fixed:
- Sales are dated by Order.paidAt.
- Count approval and 'missing tag' alerts wait for the branch's phones to sync, so a part sold offline is not reported as stolen.
- Critic: Removing the cashier PIN gate would leave a shared phone open. It is replaced by the web's lock-and-switch (POST /auth/switch-cashier, auth.controller.ts:343-376) plus idle auto-lock. switch-cashier only switches to CASHIER or SALES_LEAD (auth.service.ts:656-659). Also check whether a relief cashier switched in this way is then refused NOT_YOUR_SHIFT on the opener's till (orders.service.ts:478-486) before relying on it.
- Critic: Role mismatch. The shop setup gives everyone a CASHIER login, but tagging was limited to WAREHOUSE_STAFF and managers, and POST /serialized-units is BRANCH_MANAGER/BUSINESS_OWNER only (rentals.controller.ts:34). Option A now lets CASHIER tag and roll-call at parts shops, with the owner keeping label runs and costing.
- Critic: SerializedUnit is shared with medical-equipment rentals (rentals.service.ts:120-132). 'Refuse a plain line for a product that has tags' would break a rental shop that also sells those products. The rule now excludes MEDICAL_EQUIPMENT shops. Check production for other tag users before shipping.
- Critic: The web launcher cannot hide the Inventory card by shop type in Phase 1. accessibleApps() takes no businessType (apps.ts:131-134), and the token carries none. Phase 1 gates the card by role, and Phase 5 reads the shop type from /me/home.
- Critic: Phase 1 phone-browser receipts depend on Chrome's Web Serial (apps/web/lib/pos/printer.ts:445) reaching a Bluetooth printer. Test it on the shop phone; otherwise receipts are on-screen plus the BIR booklet until the Play app.
- Critic: The app remembers one printer ('clerque.printerId', BluetoothPrinterService.ts:37). A phone with both a receipt printer and a label printer needs two slots. This is added to Phase 4.
- Critic: Privacy and Play. Today play-store/privacy-policy.md:24-30 says no camera image leaves the device and no microphone is requested, but tag photos will be uploaded and app.json:37 and :45 request RECORD_AUDIO. The postal address is still a placeholder (:140). The data-safety form must declare photos and buyer name and address. Buyer details stay off Telegram.
- Critic: Photo handling.
- Production uses R2 only if the S3 settings are present; otherwise uploads go into Postgres as BYTEA (storage.service.ts:8-14, 98-126). Check before thousands of photos.
- Offline photos must leave the camera cache. expo-file-system is installed under expo but not declared, or the photos can be kept in SQLite.
- Uploads have no client id, so a retried upload makes a duplicate. Put the client id in the filename for now.
- Any CASHIER can attach a document to any entity today (documents.controller.ts:38-45). Without the photo lock, a cashier could satisfy the 'has a photo' rule at the moment of sale.
- Critic: Play production access. KJ's Play account is a personal one. Personal accounts created after 13 Nov 2023 must run a 12-tester, 14-day closed test before production (https://support.google.com/googleplay/android-developer/answer/14151465). Check whether Clerque already has production access. Also confirm the EAS owner: app.json:3 says clerque-app, while KJ's account notes list Clerque under hindiakokj1.
- Critic: Barcode cleanup must also pad EAN-8 to 14 digits and expand UPC-E to UPC-A before padding. 6-digit numbers are checked as tags before SKUs.
- Critic: Two 'done when' tests were impossible as written.
- Phase 3 had a sign-out and sign-in in airplane mode, but sign-in needs a connection. It is now a force-close and an offline reopen, plus a person switch while online.
- Phase 4 printed labels offline, though printing needs the server's numbers. Labels are now printed online and tagging is done offline.
Opening a shift also needs a connection (orders.service.ts:286-297), and this is now listed.
- Critic: The expo-camera frame-stall fix shipped as expo-camera 58.0.9. The latest stable SDK is 57 (https://docs.expo.dev/versions/latest/), so the upgrade does not remove the need for the camera watchdog.
- Critic: An owner-only write-off cannot also forbid self-approval. The owner may approve his own write-off, and it is logged with the existing SELF_APPROVAL action; staff self-approval stays refused.
- Critic: Replays of Procure 'bought' and similar actions have only the 24-hour key. After that, a replay gets a business refusal ('a second go at a line', procure.service.ts:896-990). The outbox treats 'already recorded' as done, and lines are sent as totals.
- Critic: Codebook deltas from Product.updatedAt alone would miss stock changes, which live in InventoryItem (schema.prisma:1484-1508). The feed now merges Product, InventoryItem, SerializedUnit and ReceiptAlias, sends deactivated rows, and offers a full refresh.
- Critic: Sizes corrected.
- Web phone till: small to medium.
- Stock-move dedupe across several routes: small to medium.
- Write-off fixes: small to medium.
- Sign-in with the session vault: medium to large.
- Store preparation with the policy rewrite: small to medium.
- Critic: The parked Counter features (Pumps, Rentals, Close & Plan, Pickups, Fleet, Approvals, KDS, customer display) were not addressed. They are now explicitly out of the first release.

## Decisions (KJ said yes to the direction on 13 Oct; the recommended answers are being followed unless he says otherwise)

1. One yes covers everything below if you accept each recommended answer. Only the items you disagree with need a reply.
2. Order of work. Recommended:
1. API first.
2. The parts shop sells by tag on the web: online, Phase 1, days.
3. The phone-ready API.
4. The Play app rebuild.
5. Carolina's scan flows, after her go-live week.
6. One migration branch.
3. Who may tag parts? Recommended: option A, which is cashiers and stock staff.
- They may tag only with labels from a run the owner printed.
- The owner sets every cost after seeing the photos.
- Nothing sells until he does.
In a small shop the seller is also the receiver, and a person can hold only one role.
4. Labels replace the tag books. Recommended: yes.
- 6-digit numbers, so they can never be mistaken for a retail barcode.
- The phone prints a QR code; the PC prints a Code 128 barcode; both show big digits.
- The painted number stays on the part.
5. Hardware. Recommended:
- Buy one Xprinter XP-P323B (about ₱5k) and synthetic labels first.
- Add a 58 mm Bluetooth receipt printer once the shop sells from the Play app.
- Buy a thermal-transfer printer only if labels fade in the yard within a month.
- Carolina needs no printer, only a USB 2D scanner if she sells packaged goods at the counter.
6. One Play listing for every shop. Recommended: rename it 'Clerque' and keep the package id com.clerque.counter. Before the first upload, rewrite the privacy policy and data-safety answers (photos now leave the phone), and check whether the listing already has production access or needs Google's 14-day closed test with 12 testers.
7. Card payments. Recommended: the Play app sends QR_PH, as the web does, for now, so the books and settlement stay unchanged. After Carolina's go-live, switch both apps to CARD and let settlement accept it (code only).
8. Expo SDK. Recommended: try the upgrade, time-boxed to 2 days. If the Bluetooth printer breaks, build on SDK 54, which meets Play's API 36 rule today, and upgrade before February 2027. Also confirm which EAS account owns the project (app.json says clerque-app; your notes say hindiakokj1).
9. New dependencies. Recommended: approve both.
- expo-crypto, for unique ids on offline sales and scans.
- Declaring expo-file-system, already installed under expo, so photos taken offline are not lost.
No barcode library is needed.
10. Stockroom to bar stays a record (who took what, plus a weekly 'taken out vs used' list), not a stock move, until the rooms migration. Recommended: accept.
11. Approve the Phase 6 migration branch. Recommended: one branch, after Carolina's first stable month and the godfather's answers on costing and dealer papers. It covers:
- rooms;
- several barcodes per product;
- stock-move and photo ids;
- the surplus plan's tag fields and AUTO_PARTS;
- an Inventory AppCode, only if Inventory is sold separately.
