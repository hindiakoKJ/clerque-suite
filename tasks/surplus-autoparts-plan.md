# Japan-surplus auto parts: a theft-proof shop on Clerque (plan, 13 Oct 2026)

For KJ's godfather's surplus auto-parts business. No barcodes: parts are tagged by process (numbered tag books, painted numbers, photos, sealed bins), and Clerque enforces the rules. Built from research on Philippine surplus parts shops and the law (RA 10883, LTO, BIR), a read of the Clerque code, and three independent designs merged into one. Nothing is built yet.

## The idea in one paragraph

Use Design 1 as the backbone. Its rule is "one number, one ending": every piece worth tagging gets one number, and that number must end in exactly one way. It is sold on an invoice, stripped into new numbers, written off by the owner with a photo, or still on the shelf when counted. Design 1 also has the fullest daily routine.

From Design 2, take four rules:
- Nothing sells until the owner has priced it.
- A lot cannot close until the tagged count matches the packing list.
- While Clerque can only print an Acknowledgement Receipt, the BIR booklet invoice number must be recorded on the sale.
- Engines and half-cuts sell only while the phone is online.

From Design 3, take four more:
- Reuse switches Clerque already has: owner-only returns, hiding costs from staff, and the supervisor PIN with lock-out.
- Refuse personal GCash/Maya on any sale that includes a tag.
- Let the app choose what gets counted each day.
- At the gate, a person other than the seller checks the part against the invoice.

While merging, I checked the code (paths are under E:\AI Projects\app-suite). Five things I found move work out of the migration branch, so Phase 1 needs no database change:

1. **Tag photos.** Document.entityType is free text (packages/db/prisma/schema.prisma:4033), and cashiers can already upload (apps/api/src/documents/documents.controller.ts:40-43). Photos can be attached to a tag today. Designs 2 and 3 said this needed a migration.
2. **Tag numbers.** Buy pre-numbered tie-on tag books that have counterfoils. The owner keeps the books, so staff cannot choose a number, and the per-shop unique serial (schema.prisma:6329) refuses duplicates. No new number sequence is needed.
3. **Haggling.** A cashier's cart discount already needs a supervisor PIN. The PIN check has a lock-out and does not let anyone approve their own discount (apps/api/src/orders/orders.service.ts:400-431, 2428-2471). If the owner holds the only discount-capable account, every price below list is his decision until the per-tag floor price arrives (packages/shared-types/src/permissions.ts:81).
4. **Buyer name and address.** The payment screen already has these fields (apps/web/components/pos/PaymentModal.tsx:91-93, 260-262), and the order already stores them (schema.prisma:1708-1712).
5. **Telling engines, half-cuts and frame pieces apart.** Use an SKU prefix (ENG-, HC-, FRM-). Only the owner or MDM can create or edit products (apps/api/src/products/products.controller.ts:120-129).

**Order of work**
- **Phase 1 (days, push to master):** phone till, the sell-by-tag lock, each tag's own cost in the books, required photos, engine rules, numbers printed on the receipt, e-wallet rules, BIR booklet number.
- **Phase 2 (no migration):** owner-only write-offs, a blind roll call sent to the owner's Telegram, a tag gap report, a daily summary, credit limits, and a warning as sales near the ₱3M VAT line.
- **Phase 3 (one migration branch, waits for KJ's word):** floor price, sets and stripping jobs, receiving a lot, item kinds and statuses, audit actions, and an AUTO_PARTS shop type.
- **Phase 4:** owner approvals from his phone, the monthly LTO engine register, and job orders that name tags.

**Honest limits**
- The app cannot see a part carried out with no sale. The roll call and the gate check are the backstop.
- Small parts in bins stay weak.
- An offline phone can sell a tag that was already sold. The app can only alert afterwards, which is why engines and half-cuts must sell online.
- Until Phase 3, stripping an engine or half-cut is caught by photos and people, not refused by the app. Friend pricing is already blocked in Phase 1, but only if nobody except the owner holds a supervisor PIN.

## How each kind of part is tagged

| Part | How it is tagged | What Clerque enforces |
|---|---|---|
| Engines (usually with transmission, alternator, A/C compressor, starter, ECU, sometimes a turbo) | Identity is the factory-stamped engine number. Photograph the stamp and type the number in. Never paint, grind or punch near the engine-number pad, because RA 10883 s.14 makes altering it a crime (https://lawphil.net/statutes/repacts/ra2016/ra_10883_2016.html).  Shop tag: - a pre-numbered tie-on tag wired to the lifting eye - the same number in large paint-pen digits on the block, plus a second copy in a hidden spot the owner picks for each lot - a dab of this month's paint colour on the block and on every accessory  Photos: both sides of the whole engine, the engine-number stamp, and each accessory with its part label.  The tag notes carry the accessory checklist ('ALT, A/C, STARTER, ECU'). Photograph the supplier's papers (CSR, import entry or the importer's certification) onto the tag. | Phase 1: - The product SKU starts with ENG-, so the tag cannot be saved without an engine number. The number goes into the tag notes, which no route can edit afterwards (apps/api/src/rentals/rentals.controller.ts:34-38 is add-only). - The tag cannot be sold without a photo. - It sells once, by its number, at its own cost. - Buyer name and address are required, and the phone must be online. - The receipt prints the engine number from the record, never typed at the till.  Phase 3: - The engine number gets its own unique field. - Accessories become child tags. 'Complete' sells only if every child is still in stock, otherwise the owner must approve. |
| Half-cuts, nose-cuts, front-cuts (and the occasional whole vehicle) | Identity is the chassis or frame number (e.g. NZE141-6048723). Photograph it where it is stamped and match it to the auction sheet and export certificate (https://jpauctionsheet.com/about_vin).  Paint the shop tag number on the bulkhead or strut tower and inside the windscreen, and wire on a tie-on tag. Take 8 photos around the cut. Write a checklist of the major parts in the notes: engine (with its engine number), transmission, ECU, lamps, doors, hood, radiator, A/C, harness. Each part gets a paint dab and a photo.  At intake the owner decides: sell whole, or strip now. A whole vehicle keeps its LTO/BOC papers with the tag and is never sold as 'parts'. | Phase 1: - The SKU starts with HC-, so the chassis number is required. - The tag sells once, needs a photo, and needs buyer name and address while online. - Stripping a half-cut that was tagged whole is not allowed until Phase 3. 'Strip now' means every part is tagged straight from the cut. The owner splits the half-cut's cost over those parts.  Phase 3: a dismantle job. - The owner opens it. - Every checklist item must become a child tag, or be marked 'missing' with a photo. - The children's costs add up exactly to the parent's cost (the same rule as apps/api/src/sub-recipes/sub-recipes.service.ts:1124-1131). - The parent is locked as DISMANTLED and can never be sold.  Do not use the trucking FleetAsset table: it needs a plate number (schema.prisma:5403). |
| Frame-number pieces (bulkhead, strut tower or firewall section that carries a chassis number) | Gets its own tag number, painted on the piece, with a photo of the chassis-number stamp. These are controlled items: a piece like this could be used to give a stolen car a new identity, which RA 10883 s.7 and s.15 forbid. | Phase 1: - The SKU starts with FRM-. It sells only with buyer name and address, and the papers are photographed onto the tag. - The only other ending is the owner's write-off with a photo of the cut-up piece (Phase 2 route).  Phase 3: a CONTROLLED kind with no other way out. |
| Transmissions sold alone, ECUs, ABS units, alternators, starters, A/C compressors, turbos, meter clusters, radios | Write the tag number in paint pen or marker on a flat face of the casing, with a second copy hidden. Add a tie-on tag and the month's paint dab. Photograph the maker's part-number label next to the shop number. That label is for fitment only, because labels can be peeled off.  ECUs, modules, sensors, injectors and keys go in a zip bag with the number written on the bag. They are kept in a locked cabinet; only the owner or one named person holds the key. | Phase 1: sells once, by its number, at its own cost. A photo is required. Selling below list needs the owner's PIN.  Phase 2: the locked cabinet is on the daily blind roll call.  Phase 3: a floor price for each tag, and a rack or slot on each tag. |
| Body panels and big trim (doors, hoods, fenders, bumpers, tailgates, glass, seats, dashboards) | Write the number with marker or paint pen on the INSIDE face, never the painted show side. Add a tie-on tag and a paint dab. Photos: one of the outside (colour, dents) and one of the number. Write the rack location in the notes. A door that comes with its glass, regulator and mirror has a short checklist in the notes. | Phase 1: sells once, by its number. A photo is required.  Phase 2: a weekly roll call by rack.  Phase 3: - The rack location becomes a field. - A door with its parts becomes a set, so taking the mirror off needs the owner to split the set. |
| Headlamps, tail lamps, mirrors | Write the number in marker on the back of the housing, and add a paint dab and a photo. A left/right pair gets two tags, with 'pair with 0457' in the notes. | Phase 1: each lamp sells once. A pair is rung as two tags.  Phase 3: a pair is a set and sells together unless the owner splits it. |
| Wheels and tires | Each piece gets one tag. Write it in paint pen inside the rim, or in tire crayon on the inner sidewall. Record the DOT date code in the notes. A set of 4 gets four tags, with 'set 0510-0513' in the notes. | Phase 1: each piece sells once, by its number.  Phase 3: a set is a parent with 4 children. It sells as 'a set of 4' only if all 4 are still in stock.  Not the trucking TireSerial table: nothing writes to it, and it belongs to the shop's own trucks (schema.prisma:5453-5478). |
| Suspension, brake and drivetrain parts (struts, arms, racks, knuckles, calipers, hubs, axles, radiators) | At or above the tagging line (suggested ₱500, the BIR invoice line): letter-punch the number into a bracket, or write it in paint pen, then add a tie-on tag, a paint dab and a photo. Below the line, the part goes in a numbered bin. | Above the line: the full tag rules.  Below the line: a bin product sold by quantity. Taking stock out needs a reason and a supervisor PIN (apps/api/src/inventory/inventory.service.ts:896-938). |
| Small parts below the line (bolts, nuts, clips, fuses, relays, bulbs, hoses, small brackets) | No tag on each piece. They are sorted into numbered bins or sealed bags by type ('B-12 Toyota door clips'), with the count written on the seal. Bins stay behind the counter, not on the open floor. | Each bin type is a Clerque product with a stock count. Only the owner or MDM can create products (apps/api/src/products/products.controller.ts:120-121), so staff cannot invent a cheap catch-all item. Stock-outs need a reason and a PIN.  Phase 2: a weekly blind bin count. Honest: this measures the loss but does not stop it. |
| Shells, scrap metal, cores and old parts customers hand in | The shell left after stripping gets its own tag. Scrap is sold by the kilo as a bin product, with a photo of the scale. A core a customer hands in gets a new tag on the spot, with a photo and 'core from sale <number>' in the notes. | Scrap leaves only on an invoice by weight.  Phase 2: a tag write-off is owner-only and needs a photo.  Phase 3: a SCRAP status keeps the piece on the count until it is sold by weight. |

## The shop routine

### 0. Opening day: tag everything already in the yard
**Who:** Owner and all staff, one day before go-live

Every piece at or above the line gets:
- a tag from the book
- the painted number
- a paint dab
- photos
- a rack location

Small parts go into numbered, counted bins. The owner enters each tag on his phone with his estimated cost and the product (type and grade, with his list price). Engines and half-cuts get their engine or chassis numbers.

**Clerque:** Phase 1:
- A tag number can be used once per shop (schema.prisma:6329).
- A tag cannot be sold without a photo.
- Adding a tag books 1 unit at its cost into inventory (owner-funded opening stock).
- Staff never see cost (apps/api/src/procure/cost-visibility.ts:42-70, extended to tags).

### 1. A container or lot arrives
**Who:** Receiver plus a second trusted person, never one person alone. The owner is present or on video call.

Before anything moves:
- photograph the seal and the open doors
- video the unloading
- count the pieces at the door against the packing list
- photograph the papers (invoice, packing list, CSR or import copies for engines)

The owner writes down the lump price plus freight, customs duty, 12% import VAT (a cost for a non-VAT shop: https://www.respicio.ph/commentaries/importation-expenses-and-taxes-in-the-philippines), broker and trucking.

**Clerque:** Phase 1: the papers are photographed onto the tags. The owner splits the landed total over the tags himself.

Phase 3, 'Receive a lot':
- The total sits in a lot.
- The lot cannot close until the tagged count equals the packing list, or each gap has an owner note.
- Closing spreads the cost by asking price, so it adds up exactly.
- Nothing in an open lot can be sold.

### 2. Tag each piece
**Who:** Yard staff on a phone; a second person checks

1. Take the next tag from the book you were given.
2. Paint the number on the part in two places (visible, and the hidden spot for this lot). Wire the tag on, and add the month's paint dab.
3. Write the tag number and a short description on the counterfoil.
4. Take the photos.
5. For engines and half-cuts: photograph the engine or chassis stamp, and photograph each part on the checklist.
6. A spoiled tag is stapled back into the book with 'VOID' written on it.

**Clerque:** Phase 1:
- Tag records are added only by the owner or branch manager (apps/api/src/rentals/rentals.controller.ts:34-38).
- ENG-/HC- products refuse a tag with no engine or chassis number.
- Photos are attached to the tag (Document, entityType 'SerializedUnit').

Phase 2: a gap report lists every number up to the highest used that has no tag record. The owner matches each gap to a VOID counterfoil.

### 3. Price
**Who:** OWNER ONLY

Phase 1: the price lives on the product (type and grade, e.g. 'Headlamp LH Vios 2014-17 Grade A'). Set it at a price you are happy to accept, because every discount below it needs your PIN.

Phase 3: an asking price and a hidden floor price for each tag.

**Clerque:** Prices can only be edited by the owner or MDM (packages/shared-types/src/permissions.ts:74).

Phase 1:
- A tagged line must be at the catalog price; the server refuses a lower one.
- A haggle goes through the cart discount, which needs a supervisor PIN for a cashier (apps/api/src/orders/orders.service.ts:400-431).

Phase 3:
- A tag cannot be sold until it is priced.
- Below the floor needs the owner.

### 4. Store
**Who:** Yard staff

Racks and zones carry painted codes. Engines stand in a row with their tags facing out. ECUs, sensors and modules go in the locked cabinet. Scrap goes in its own locked cage. Bins are sealed and kept behind the counter.

**Clerque:** Phase 1: the rack is written in the tag notes.

Phase 3: the zone becomes a field, and moving a tag is owner-only, the same way stock transfers already are (apps/api/src/inventory/inventory.controller.ts:93-94).

### 5. Strip a half-cut or break a set
**Who:** The owner opens the job; two people strip; the owner closes it the same day

Phase 1: only half-cuts marked 'strip now' at intake are stripped. Every part is tagged before it leaves the bay. Anything missing or broken is photographed. The shell gets a tag.

Phase 3: any tagged half-cut, engine or set can be stripped, through a dismantle job on the phone.

**Clerque:** Phase 3:
- The parent becomes DISMANTLED and can no longer be sold.
- Every checklist item must become a child tag or be marked 'missing' with a photo and the owner's approval.
- The children's costs add up exactly to the parent's cost.
- Nothing is posted to the books for this, because value only moves inside inventory (apps/api/src/accounting/journal.service.ts:872-878).

### 6. Sell at the counter
**Who:** Cashier on a shop phone, logged in as themselves

1. Read the number off the part and type it in. Check the photo on screen against the part.
2. If the customer haggles below list, call the owner for his PIN.
3. For an engine, half-cut or frame piece: enter the buyer's name and address. The phone must be online.
4. Payment:
- cash into the drawer (an open shift is required), or
- GCash or Maya to the shop's BUSINESS QR only, with the reference number typed in.
5. Paperwork:
- give Clerque's receipt, which shows the tag and engine numbers
- for any sale of ₱500 or more, also write the BIR booklet invoice and type its number into Clerque
- for an engine, hand over copies of the CSR and import papers.

**Clerque:** Phase 1, all inside the sale save:
- The tag flips from IN_STOCK to SOLD with a conditional update. If it was already sold, the whole sale fails.
- Quantity must be 1.
- An untagged line for a product that has tags is refused.
- A tag from another branch, or with no photo, is refused.
- Controlled items without buyer details are refused.
- Personal GCash/Maya is refused, and e-wallet payments without a reference are refused.
- Sales of ₱500 or more without a booklet number are refused while the receipt is an Acknowledgement Receipt (packages/shared-types/src/tenant.ts:304-337).
- Cash without an open shift is already refused (apps/api/src/orders/orders.service.ts:286-292).

### 7. Release at the gate
**Who:** The loader or a helper, never the seller

Before a part leaves the yard, read the painted number on the part and match it to the number printed on the receipt. If they don't match, nothing leaves.

**Clerque:** The receipt and the order screen carry the tag and engine numbers. The check itself is done by a person: this is the one step the app cannot do.

### 8. Mechanics on credit and installation jobs
**Who:** The owner approves each credit account; the cashier rings the sale

Only mechanics the owner has named get credit, each with a limit. A part used on an installation is sold, or charged to an account, before it leaves the rack. Each credit account gets a statement every week.

**Clerque:** A CHARGE sale already refuses any payment taken at the till (apps/api/src/orders/orders.service.ts:238-247).

Phase 2: a sale over the customer's credit limit is refused. Today the limit is stored (apps/api/src/ar/customers.service.ts:99) but never checked.

Phase 4: job-order part lines must name a tag.

### 9. Facebook and Marketplace
**Who:** Owner, or one named poster on the owner's page

Listings show the tag photo with the number visible. A deposit to hold a part is its own order. The part itself is sold by its tag only when it is collected or shipped. Payment goes only to the business QR.

**Clerque:** A part-paid sale is already refused (apps/api/src/orders/orders.service.ts:248-260).

Phase 3/4: a HELD status, tied to the deposit, with an expiry date.

### 10. Returns and warranty
**Who:** OWNER ONLY

The customer brings the part and the receipt. The painted number, the hidden number, the paint dab and the photos must all match. Hidden defects must be fixed or refunded, and a 'No return, no exchange' sign is not allowed (https://business.inquirer.net/370538/drop-no-return-no-exchange-policy-dti-reminds-traders/amp).

**Clerque:** The existing owner-only returns switch blocks voids and refunds by anyone else (schema.prisma:552; apps/api/src/orders/orders.service.ts:2491-2503).

Phase 1: a void or refund puts THAT tag back to IN_STOCK, valued at its own cost.

### 11. Damaged, defective or lost
**Who:** Staff report it; the owner decides

The physical part, with its number visible, is photographed and put in the locked scrap cage. A 'lost' tag is owner-only and goes to the police-report pile.

**Clerque:** Phase 2:
- A tag write-off is owner-only and needs a photo. The tag moves to RETIRED.
- It is booked to inventory write-off (5060) with its reason.
- PIN guesses are limited, and nobody can approve their own write-off (the PIN check at apps/api/src/orders/orders.service.ts:2428-2471).

### 12. Close of day
**Who:** Cashier counts the drawer; a second person does the roll call; the owner reviews on his phone

1. Count the cash blind and close the shift.
2. Match the day's e-wallet references against the owner's GCash/Maya business app.
3. Write one booklet invoice for the total of the day's sales under ₱500 (if they add up to ₱500 or more).
4. Roll call: walk with the phone and type in the tag numbers found for every engine, half-cut and frame piece, plus the locked cabinet.

**Clerque:** The blind close with its variance already exists (apps/api/src/shifts/shifts.service.ts:219-301), and so does the unmatched e-wallet list (apps/api/src/settlement/settlement.service.ts:295).

Phase 2: the server compares the roll call with what should be in stock. Staff only see 'sent'. The owner gets the missing tags, plus one Telegram summary of tag sales, discounts, voids and cash variance.

### 13. Weekly and monthly count
**Who:** Two staff counting, rotated; the owner reviews and also counts himself at random

Weekly: every tag in one or two zones the owner picks, plus every bin, counted blind. Monthly: everything. Change the paint colour every month, and the hidden-number spot for every lot.

**Clerque:** Phase 2: a blind roll call to the owner's Telegram. Nothing is stored and the books are not changed.

Phase 3:
- A stored count with photos of the tags found.
- The app picks a random slice to count each day.
- Only the owner can adjust the books to match (the pattern in apps/api/src/procure/station-count.service.ts:24-25, 243-251).

### 14. Monthly and quarterly papers
**Who:** Owner or bookkeeper

Monthly, if he is a dealer: the engine and chassis stock report for the LTO. It lists what came in and from whom (name and address), and what went out and to whom (RA 10883 s.10). Quarterly: the 2551Q at 3%. Always: watch 12-month sales against the ₱3M VAT line.

**Clerque:** The 2551Q at 3% already exists (apps/api/src/bir/bir.service.ts:300-343).

Phase 2: a rolling 12-month sales warning.

Phase 4: the engine register is built from the tag and sale records, not typed by hand.

## Every theft, its control, and how fast it is caught

| Theft | Control | Caught |
|---|---|---|
| The same tagged part sold twice (two phones, or a reused number) | Phase 1: the server flips the tag from IN_STOCK to SOLD inside the sale with a conditional update, and the whole sale fails unless exactly one row changes. Do not copy the rentals pattern, which checks first and writes later (apps/api/src/rentals/rentals.service.ts:126-132). Tag numbers are unique per shop (schema.prisma:6329). | prevented |
| An engine or other expensive part rung up as a cheap generic line | Phase 1: an untagged line for a product that has tags is refused. If the engine is rung as some OTHER cheap product, its tag stays in stock while the engine is gone, and the daily roll call of engines finds it. Only the owner or MDM can create products (apps/api/src/products/products.controller.ts:120-121). | same day |
| Friend price, or haggling lower than the owner accepts | Phase 1: a tagged line must be at the catalog price, and a discount needs a supervisor PIN with lock-out and no self-approval (apps/api/src/orders/orders.service.ts:400-431, 2428-2471). Staff log in as CASHIER only, so the owner's PIN is the only one that works. Phase 3: a hidden floor price for each tag, refused by the server below it. | prevented |
| Charging the customer more than the till price and keeping the difference | The receipt shows the price, and a sign at the counter says 'Ask for your invoice; the price on it is what you pay.' The Telegram sale alert shows the owner each tag's sold price. | weak |
| A part walked out with no sale | Every number must end in one way, and this one is still 'in stock'. Daily blind roll call for engines, half-cuts, frame pieces and the locked cabinet; weekly roll call by zone; monthly for everything (owner with his list in Phase 1, staff-blind to Telegram from Phase 2). At the gate, nothing leaves without a receipt whose number matches the part. | within a week |
| Off-book sale: the customer pays a staff member and nothing is rung | The tag stays 'in stock' but is missing at the roll call. The counter sign reminds buyers to ask for an invoice. A torn-out booklet invoice shows as a gap in the booklet numbers typed into Clerque (Phase 1 captures them). | within a week |
| Tag numbers swapped (a cheap part's number put on an expensive part) | At the sale, the photo from intake is shown on screen. The number is painted on the part in two places, one hidden. The gate check reads the painted number, not the hanging tag. Engines must match the engine number on record. | same day |
| An engine stripped before it sells (alternator, ECU, turbo taken and sold) | Phase 1: an accessory checklist in the tag notes, with paint dabs and close-up photos at intake, compared at sale and at the gate. Five random engines are checked against their photos every week. Phase 3: accessories are child tags, and the engine will not sell 'complete' unless every child is still in stock. | within a week |
| A good accessory swapped for a junk one (ECU, alternator, turbo) | The month's paint colour, plus a close-up of the part label or casting number at intake, compared at the weekly spot check and at sale. This only works if someone actually looks at the photos. | within a week |
| Parts pocketed while a half-cut is stripped | Phase 1: stripping happens only at intake, by two people with the owner present or on video, and every part is tagged before it leaves the bay. Phase 3: a dismantle job that cannot close until every checklist item is a tag or marked missing with a photo. Small bits that are not on the list are not covered. | same day |
| A customer or staff member returns a different, bad part as 'ours' | Returns and voids are owner-only (the existing switch: schema.prisma:552; apps/api/src/orders/orders.service.ts:2491-2503). A return is accepted only against the receipt and only if the painted number, hidden number, paint dab and photos match. | prevented |
| Fake 'defective' or 'lost' write-off, then the part is sold privately | Phase 1: tags have no write-off route at all, so this cannot happen. Phase 2: an owner-only tag write-off that needs a photo of the actual numbered part; the part sits in the locked scrap cage and the loss is booked to 5060 with its reason. Today, product write-offs throw the reason away and accept a PIN from a sales lead (apps/api/src/inventory/inventory.service.ts:911-937, 1020-1067). | prevented |
| A sale voided after the customer leaves, cash kept | Voids are owner-only (the switch above). A voided tag goes back to IN_STOCK, so the part must still be on the shelf at the next roll call. Blind cash close with variance (apps/api/src/shifts/shifts.service.ts:219-301). | prevented |
| GCash or Maya paid to a staff member's own number | Phase 1: a sale with a tag refuses GCASH_PERSONAL and MAYA_PERSONAL (schema.prisma:227-237) and requires a reference number (OrderPayment.reference is optional today, schema.prisma:1923). Only the business QR is shown at the counter. References are matched daily against the owner's app (apps/api/src/settlement/settlement.service.ts:295). If no sale was rung at all, it is the off-book case above. | within a week |
| Rung as 'GCash' but the cashier keeps the cash | The reference number is required. At close, each e-wallet line must match a real payment in the owner's business account, and the unmatched list flags the rest. | same day |
| Cash taken from the drawer | Every cash sale needs an open shift (apps/api/src/orders/orders.service.ts:286-292). The drawer is counted blind at close, and the variance is booked automatically. | same day |
| Pieces taken from a container before they are tagged | Two people count at the door against the packing list, with the unloading on video. Tags come from books the owner holds, so a gap in the numbers shows. Phase 3: the lot cannot close, and so cannot sell, until the tagged count equals the packing list. Loose small parts in a mixed lot have no list. | same day |
| A fake tag added to cover a stolen part or launder an outside part | Only the owner or branch manager can add tags (apps/api/src/rentals/rentals.controller.ts:34-38). Tags come from the owner's numbered books, with counterfoils. Phase 3: tags are created only inside a received lot or a dismantle job. | prevented |
| Two offline phones sell the same tag | Engines, half-cuts and frame pieces sell only online. When a stored offline sale reaches the server and the tag is already SOLD, the sale is kept and the owner gets a 'tag sold twice' alert (Phase 1). | same day |
| A friend's purchases put on a mechanic's credit account | Only accounts the owner has named get credit. Phase 2: a sale over the credit limit is refused (today the limit is stored but never checked: apps/api/src/ar/customers.service.ts:99). Each mechanic gets a weekly statement and disputes what isn't his. | within a week |
| Small parts (clips, bolts, bulbs, relays) pilfered | Sealed, numbered bins behind the counter, with the count on the seal. Weekly blind bin count. Stock-outs need a reason and a PIN. | weak |
| Scrap or shells sold off the books | Every shell is a tag. Scrap leaves only on an invoice by weight, with a photo of the scale. | within a week |
| A cashier uses the purchase cost to judge how low a 'friend price' can go | Phase 1: hide each tag's cost from staff. Today the tag list returns acquiredCost to cashiers (apps/api/src/rentals/rentals.service.ts:59-72). Cashiers look up one tag by its exact number instead of browsing the whole list. | prevented |

## What to build in Clerque, in order

### Phase 1: Sell by tag (days, no database change, push to master)

Every piece at or above the line has a number and a photo. A numbered part sells only once, only by its number, at its own cost, and never below list without the owner's PIN. Engines carry their engine number to the receipt and need a named buyer. The till works on an Android phone.

**App changes**

- (small, no database change) Phone till: show the cart and the Charge button on the retail till below 1024 px (reuse the floating cart button and full-screen cart the food-and-drink till already has).  _Evidence: apps/web/app/pos/(pos)/terminal/RetailTerminal.tsx:309 (the cart rail is 'hidden lg:flex'). apps/web/app/pos/(pos)/terminal/page.tsx:524-547 shows the retail screen and returns early; the phone cart and floating button are only in the other branch (617-652)._
- (small, no database change) Show the tags screen in the retail menu, and fix the cost shown 100 times too large.  _Evidence: packages/shared-types/src/verticals.ts:264-274 (retail menu has no link) and :749 (the link exists only for MEDICAL_EQUIPMENT). apps/web/app/pos/(pos)/serialized-units/page.tsx:170 (formatPeso(Math.round(cost*100)))._
- (small, no database change) Adding a tag puts it in stock and in the books:
- stock-in of 1 at the tag's cost (CASH or OWNER_FUNDED)
- skip the ±50% catalog-cost guard for tags
- check the branch belongs to the shop
- real validation: cost required and not negative, tag number digits only
- for ENG-/HC-/FRM- products, refuse the tag without an engine or chassis number, written into the tag notes (there is no edit route, so it cannot be changed later)  _Evidence: apps/api/src/rentals/rentals.service.ts:74-101 (writes only the unit row), :26-32 (plain interface, so nothing is validated). apps/api/src/inventory/inventory.service.ts:884-885 (the branch check createUnit lacks), :953-968 (the ±50% guard). apps/api/src/inventory/dto/adjust-stock.dto.ts:116-118. apps/api/src/rentals/rentals.controller.ts:34-38 (add only; no edit route)._
- (small, no database change) Staff never see cost:
- apply the hide-costs switch to the tag list
- outside medical-equipment shops, cashiers look up one tag by the exact number read off the part instead of browsing the full list  _Evidence: apps/api/src/rentals/rentals.service.ts:59-72 (findMany returns every column, acquiredCost included); apps/api/src/rentals/rentals.controller.ts:24-32 (open to CASHIER); apps/api/src/procure/cost-visibility.ts:42-70 (canSeePurchaseCosts exists, not applied here)._
- (small, no database change) Tag photos with no new table: save them as Documents with entityType 'SerializedUnit' and the tag's id. The server refuses to sell a tag that has no photo. Only the owner can delete a tag photo.  _Evidence: packages/db/prisma/schema.prisma:4029-4053 (Document.entityType is a free string); apps/api/src/documents/documents.controller.ts:40-43 (cashiers can upload); apps/api/src/documents/documents.service.ts:63-115; packages/shared-types/src/permissions.ts:124 (document:delete also allows BRANCH_MANAGER, ACCOUNTANT, BOOKKEEPER)._
- (medium, no database change) Sell by tag (the lock).
The till:
- the cart line carries serializedUnitId (the same way yellowRxSerial is carried)
- the line key includes the tag, so two tags of one product stay two lines
- 'Type the tag number' shows the tag's photo, product and price
The server, inside the sale:
- updateMany where {id, tenantId, branchId, productId, status:'IN_STOCK'} sets status SOLD and soldOrderId; throw unless exactly 1 row changed
- quantity must be 1
- refuse an untagged line for a product that has tags
- a tagged line's price must equal the catalog price (haggles go through the PIN-gated cart discount)  _Evidence: schema.prisma:6303-6333 (SerializedUnit has status and soldOrderId, which nothing sets); packages/shared-types/src/pos.ts:35-69 (no unit field on the line); apps/api/src/orders/orders.service.ts:749-781 (the line write copies only known fields; yellowRxSerial at 769), :852-853 (at zero stock the sale skips the deduction instead of refusing); apps/web/store/pos/cart.ts:266 (line key). Do NOT copy the check-then-write in apps/api/src/rentals/rentals.service.ts:126-132._
- (medium, no database change) Each tag's own cost becomes its cost of sale: add it first in the cost waterfall as SPECIFIC, and add the tag id to the cost write-back key. A void or refund puts THAT tag back to IN_STOCK.  _Evidence: apps/api/src/orders/orders.service.ts:1578-1598 (waterfall: recipe, lot, average cost, snapshot); :1648-1656 (write-back keyed by product, size and add-ons); void at 1768+ reverses from OrderItem.costPrice (1945-1953); refund at 2122+._
- (small, no database change) Engines, half-cuts and frame pieces (product SKU starting ENG-, HC- or FRM-, set only by the owner or MDM): refuse the sale without the buyer's name and address. The till will not queue them offline.  _Evidence: apps/web/components/pos/PaymentModal.tsx:91-93, 260-262 (the buyer fields already exist); schema.prisma:1708-1712; apps/api/src/orders/orders.service.ts:742-744 (already saved); apps/api/src/products/products.controller.ts:120-129 (only owner or MDM can create or edit products)._
- (small, no database change) Numbers on paper: the server writes 'Tag 0123 · Engine No. …' from the tag record into the line notes. The customer receipt, the receipt screen and the Telegram sale alert print it. The alert also shows the sold price, the list price, the margin and who approved any discount.  _Evidence: schema.prisma:1806 (OrderItem.notes, never written by orders.service.ts:749-781); apps/web/lib/pos/printer.ts:104, 266-274; apps/web/components/pos/ReceiptModal.tsx:560-563; apps/api/src/telegram/telegram-alerts.service.ts:35-85 (the sale alert does not read notes)._
- (small, no database change) E-wallet rules on any sale that includes a tag: refuse GCASH_PERSONAL and MAYA_PERSONAL, and require a reference number on GCash, Maya and QR Ph lines.  _Evidence: schema.prisma:227-237 (the personal wallets are payment methods); schema.prisma:1923 (reference is optional); apps/api/src/orders/orders.service.ts:783-789 (payments are copied as sent)._
- (small, no database change) BIR booklet number: while Clerque prints an Acknowledgement Receipt, a sale of ₱500 or more needs the booklet invoice number, saved on the order.  _Evidence: packages/shared-types/src/tenant.ts:304-337 (SALES INVOICE only with a PTU and provider phase 2); schema.prisma:1691 (Order.notes exists and is not written by orders.service.ts today)._
- (small, no database change) When a stored offline sale reaches the server and its tag is already SOLD: keep the sale, do not mark the tag twice, and send the owner a Telegram 'tag sold twice' alert.  _Evidence: apps/api/src/orders/orders.service.ts:2361 (bulkSync); :1402-1406 (stored offline sales skip the stock ceiling on purpose)._

**Shop setup**

- Settings:
- turn ON owner-only returns (schema.prisma:552; apps/web/app/settings/page.tsx:1961-1967)
- turn OFF 'show purchase costs to staff'
- leave 'allow sale when out of stock' off
- Accounts:
- every staff member gets their own CASHIER login on a shop-owned Android phone; no shared logins
- create no BRANCH_MANAGER or SALES_LEAD accounts unless the owner trusts that person completely: those roles can discount, void and approve write-offs (packages/shared-types/src/permissions.ts:79-81; apps/api/src/inventory/inventory.service.ts:911)
- the owner sets a supervisor PIN and never shares it
- Owner links his Telegram for alerts. Linking is open to owner and branch-manager roles only (apps/api/src/telegram/link-roles.ts:7).
- The owner creates products as 'type + grade' with his list price. Engines, half-cuts and frame pieces get SKUs starting ENG-, HC- or FRM-. Small parts get one product per bin type.
- The owner keeps the pre-numbered tag books locked, hands out one book at a time, and collects the counterfoils.
- Pick the tagging line (suggested: ₱500, the BIR invoice line).
- Opening day: tag everything at or above the line, enter the owner's cost estimates as owner-funded opening stock, and bin and count the small parts.
- Phase 1 stripping rule: decide 'sell whole' or 'strip now' when a half-cut arrives. No stripping of a half-cut that was tagged whole until Phase 3.
- Lot cost in Phase 1: the owner spreads the lot's landed total over its tags by expected selling price, the last tag takes the remainder, and the day's stock-ins must add up to the lot total.
- One GCash/Maya BUSINESS QR printed at the counter. Signs: 'Pay only to this QR' and 'Ask for your invoice'.
- BIR booklet invoices (with authority to print) at the counter until the shop holds a PTU for Clerque.
- A locked cabinet for ECUs, modules and sensors; a locked scrap cage; racks with painted zone codes.
- Until Phase 2: the owner does the daily roll call of engines and half-cuts himself, using the tag list on his own phone.

### Phase 2: Close the leaks (1-2 weeks, still no database change)

Staff can count without seeing what should be there, with the result sent only to the owner. Tagged parts can be written off only by the owner with a photo, and the reason reaches the books. The owner gets one daily summary. Credit limits and the VAT line are watched.

**App changes**

- (small, no database change) Owner-only tag write-off: a photo of the actual numbered part is required, the tag moves to RETIRED (a status that already exists), and the stock-out is valued at the tag's own cost and booked to 5060 with its reason.  _Evidence: schema.prisma:6295-6301 (RETIRED exists); tags have no write-off route today (the units routes are only list and add: apps/api/src/rentals/rentals.controller.ts:24-38); apps/api/src/accounting/journal.service.ts:1062-1066 (THEFT and COUNT_CORRECTION go to 5060 only when the reason is in the event)._
- (small, no database change) Fix product write-offs:
- save the reason code and the approver in the stock log and in the accounting event
- value at average cost, not catalog cost
- check the PIN with resolveSupervisorByPin (lock-out, and the person asking is excluded)  _Evidence: apps/api/src/inventory/inventory.service.ts:911-937 (values are only stashed; no lock-out; self-approval possible), :1020-1067 (the log and event leave them out; catalog cost at 1040-1046); apps/api/src/orders/orders.service.ts:2428-2471 (the better PIN check)._
- (small, no database change) Blind roll call with no new table:
- staff type the tag numbers they find (scope: all ENG-/HC-/FRM- tags plus the cabinet, or a zone or product range the owner picks)
- the server compares them with the tags in stock at that branch
- the owner gets the missing and unexpected tags on Telegram; staff see only 'sent'  _Evidence: Blind, record-only pattern: apps/api/src/procure/station-count.service.ts:24-25, 243-251. The count table is ingredients-only (CycleCountLine.rawMaterialId required, schema.prisma:5168-5184), hence no stored record until Phase 3. Telegram roles: apps/api/src/telegram/link-roles.ts:7._
- (small, no database change) Tag gap report for the owner: every number from 1 to the highest tag used that has no tag record, to match against VOID counterfoils.  _Evidence: schema.prisma:6329 (unique tag number per shop)._
- (small, no database change) Daily close summary on Telegram:
- tag sales with margin
- discounts and who approved them
- voids and refunds
- unmatched e-wallet payments
- cash variance
- phones that have not synced  _Evidence: apps/api/src/settlement/settlement.service.ts:295 (getUnmatchedPayments); apps/api/src/shifts/shifts.service.ts:219-301 (close with variance); apps/api/src/telegram/telegram-alerts.service.ts:35-85, 156-165 (sale alert and photo alerts exist; none for voids or write-offs)._
- (small, no database change) Refuse a CHARGE sale that would push a customer past their credit limit, unless the owner approves.  _Evidence: apps/api/src/ar/customers.service.ts:99 (the limit is stored); apps/api/src/orders/orders.service.ts:238-247 (CHARGE handling never reads it)._
- (small, no database change) Owner dashboard: rolling 12-month gross sales against the ₱3M VAT line.  _Evidence: No threshold check found in apps/api/src (a grep for 3000000 and 3_000_000 found nothing, per the code check above). 2551Q exists at apps/api/src/bir/bir.service.ts:300-343._

**Shop setup**

- Daily: a staff member does the blind roll call of every engine, half-cut, frame piece and the locked cabinet. It must not be the cashier who closed the drawer.
- Weekly: a blind roll call of one or two zones the owner picks, plus every bin. Monthly: everything.
- Rotate who counts. The owner does his own surprise count at least once a month.
- Change the paint colour every month, and the hidden-number spot for every lot.
- Each day, match the e-wallet references against the owner's GCash/Maya business app.

### Phase 3: One migration branch (waits for KJ's word)

Each tag gets its own asking and floor price, kind and location, and real engine and chassis number fields. Sets and stripping are enforced, so value never appears or vanishes. Containers are received as lots, with the cost spread automatically. Counts are stored with photos. The shop runs as its own AUTO_PARTS type with safe defaults.

**App changes**

- (medium, database change, needs KJ's word) New fields on each tag:
- asking price, and a floor price hidden from staff
- kind: ENGINE, HALF_CUT, FRAME_PIECE, SET or PART
- engine number (unique per shop) and chassis number
- zone, lot id, parent tag id
New statuses: AWAITING_PRICE, HELD, DISMANTLED, SCRAP, OUT_ON_TEST. Plus a real OrderItem.serializedUnitId link.  _Evidence: SerializedUnit has none of these (schema.prisma:6295-6333). Engine and chassis fields exist only on the shop's own trucks (FleetAsset, schema.prisma:5404-5406)._
- (medium, database change, needs KJ's word) Floor price enforced by the server. The till gets a per-line price entry. Haggling between asking and floor needs no approval. Below the floor needs the owner, and the refusal says 'needs owner approval' without showing the floor.  _Evidence: apps/api/src/orders/price-check.ts:3-22 (it only alerts after the sale); apps/web/store/pos/cart.ts:268 (the line price is always the product price), :348 (setItemDiscount is never called)._
- (medium, database change, needs KJ's word) Sets with child tags (engine plus accessories, lamp pairs, wheel sets, doors with glass and mirror). The parent sells as complete only if every child is still in stock, and selling it sells them all. Breaking a set is owner-only.  _Evidence: There is no parent link on SerializedUnit (schema.prisma:6303-6333)._
- (medium, database change, needs KJ's word) Dismantle job:
- the owner opens it
- each checklist item must become a child tag, or be marked missing with a photo and the owner's approval
- the children's costs add up exactly to the parent's cost, split by asking price
- the shell gets its own tag
- the parent becomes DISMANTLED
- nothing is posted to the books, because value only moves inside inventory  _Evidence: Pattern to copy: apps/api/src/sub-recipes/sub-recipes.service.ts:926, 1124-1131 (value in = value out), 1272-1300 (event trail); apps/api/src/accounting/journal.service.ts:872-878 (no entry for an inventory-to-inventory move)._
- (large, database change, needs KJ's word) Receive a lot:
- supplier name and address from Vendor
- the lump price plus freight, duty, import VAT, broker and trucking
- the expected count from the packing list
- photos of the papers
- one journal entry for the total: Dr 1050, Cr cash, payable or owner
- tags are created against the lot; closing it spreads the cost by asking price
- nothing in the lot sells before it closes  _Evidence: apps/api/src/inventory/dto/adjust-stock.dto.ts:116-118 (only CASH or OWNER_FUNDED); apps/api/src/procure/procure-receipts.service.ts:589-592 (delivery fees are booked as expenses); purchase-orders.service.ts:407-408 (product lines on a PO are not stocked); apps/api/src/accounting/journal.service.ts:958-965 (credit to 2010 is already supported); Vendor name and address at schema.prisma:2532-2540._
- (medium, database change, needs KJ's word) Stored roll call with photos of the tags found. The app picks each day's list: all high-value tags plus about 20 random ones. Only the owner can 'adjust the books to match'.  _Evidence: CycleCountLine requires rawMaterialId (schema.prisma:5168-5184); the owner-only adjust pattern is in the weekly count (station-count.service.ts:243-251)._
- (small, database change, needs KJ's word) Audit actions for tag events (TAGGED, PRICED, SOLD, RETURNED, DISMANTLED, WRITTEN_OFF, FLOOR_OVERRIDDEN, MOVED) and for stock adjustments, in the insert-only audit log.  _Evidence: The AuditAction enum has none of these (schema.prisma:369-401); the log is insert-only per migration 20260628000000_secaudit_je_unique_audit_revoke._
- (small, database change, needs KJ's word) An AUTO_PARTS business type with these defaults:
- owner-only returns on
- purchase costs hidden from staff
- personal e-wallets off for every sale
- the tags menu shown
- selling bin products at zero stock refused  _Evidence: BusinessType enum at schema.prisma:68-88 (no auto parts); BusinessType is the main feature gate (app-suite CLAUDE.md)._

**Shop setup**

- The owner sets a floor price on every engine and half-cut, and on anything over about ₱5,000. For the rest he may use one rule (e.g. 80% of asking).
- From now on, containers are received through 'Receive a lot'. The owner closes each lot the same day or the next.
- Accessories on engines are tagged as children while still attached.

### Phase 4: Owner approvals from his phone and the papers

The owner approves risky actions from wherever he is, without handing out his PIN. The monthly LTO engine register comes straight from the records. Installation jobs and Facebook holds are tied to tags.

**App changes**

- (medium, database change, needs KJ's word) Owner approval requests: below floor, missing component, write-off, dismantle, return, move. Staff send a request; the owner approves or refuses on his phone. Owner-only.  _Evidence: Maker-checker pattern: VoidApproval (schema.prisma:6092-6111). Its approve route also allows BRANCH_MANAGER (apps/api/src/void-approvals/void-approvals.controller.ts:63-68), so the new one must be owner-only._
- (small, no database change) Monthly engine and chassis register for the LTO: engines and half-cuts in (supplier name and address, from the lot) and out (buyer name and address, from the sale), with their numbers, ready to export.  _Evidence: Built on the Phase 3 fields and the lot. Buyer fields: schema.prisma:1708-1712. RA 10883 s.10: https://lawphil.net/statutes/repacts/ra2016/ra_10883_2016.html_
- (medium, database change, needs KJ's word) Job-order part lines must name a tag, and the tag locks when the linked order is paid.  _Evidence: apps/api/src/job-orders/job-orders.service.ts:20-22 (PART lines link to a Product only), :171-182 (link to one order)._
- (small, no database change) HELD for a Facebook deposit, with an expiry date, and OUT_ON_TEST for a test fit, with a due time. The owner is alerted if a tag is not back or sold by closing.  _Evidence: Uses the Phase 3 statuses. The pattern is like ON_RENT (schema.prisma:6298). Deposits as their own order already exist (apps/api/src/orders/orders.service.ts:248-260)._

**Shop setup**

- The owner names a backup approver for days he cannot answer, or accepts that sales below the floor wait for him.
- If he is an LTO-accredited dealer, the bookkeeper files the monthly report from the export.

## Shopping list

- Pre-numbered tie-on tag books with counterfoils (e.g. 0001-1000), in more books than the stock count, kept locked by the owner
- Oil-based paint markers in several colours (one colour per month for the dab) and white or yellow ones for numbers on dark metal
- A metal letter-and-number punch set and hammer, for brackets on engines and heavy parts (never near the engine or chassis number)
- Tire crayons or chalk for inner sidewalls
- Soft tie wire or zip ties for the tags
- Zip bags in several sizes for sensors, relays and small modules
- Numbered plastic bins or crates for small parts, plus seal stickers to write the count on
- A lockable cabinet for ECUs, modules and sensors, and a padlocked scrap cage
- A hanging scale for selling scrap by the kilo
- Shop-owned Android phones with cases and power banks, one per staff member who sells or counts
- A printed GCash/Maya BUSINESS QR stand, and counter signs: 'Pay only to this QR' and 'Ask for your invoice'
- BIR booklet invoices printed under the shop's authority to print, until Clerque holds a PTU
- Optional, recommended: CCTV over the racks and the gate

## The law and BIR

- Engine stock record. RA 10883 s.10 requires anyone who buys or sells engines, engine blocks, chassis or bodies to keep a permanent stock record: type, make, serial number, and the name and address of who it came from and who it went to. A monthly report goes to the LTO (https://lawphil.net/statutes/repacts/ra2016/ra_10883_2016.html). Clerque already stores the buyer on the order (schema.prisma:1708-1712). Phase 1 makes the buyer required for ENG-/HC-/FRM- tags. Phase 4 builds the monthly register.
- Never touch the engine or chassis number. Do not paint over, grind or punch near the engine-number pad or the chassis stamp: altering them is unlawful (RA 10883 s.14). Shop numbers go on brackets, tags and casings well away from them.
- Papers for the buyer of an engine. To register an engine change, the LTO and HPG ask for the original sales invoice, the CSR, often a deed of sale, and an affidavit (https://www.carmudi.com.ph/advice/lto-vehicle-modification-guide-changing-the-engine-unit/; https://ltoportal.ph/change-engine-vehicle/). The buyer must register the change within 20 working days (RA 10883 s.8). So the invoice line carries the engine number, and copies of the CSR and import papers go to the buyer. If the godfather buys from importers, he must collect those copies when he receives the engines.
- Dealer accreditation. Under LTO AO AVT-2014-023, a dealer of engines, chassis or bodies is LTO-accredited, the LTO issues a CSR for each unit, and accreditation lasts one year (https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/75785). Fines for fraudulent stock or sales reports start at ₱500k (https://www.topgear.com.ph/news/motoring-news/lto-erring-car-dealers-a5100-20240415).
- Frame-number pieces. Sell them only with papers, or destroy them on record. Swapping a car's identity and double registration ('kambal') are banned (RA 10883 s.7 and s.15).
- Importing. A DTI-FTEB Certificate of Authority to Import is needed BEFORE shipment for used engines, parts and components (https://importlicensing.wto.org/content/certificate-authority-import-cai-used-motor-vehicles-parts-and-components). Whether a half-cut counts as 'parts' or a 'vehicle' is not settled, so get a written opinion from a broker or DTI-FTEB. BOC has seized whole cars declared as spare parts (https://www.pna.gov.ph/articles/1221564). Clerque records these papers; it cannot certify compliance.
- Invoices. A non-VAT seller must issue an invoice for every sale of ₱500 or more, or whenever the buyer asks. Smaller sales that add up to ₱500 or more in a day get one end-of-day invoice (RR 7-2024 / RMC 77-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024%20Digest.pdf). Clerque prints 'SALES INVOICE' only when the shop holds a BIR permit to use (PTU) and the provider phase is 2. Otherwise it prints an 'ACKNOWLEDGEMENT RECEIPT' (packages/shared-types/src/tenant.ts:304-337). Until then, use a BIR-registered booklet (with authority to print), and Phase 1 records the booklet number on each sale of ₱500 or more.
- Never issue a VAT invoice as a non-VAT shop. If you do, you owe 12% VAT with no input credit, plus a 50% surcharge (https://www.grantthornton.com.ph/insights/articles-and-updates1/tax-notes/clarification-on-the-invoicing-requirements-per-rr-no-7-2024-as-amended-by-rr-no-11-2024/). Clerque already classes a non-VAT shop's lines as VAT-exempt (apps/api/src/orders/orders.service.ts:234).
- Percentage tax. 3% of gross sales, filed quarterly on Form 2551Q (https://gmanetwork.com/news/money/economy/874904/covid-19-pandemic-tax-cuts-expire-original-rates-back-bir/story). Clerque already computes it (apps/api/src/bir/bir.service.ts:300-343).
- VAT line. Once gross sales pass ₱3M in any 12 months, VAT registration is mandatory (https://batasnatin.com/laws/when-is-my-sme-required-to-register-as-vat-bir-threshold-rules). With engines priced in the tens to hundreds of thousands, this can happen within months. Phase 2 adds the warning.
- Import VAT is a cost for a non-VAT shop. Include it, with freight, duty, broker and trucking, in the landed cost spread over the tags (https://angkatph.com/blog/how-to-compute-landed-cost-philippines.html). Splitting a lot's cost by expected selling price is allowed if it is done the same way every time (IAS 2: https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/).
- Consumer rules. 'No return, no exchange' signs are prohibited. The seller answers for hidden defects (Civil Code Art. 1561), and the buyer can claim for 6 months from delivery (Art. 1571) (https://batasnatin.com/laws/hidden-defects-redhibitory-actions).
- Staff theft cases. Qualified theft (Revised Penal Code Art. 310) and PD 133 (https://lawphil.net/statutes/presdecs/pd1973/pd_133_1973.html) need records. The tag photos, the insert-only audit log (packages/db/prisma/migrations/20260628000000_secaudit_je_unique_audit_revoke) and the roll-call history are that record. Phase 3 adds audit actions for tag events.
- Out-of-date comment in the code. The schema still says a NON_VAT shop 'issues Official Receipt' (schema.prisma:357-361). Since RR 7-2024 the invoice is the main document. This is only a comment; nothing prints from it.

## Questions for the shop owner

1. Do you import containers yourself (DTI authority to import, BOC entry, LTO stock report), or buy from importers or consolidators? This decides which papers you must collect for each engine when it arrives.
2. Are you LTO-accredited as a dealer, and do you get a CSR for each engine you sell? Do you file a monthly stock report today?
3. Are you BIR-registered non-VAT, with a booklet of printed invoices? What are your yearly sales compared with ₱3M? Do you pay import VAT?
4. How many staff do you have, and who does what (unloading, stripping, selling, cash, the gate)? Is there anyone you trust with a supervisor PIN, or do you approve every discount yourself?
5. Can you answer a call for your PIN within minutes during the day? If not, who approves when you are away?
6. Will the shop provide the Android phones, or will staff use their own? (Shop phones make photos and logins easier to control.)
7. Above what price should a part get its own number? We suggest ₱500, the BIR invoice line. Which items go in the locked cabinet?
8. How do you mark parts today: paint colour, chalk, numbers? Would staff accept a paint number in two places, a monthly paint dab and two photos per piece?
9. Roughly how many pieces are in stock now? This sizes the one-day 'tag everything' before go-live.
10. How do you cost a half-cut or a container today: a guess, a percentage, or 'get the capital back first'? Would you accept spreading the lot cost by your expected selling prices?
11. Do you keep half-cuts whole and strip them on demand, or strip them as soon as they arrive?
12. What warranty do you give (start test, number of days, what is covered), and how do you handle returns today?
13. Do you sell to mechanics on credit (how many, what limits), install parts or swap engines on site, sell on Facebook with deposits, or deliver with cash on delivery?
14. Is your GCash/Maya a business account with a QR? Do staff ever receive payments on their own phones?
15. Is there one gate someone can watch, and do you have CCTV over the racks and the gate?

## Decisions for KJ

1. Ship Phase 1 straight to master? It is 12 changes, none needing a database change. Recommended: yes. The core is the sell-by-tag lock; the phone till and the cost/notes fixes come with it.
2. Phase 1 changes the tag list for cashiers in shops that are not medical-equipment: cost is hidden, and cashiers look up one tag by its exact number instead of seeing the full list. Medical-equipment rentals keep today's list. Recommended: yes.
3. Tag numbers: use pre-numbered tag books, which the owner holds, instead of a new app number sequence. This drops one enum migration. Recommended: books.
4. Until the Phase 3 floor price exists, every haggle below list needs the owner's PIN through the existing cart discount. Accept the extra calls to the owner for now? Recommended: yes. The other choice is giving a manager a PIN, which weakens the control.
5. Phase 1 stripping rule: a half-cut is stripped at intake or kept whole until the Phase 3 dismantle job ships. Recommended: accept; it keeps Phase 1 free of database changes.
6. Approve the single Phase 3 migration branch:
- tag fields and statuses
- OrderItem.serializedUnitId
- a lot table
- the roll-call record
- AuditAction values
- an AUTO_PARTS BusinessType
Recommended: one branch, one PR, after the godfather answers the costing and dealer questions.
