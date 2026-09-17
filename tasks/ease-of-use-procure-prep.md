# Ease of use: one-tap buy list from the kitchen screen, and prep-level warnings

> KJ, 2026-09-16: "the best selling point in human perspective is the ease of using it ... one click button for all of the purpose ... end of day, these are the ingredients used, these are the ingredients needs to be bought tomorrow morning ... premade ingredients should have early warning"

## KJ's answers to the first design (2026-09-16) -- these override the design below where they differ

1. **The kitchen account is the kitchen/bar station screen.** It shows its orders and the running balance of the pre-made ingredients, plus ONE button to request what is running low. Clerque consolidates everything (low now, what the preps need, tomorrow's expected use, minus what is already on a list or on the way, no duplicates, never lowering a typed amount) into one list and sends the owner ONE message. A later tap sends only what is new.
2. **Levels:** Level 1 = what you serve from; Level 2 refills it; Level 3 makes Level 2.
3. **Closing-time fail-safe:** the owner sets each branch's closing time. If nothing was sent by closing, Clerque sends tomorrow's list by itself. Needs a closing-time field per branch (schema change) -- **KJ approved 2026-09-16** ("yes, do the closing time setting"); branch `branch-closing-time`.
4. **Daily "ingredients used" report** (KJ, 2026-09-16: staff write it by hand every day). The report exists (Inventory > Ingredients > Reports > Consumption) but walks only the product recipe (misses sizes and add-ons). Make it exact and send it to the owner at closing time.
5. **Non-ingredient items** (KJ: "should there be a + button?"): yes -- a + on the kitchen request to add anything by hand. Supplies already have a home: RawMaterial.category KITCHEN_SUPPLY / BAR_SUPPLY / OFFICE_SUPPLY. Cups, lids and straws used in recipes are counted automatically; tissue, soap and the like are not tied to sales, so they come from the + (pick a saved supply, or type a new one) or from a low level if set.

## Build order

- [ ] 0 Check stock stops re-adding items already on a SENT or BOUGHT (on the way) list.
- [ ] 1 Usage reader + plan engine (shared-types buy-plan.ts) + GET preview. No UI.
- [ ] 2 Station screen: "Request what's running low" button -> consolidate -> one owner message (bell, email, Telegram); updates send only new items.
- [ ] 3 Closing-time setting per branch + the fail-safe job (needs KJ's schema OK).
- [ ] 4 Prep depth from the sub-recipe graph (size recipes and add-ons count), chain data on the station prep API.
- [ ] 5 Station prep cards with Level 1/2/3 lines and one Made button; alerts switch to one per chain.

---

## First design (study workflow wf_05fbef6b-0ef), kept for the numbers and file map


Summary: this needs **no schema change**. It adds two pure rule files in shared-types, one usage reader, one new service, one evening job, three new routes and three screen changes. Everything is worked out from sales × the current recipe, which is the same recipe walk the hold and the ready tap already use. Build it on top of Stage 2 (held-usage.ts) after that branch is merged.

One principle has to relax. The code refuses thresholds nobody chose (procure.service.ts:436-455, prep-rotation.ts:19-22). The new numbers are not invented: they come from the shop's own sales, and every line says why it is there ("Thursdays use about 9 L"). Memory already lists "Auto-detected low-stock from sales velocity (no manual reorder points)" as a locked build item (project_clerque.md, "What we DO build").

---

## 1. Tomorrow's list (one tap)

### What the screen shows, per branch
1. **Buy tomorrow morning.** Each row shows:
   - the item, with a big amount in packs: "9 packs (9 L)"
   - one grey "why" line: "Used today 8.1 L · Thursdays use about 9.2 L · have 3.1 L · 0 on the way"
   - a − / + stepper (one pack per tap, no typing)
   - an estimated cost, and a total on the Send button. Cost is hidden from staff when `costsVisibleTo` says no (procure.service.ts:187-190).
2. **Make tomorrow morning** (preps are made, not bought): "Sugar syrup: make 2 batches". The sugar they need is already inside the Sugar row above ("+2 kg for Sugar syrup").
3. **Check these:** on the menu, out of stock, no sales history. "Oat milk: out, no sales yet. Add 1 pack?" The row is ticked if Clerque knows the pack size and unticked if it doesn't.
4. **Already on the way** (collapsed): items left off because a SENT or BOUGHT list already covers them.
5. **Used today** (collapsed, mainly for the owner): every ingredient, split into sold, into preps and thrown out.

### The exact rule (base units; all constants are in one file and can be tuned)
- **Planned day.** Tomorrow in Manila. Before 10:00 with no sale yet today, it means today. If a weekday had no sales on any of its last 4 occurrences (the shop was closed), skip to the next weekday that had sales.
- **Direct use of a day** = Σ over paid lines (orders PAID or COMPLETED, `deletedAt` null, bucketed by the Manila day of `paidAt`) of (quantity − refundedQty) × `recipeUsagePerUnit` via `loadLineRecipes` (line-recipes.ts:17-75, recipe-usage.ts:43-66).
  - This covers sizes, add-ons and prep items like syrup.
  - Lines still waiting count as used. That matches `available = book − held` (held-usage.ts:89-91), so nothing is counted twice.
  - Reading lines instead of COGS payloads avoids the stock-capped undercount (usage-confirm.ts:127-134).
- **Expected use of day D:**
  - the mean over the last 4 same weekdays that had sales, when there are at least 2 such days;
  - otherwise the mean over the last 7 days that had sales;
  - otherwise 0 (no history).
- **Days to cover** come from the usual store in pack memory (procure.service.ts:1702-1725):
  - market, grocery, other or unknown: 1 day
  - supplier: 3 days
  - online: 5 days

  Direct demand = Σ expected use over those days × **1.25** (safety margin).
- **Preps are exploded through the sub-recipe graph, shallow to deep:**
  - prepDemand(P) = direct demand(P) + amounts pushed down from its parents
  - make = max(0, prepDemand − available(P))
  - batches = ceil(make / batchYield)
  - each component c gets batches × qty(c) pushed onto it

  Pushed amounts are summed, so a component two preps share is counted correctly. The safety margin is not applied a second time. A prep with no batchYield goes to "Check these".
- **Raw items:** need = (direct demand + pushed) − available − on the way.
  - available = book − held
  - on the way = unreceived qtyRequested on this branch's SENT lists + packsBought × packSize (or qtyRequested) on BOUGHT lines not yet received, leaving out the list being updated.
- **Reorder levels still count.** If `lowStockAlert` is set and available ≤ that level, need = max(need, today's rule of shortfall × 2, or the level itself) (procure.service.ts:411-413). Today's Check stock behaviour stays a subset.
- **No history:**
  - Used by an active recipe (directly or through a prep), available ≤ 0, nothing on the way: one pack, listed under "Check these".
  - Anything else with no history and no reorder level: left off.
- **Rounding:**
  - packs = max(1, ceil(need / packSize − 0.10)). A 10% overshoot doesn't buy another pack, because the 1.25 margin already covers it.
  - No pack memory: round up to the next 100 g or ml, or the next whole piece.
  - Because amounts are whole packs, the existing "N packs" wording now shows up on the list, email and Telegram (procure.service.ts:518-524).
- **Estimated cost** = packs × last packCost, or amount × costPrice when there is no pack memory.

### Who taps, and what one tap does
- **Who:** everyone who can open Procure (the 7 roles at procure.controller.ts:46), plus a paired bar or kitchen screen through a KDS route. For staff it is "Send to owners". For the owner it is the same button.
- **`POST /procure/requests/tomorrow`** with `{ branchId?, changes?: [{rawMaterialId, packs}] }`:
  1. The server works the plan out again. Client numbers are ignored except the stepper changes.
  2. **Which list:** the branch's newest SENT list sent in the last 18 h with nothing bought or received on it. Otherwise the OPEN list (`openRequestRaw`, procure.service.ts:241-256). One shopping trip stays one list.
  3. **Upsert per item** (unique purchaseRequestId + rawMaterialId, schema.prisma:5875):
     - quantity = max(existing, planned), so a number a person typed is never lowered;
     - a stepper change wins, and 0 removes the line;
     - `shortBy` = the need before rounding;
     - lines added by hand or carried forward (1186-1228) are left alone.
  4. Tag notes `[PLAN:2026-09-17]` with `withTag` (procure-notes.ts:64-69).
  5. **Send.** An OPEN list goes to SENT through the existing send path (468-483): PDF, `tellTheOwners`, bell, email, Telegram `buyListSent`. An already-SENT list gets a fresh PDF and an "updated: +3 items" notice, but only if something changed.
  6. **Double taps and repeats:** a second tap finds the same numbers and sends nothing ("Already sent. Nothing new."). An empty plan still sends the all-clear, as today.
- **Permission change:** staff can send, but only through this endpoint. The manual Send, Post to stock and Cancel buttons stay owner, manager or MDM.

### When it is offered
- **Always:**
  - a top card on Procure home above the shortage banner (apps/web/app/procure/page.tsx:197-236): "Tomorrow's list · 12 to buy · Send";
  - a "Tomorrow's list" button in the station header (apps/web/app/pos/station/[id]/page.tsx:312-383).
- **From 18:00 Manila** both turn amber and show the count.
- **When the last open shift at the branch closes:** CloseShiftModal shows one big "Send tomorrow's list" button. The API returns `lastShiftOfDay`, using the same `stillOpen === 0` test as the Z-Read hook (shifts.service.ts:332-337).
- **21:00 Manila job:** for each branch with sales today and no `[PLAN:tomorrow]` list sent today, it builds the plan and sends a reminder:
  - Telegram (existing 'buying' topic): "Tomorrow's list for Thu: 12 items, about ₱3,450" with the top lines in packs, the "Make tomorrow morning" lines and a link;
  - a bell to owners, managers and that branch's prep staff.

  It never sends the list by itself unless env `TOMORROW_LIST_AUTOSEND=on`.

---

## 2. Prep chain early warning

### Levels, without new data
- **Which recipes count.** Today only product recipes do (sub-recipes.service.ts:180-199). Add size recipes (VariantBomItem) and add-on ingredients (ModifierOptionIngredient). A syrup pumped as an add-on then gets a level, a station and servings.
- **Depth.** A new `depth` field:
  - 1 if a product, size or add-on uses the prep;
  - otherwise 1 + the smallest depth among the preps that use it;
  - null if nothing reaches it (cycle-guarded like `available()` at 222-245).
- **Numbering.** People see "Level N" = depth. Level 1 is served from, Level 2 refills it, Level 3 makes Level 2. The existing `level` (1|2|null, 387-389) stays as it is, so rotationFromBoard, prepStatusOf and the badges don't break.
- **Chain.** Starting at each Level 1 prep: the next stage is the prep component that runs short first (the same `tightest` rule as prep-rotation.ts:98-102). Stop when a stage has no prep component, or at depth 4.

### Numbers
- **perServing:** Level 1 used ÷ units sold that used it, over the last 7 days. Fallback: serves[0].perServing.
- **Servings per stage:**
  - s1 = available1 / perServing;
  - for k ≥ 2: s_k = available_k × f_k / perServing, where f_k chains each step's yield ÷ the amount going in (a MOVE gives 1:1);
  - cum_k = s1 + … + s_k.
- **Pace** (servings per hour) = max(last 60 minutes of sales, same weekday and same hour over the last 4 weeks). It is only trusted with at least 3 servings in the window; otherwise it is null. Cached for 60 s per branch.

### Rule (constants can be tuned)
- **Level 1 needs action** when s1 ≤ max(**2 servings**, pace × 0.5 h), or it is at or below its par (the existing test).
- **Level k ≥ 2 needs action:**
  - with a known pace: cum_k < pace × H_k, where H2 = 2 h, H3 = 8 h, H4 = 24 h;
  - without a pace: Level k can't cover one more refill of Level k−1 **and** Level k−1 needs action;
  - or it is at or below its own par.
- **Wording, one line per stage that needs action, top down:**
  - L1: "Caramel (Level 1): about 2 servings left. Refill from Caramel backup (Level 2)." A MAKE made from raw ingredients says "Make a batch now."
  - L2: "Caramel backup (Level 2) running low. Make it now from Caramel base (Level 3)." A MOVE says "Move one batch across from Caramel base."
  - L3: "Caramel base (Level 3) low. Make a batch now."
  - Blocked at a raw ingredient (`rootLimitedBy`): "Out of Sugar. Buy it now." The item is also flagged "Buy today" at the top of Tomorrow's list.
- **The one clear instruction** is the shallowest stage that needs action and can be done now. If Level 1 is blocked, it is the shallowest deeper stage that unblocks it. If nothing can be done, it is "Buy {raw}".

### Where it shows
- **Station prep column:** one card per chain.
  - Up to 3 stage rows, each with a dot: red = Level 1 now, amber = make next, green = OK, grey = no data.
  - Level 1 also shows "~25 min".
  - One big button for the headline: "Refilled from Level 2", or "Made Level 2".
- **Bell alert:** one per chain.
- **Tomorrow's list:** at 21:00 the "Make tomorrow morning" section comes from the same graph.

### Avoiding nagging
1. One alert per chain, not per stage. Deeper stages are lines in the body.
2. Title and body carry no live numbers. Titles are "{P1}: refill from Level 2", "{P2}: make Level 2 now", "{P3}: make Level 3 now" or "{P1}: buy {raw}".
3. Dedupe with `prep-chain-{P1}`, since the later of Manila midnight and the newest lot on **any** stage of the chain. Only a recorded move or batch makes it news again. Flapping around a threshold can't repeat the alert (same mechanism as prep-rotation.scheduler.ts:96-120).
4. Pace-based triggers fire only if the branch sold something in the last 60 minutes, and never after 20:00. After that they roll into "Make tomorrow morning". Par-based triggers keep today's window.
5. For Level 1 chains, the scheduler sends the chain alert **instead of** the rotation alert, so one sauce is never alerted twice.
6. The station bell still rings only for EXPIRED, OUT or DO_NOW (StationPrepLevels.tsx:82-83). DO_NOW now means a Level 1 headline. A new amber status `MAKE_NEXT` ("Make next") never rings.

---

## 3. Screens

**Staff (kitchen, bar, cashier at close)**
- **Procure home:** a big top card, "Tomorrow's list · 12 to buy · [Send to owners]". Tap opens the list.
- **Tomorrow's list** (page `/procure/tomorrow`; the same component is used as a full-screen sheet):
  - heading "Tomorrow's list · Thu, Sep 17";
  - the 5 sections from §1, with − / + steppers and no typing;
  - one wide green button at the bottom: "Send to owners (12 items)". It adds "· about ₱3,450" when costs are visible.
  - After sending: "Sent to Anne. 12 items." If nothing changed: "Already sent. Nothing new."
- **Station screen header:** a "Tomorrow's list" button (amber with a count after 18:00). It opens the sheet. The KDS route works for paired screens too.
- **Station prep column:** chain cards as in §2, with one big action button per card.
  - It is disabled when the stage can't be made yet, and then shows the stage to do first.
  - The button records one batch with the default yield and an idempotency key.
- **Close shift success panel** (last shift of the day): "Send tomorrow's list". One tap opens the sheet.

**Owner**
- **Receiving costs zero taps.** Telegram, bell and email carry the list in packs, the "Make tomorrow morning" lines and the estimated total.
- **21:00 reminder** if nobody sent the list: Telegram and bell with a link. One tap opens the list, one more sends it.
- **The request page** only gains a "Planned for Thu" chip, read from the `[PLAN:]` tag. Shopping, record-bought and post-to-stock are unchanged, and the pack pre-fill now matches exactly.

---

## 4. API and data changes

**Schema: none.** Optional later changes, each of which needs KJ's OK first:
- a per-branch list time (the 21:00 is fixed in code for now);
- a "ready in N minutes" per prep (thaw lead time);
- an `Order[tenantId, branchId, paidAt]` index, only if the preview takes over 1 s on live data.

**shared-types (pure, with specs, exported from index.ts)**
- **New** `packages/shared-types/src/buy-plan.ts`:
  - `expectedUse(history, day, coverDays)`, `packsFor(need, pack)`, `planPurchases(input) → { buy[], make[], check[], onTheWay[], total }`
  - words: `planWhy(line)`, `planMessageLines(plan)`
  - constants: SAFETY 1.25, WEEKS 4, PACK_SLACK 0.10, COVER_DAYS by source
- **New** `packages/shared-types/src/prep-chain.ts`:
  - `prepDepths(rows)`, `chainsFromBoard(board, pace)`, `chainHeadline`, `chainLines`, `chainAlertTitle`
  - constants: L1_MIN_SERVINGS 2, HORIZON_H [0.5, 2, 8, 24], MIN_PACE_SAMPLES 3
- **Edit** `prep-station.ts:68-106`: add `MAKE_NEXT` to PrepStatus, its order, its label, and to `prepStatusOf`, which takes an optional chain.

**api**
- **New** `apps/api/src/procure/usage-history.ts`:
  - `directUseByDay(db, tenantId, branchId, from, to)`: lines × `loadLineRecipes`, bucketed with `manilaDay` (usage-confirm.ts:38-42)
  - `usedToday(...)`: adds SUB_RECIPE_BATCH `consumed[]` by madeAt (sub-recipes.service.ts:1155-1195) and negative marker lots (inventory.service.ts:1745-1759)
  - `onTheWay(db, tenantId, branchId, excludeRequestId?)`
  - `paceOf(db, tenantId, branchId, prepIds, now)`
- **New** `apps/api/src/procure/tomorrow-list.service.ts`:
  - `preview(tenantId, branchId, viewerRole)` (cached 60 s)
  - `apply(tenantId, branchId, userId, changes)`: picks the list, upserts raise-only, tags, then sends or updates
- **Edit** `procure.service.ts`:
  - `pullLowStock` subtracts `onTheWay` (fixes the double order, 350-414)
  - `tellTheOwners` gets an `updated` mode with its own title and dedupeKey (492-553)
  - `lastPacks`, `openRequestRaw` and `fileRequestPdf` become callable from the new service
- **Edit** `procure.controller.ts`: `GET /procure/requests/tomorrow` and `POST /procure/requests/tomorrow`, declared before `:id`, open to all 7 Procure roles.
- **Edit** `kds.controller.ts`:
  - `GET /kds/stations/:id/tomorrow` and `POST /kds/stations/:id/tomorrow`: devices must be KDS_*, and the branch is the pairer's, as at 58-65.
  - `POST /kds/stations/:id/prep/:rawMaterialId/made`: a device is limited to its own station, and the prep must be routed to that station or unrouted. It calls `subRecipes.makeBatch` with batches 1, stationId and the client idempotency key.
- **Edit** `sub-recipes.service.ts`:
  - the feeds read also covers size recipes and add-ons (180-199)
  - add `depth` (after 291-296)
  - `stationPrep` returns `chains` with pace (545-598)
- **Edit** `prep-rotation.scheduler.ts:91-127`:
  - chain alerts replace the rotation alert for Level 1 chains (dedupe since the newest lot on any stage)
  - pace-based triggers only while selling and before 20:00
- **New** `apps/api/src/procure/tomorrow-list.scheduler.ts`: `@Cron('0 21 * * *', { timeZone: PH_TIMEZONE })`, reminder by default, `TOMORROW_LIST_AUTOSEND=on` sends.
- **Edit** `telegram/telegram-alerts.service.ts` and `telegram/messages.ts`: `tomorrowListReady(...)` on the 'buying' topic. The "sent" message adds the "Make tomorrow morning" lines and the estimated total.
- **Edit** `shifts.service.ts:331-352`: the close response adds `lastShiftOfDay`.

**web**
- **New:** `apps/web/app/procure/tomorrow/page.tsx` and `apps/web/components/procure/TomorrowListSheet.tsx`.
- **Edit:** `apps/web/app/procure/page.tsx` (top card), `apps/web/app/pos/station/[id]/page.tsx` (header button), `apps/web/components/pos/StationPrepLevels.tsx` (chain cards and the Made button), `apps/web/components/pos/CloseShiftModal.tsx` (success button), `apps/web/app/procure/requests/page.tsx` ("Planned for" chip).

---

## 5. Build order (no migrations, so each step goes straight to master under the no-PR rule, after Stage 2 is merged)

1. **Check stock subtracts what is on the way.** Test on carolina-test:
   - Check stock, Send, Check stock again: nothing sent is added again.
   - Record a purchase as on the way, then Check stock: still nothing added.
2. **Usage reader, plan engine and `GET /procure/requests/tomorrow`** (no UI).
   - Specs: same-weekday mean, fallback, closed days, 3-deep explosion with a shared component, pack slack, on-the-way subtraction, reorder-level floor, cover days by store, no history.
   - Live: back-dated test sales on the local test shop only. Check three items by hand: milk (direct), sugar (through syrup) and an item with no history.
3. **Tomorrow's list screen, the one-tap POST, staff sending and the Procure home card.** Live:
   - The kitchen account taps: the owner gets a bell, an email and a Telegram message through fake_telegram.js.
   - A double tap sends one message.
   - A new sale followed by a tap sends "updated" with only the change.
   - The owner adds a pack, the plan is run again, and the amount is not lowered.
   - Staff see no costs when the shop hides them.
4. **Close-shift prompt and the 21:00 reminder.** Live:
   - Closing the last shift shows the button; closing a non-last shift doesn't.
   - Run the scheduler method with a 21:00 `now`: it stays silent when the list was already sent or there were no sales today.
5. **Depth, size and add-on feeds, and chain data in the station API.** Live:
   - Build a Level 3 → Level 2 → Level 1 caramel chain, with Level 1 used as an add-on pump.
   - Call `GET /kds/stations/:id/prep` in four states: Level 1 at 2 servings, Level 2 empty, Level 3 empty, sugar at 0. Check the headline and the lines each time.
   - The existing rotation and badge specs must stay green.
6. **Station chain cards, the one-tap Made button and the header button.** Live:
   - Barista login and paired device token; a wrong station is refused; a double tap makes one batch.
   - The bell rings only for Level 1.
   - Look at it on screen at 1280x800, 1024x600 and 375x812.
7. **Alerts switch to the chain rule.** Live:
   - Run `alertTenant` with set times: one alert per chain, no repeat until a batch is recorded.
   - No pace-based alert after 20:00 or with no sale in the last 60 minutes.
   - No duplicate rotation alert.

---

## 6. Questions for KJ

1. **Can kitchen and bar staff (and the cashier at close) send tomorrow's list to the owners themselves with one tap?** Recommended: yes. Sending only tells the owners; buying, posting to stock and money stay with the owner or manager.
2. **Level numbering: is Level 1 what you serve from, Level 2 the backup that refills it, and Level 3 what Level 2 is made from?** Recommended: yes. It matches how the app already numbers them, and the reverse numbering in the Carolina code comment goes away.
3. **At 21:00, if nobody has sent it, should Clerque only remind the owner or send the list by itself?** Recommended: remind for the first 2 weeks while Anne checks the amounts, then switch on auto-send.
---

## Daily inventory sheet on the kitchen and bar screens (KJ, 2026-09-16)

> "no costing for them. what they are doing is doing the report manually ... there is the beginning and end
> report ... trying to remember yesterday's sales, they are writing the usage per ingredient level according to
> the orders. that is very clerical ... do that button report for them. also, lets have that same kind of report
> where we can report the beginning balance and ending balance aside from the ingredients used."
> "also, consider how this would affect the pre made ingredients"

**Their paper today** (scans 08242026 kitchen.pdf / Bar.pdf, rendered in Downloads/carolina_pages): one sheet per
station, KITCHEN INVENTORY and BAR INVENTORY, grouped in sections (kitchen: herbs & spices, raw materials, fresh
goods, frozen dairy/meat/seafood/chips, COOKED/PORTIONED MATERIALS = pasta and meat servings, sauces, toppings,
rice, sandwich spread, packaging; bar: disposables, liquids, raw materials incl. syrups and White Sugar Syrup, tea
bags & sachets). Columns: **Remaining | Trans In | Waste | Used | Ending** (packaging: Sold). Amounts written as
packs plus loose ("12 PKS / 815 g", "6 CANS / 263.3 g", "58 SERVING"). NAME and Signature at the bottom.

**KJ approved (2026-09-16)** a new table for a daily saved balance ("Yes, add it"): Clerque has no raw-material
movement ledger (InventoryLog is products only), so a trustworthy Beginning needs yesterday's Ending saved.

**Design**
- Table `stock_day_balances`: tenantId, branchId, rawMaterialId, day (Manila business day), endingQty, takenAt;
  unique (branchId, rawMaterialId, day). Saved at the branch's closing time (same job as the usage message;
  business day before 04:00 = previous day); a branch with no closing time is saved at 23:55 Manila.
  Idempotent upsert; a late save records its real takenAt.
- A day's sheet covers the window from the previous save to this save (today: previous save to now).
  Beginning = previous save; Ending = this save (today: live stock); In = received/posted purchases, transfers in,
  prep batches made; Waste = write-offs + made items voided/refunded; Used = sold through recipes + used into preps;
  **Adjust** = Ending - (Beginning + In - Waste - Used), shown only when not zero (counts, corrections, transfers
  out, anything untracked) -- the sheet always adds up and nothing is hidden. First day without a save: Beginning
  worked back from Ending, marked "no saved balance yet".
- **Pre-made ingredients**: a prep is its own row. In = batches made (a move from Level 2 to Level 1 is Used on
  Level 2 and In on Level 1); Used = orders that use it + preps made from it; Waste = expired or written off.
  A raw ingredient's Used includes what went into preps, so cream is counted once, when the sauce is made -- not
  again when the pasta sells (sales walk the recipe line "30 g sauce", never the sauce's components).
  Preps counted in servings show servings.
- **Station rows**: ingredients reachable from recipes of products routed to this station (through preps), preps
  whose station is this one, and supplies of the station's kind (KITCHEN_SUPPLY / BAR_SUPPLY). Stock is per branch,
  so an ingredient both stations use shows on both with the branch's balance and a "shared with Bar" note.
  Sections: Pre-made, Ingredients, Supplies.
- **No costs anywhere on the station sheet.** Amounts in packs + loose from pack memory, else humanised units.
- **Button**: station screen header "Today's inventory" -> full-screen sheet, Yesterday/Today arrows, Print (A4,
  like their paper, with Name and Signature lines). API `GET /kds/stations/:id/daily-inventory?day=`, same guard as
  the prep route (KDS devices only, own station, branch of the pairer).
- Owner: the same sheet for all ingredients under Inventory > Reports, with value; the closing message links it.
