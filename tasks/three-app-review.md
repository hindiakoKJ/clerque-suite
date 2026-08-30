# Counter / Ledger / Procure — full review (2026-08-30)

Six independent readers traced the three apps, the seams between them, the
kitchen question and ease-of-use; a skeptic then tried to refute every claim
against the code, and refuted findings were dropped before this was written.
13 agents, ~2.3M tokens.

**Already fixed since this ran** (commit "Four things a kitchen breaks"):
must-fix #2, the AP bill written net with zero VAT — this review found it
independently, which is a useful cross-check on both passes.

Everything below is the report as returned.

---

# Clerque — Pre-Go-Live Review for Cafe Carolina

*Three apps, one flow, read against the actual code. Every claim below cites the file and line it came from. Items marked **{known}** are already written down in `tasks/`; everything else is new.*

---

## 1. THE ANSWER

The engine is in better shape than the wiring. Money maths, stock maths and double-entry posting are careful, transactional and well-tested — a sale cannot record revenue without its stock and cost entries riding in the same database transaction (`orders.service.ts:510`). What is not ready is a short list of connections that were built on one side and never finished on the other: **nothing in the product ever writes a Z-Read** (`reports.controller.ts:153` has no caller anywhere in the web or Counter apps), **paying a supplier bill is refused by the system's own guard** (`ap-bills.service.ts:265`), and **a promotion crashes checkout** (`terminal/page.tsx:266`).

The single thing most likely to bite: **you cannot record paying a supplier.** Procure already puts every credit delivery INTO Accounts Payable, and the only screen that takes it back out returns a 403. Account 2010 grows forever from the first Net-30 delivery and the balance sheet is wrong from day one. It is a one-argument fix, but it is not optional.

Verdict: **not yet, but close.** Six fixes below are days of work, not weeks. Nothing found requires a redesign.

---

## 2. THE FLOW — one day at Cafe Carolina

**7:00am — barista opens her shift.** Works. Opening cash is captured, the shift is tenant- and cashier-scoped (`shifts.service.ts:125`), and a shift left open from yesterday is auto-closed. **Thin:** that auto-close writes no drawer count, no variance, nothing (`shifts.service.ts:98-101`) — so a forgotten Close Shift means yesterday's cash is never reconciled and nobody else can close it for her (`shifts.service.ts:154`).

**7:20am — first latte.** This is the best-built path in the suite. The order, the milk deduction, the SALE event and the COGS event all commit together (`orders.service.ts:510`). Payments must sum to the total or the sale is refused (`orders.service.ts:213`). Cash goes to 1010, GCash to 1031 with a settlement path that clears it (`journal.service.ts:497`). Over-tender prints the right change. Offline? The till queues to a local database with a 30-second timeout and re-syncs (`terminal/page.tsx:374`).

**9:00am — the owner jumps on the till at the rush.** **Broken.** The owner bypasses the shift gate entirely (`ShiftGate.tsx:157`), so every sale he rings carries `shiftId: undefined` (`terminal/page.tsx:231`). His cash goes in the same physical drawer but not into the barista's expected cash (`shifts.service.ts:474`). At close the drawer counts over, the system books the overage to the GL as income, and the barista is asked to sign for a surplus she cannot explain. (The Z-Read and the general ledger *do* pick these sales up — they are date-scoped, not shift-scoped. Only the drawer reconciliation loses them.)

**11:00am — a wrong drink is refunded, ₱180 cash back.** **Broken.** The ledger correctly credits cash (`journal.service.ts:655`), but nothing in `shifts.service.ts` or `reports.service.ts` ever reads a refund — grep returns zero hits. Expected cash still includes the full original sale (`shifts.service.ts:516`), so the drawer reads ₱180 short and a shortage is posted against her name. Your own help text already promises the opposite: *"expected cash (= opening cash + cash sales − refunds − paid-outs)"* (`help/page.tsx:86`).

**2:00pm — the grocery run.** Procure is good here. The buy list assembles itself from real reorder levels and asks for twice the shortfall so the item actually clears the flag (`procure.service.ts:185`). It asks how many packs, what one pack holds, what one pack cost, and does the arithmetic — no spreadsheet. It asks in plain words whether you paid out of pocket or from the till, because the two post to different accounts (`requests/page.tsx:622`). Receiving is idempotent on the line's control number (`procure.service.ts:296`), one receipt updates on-hand, the lot, the weighted-average cost and every affected drink's cost in the same transaction (`inventory.service.ts:1568`), and the debit is routed by category so bleach goes to 6210 and never touches COGS (`material-accounts.ts:52`).
**Thin:** miss one box in the grid and that line is stripped client-side before it is ever sent (`requests/page.tsx:200`) — the server would have said "What does one pack hold?", but it never gets the chance. The toast says "Shopping recorded." either way. Once the request is at BOUGHT there is no Save button any more (`requests/page.tsx:612`), so a wrong price cannot be corrected and the control numbers are burned. **{known}**

**5:00pm — the delivery was on terms.** **Broken, two ways.** The general ledger says you owe ₱1,120 (gross, `journal.service.ts:871`); the AP bill written in the same breath says ₱1,000 with VAT hard-coded to zero (`inventory.service.ts:1692`). And that bill cannot be corrected — it is created already-OPEN with no journal entry, so void throws "no posted JE to reverse" (`ap-bills.service.ts:320`) and cancel only accepts DRAFT (`:348`). Then when you go to pay it, the payment screen 403s (`ap-payments.service.ts:160`). Twelve percent of every credit delivery strands in Accounts Payable permanently.

**10:00pm — close.** The EOD panel is right. But **no Z-Read is ever written** — `POST /reports/z-read` exists, is correct, is idempotent per branch per day, and has no caller in `apps/web` or `apps/counter`. The Z-Read History report in Ledger reads a table nothing writes (`export.service.ts:2159`). You are VAT-registered; this is the record the BIR expects a CAS to keep.

---

## 3. THE THREE APPS

### COUNTER — ready, with three wires to reconnect
**Works:** the transaction spine, payment reconciliation, VAT assertion against your registration, race-safe order numbering with self-heal, bcrypt supervisor PIN for voids that refuses to guess between two matching PINs (`orders.service.ts:1885`), voids scoped to the sale's own calendar day so an 11:55pm drink bumped at 12:05am stays on yesterday (`:1391`), modifier substitution netted per ingredient and floored at zero so an oat latte consumes no whole milk (`:1006`).
**Does not work:** Z-Read never written; a promotion 500s the whole cart; the owner sells outside any shift; refunds invisible to the drawer; the dashboard's gross profit is computed from a hand-typed `Product.costPrice` while the ledger uses real ingredient cost — the code's own comment at `orders.service.ts:810` warns about exactly this and the reports path does it anyway.

### LEDGER — the posting engine is genuinely good; the sub-ledgers are not wired
**Works:** every entry balance-checked to the centavo before it is written (`journal.service.ts:74`), posted entries immutable except by reversal, revenue split per line with the last group absorbing the rounding remainder so a discount can never unbalance an entry (`:510`), Output VAT credited only when the sale actually carries VAT, COGS relieving the same account receiving capitalised into, a count gain that cannot fabricate equity (`:806`), year-end close refusing to run over an unposted queue (`:1502`), a reopen that demands a written reason and keeps the original close as history.
**Does not work:** posting a vendor bill, paying a vendor bill and posting a customer invoice are all refused by the posting-control guard because three services forgot one argument. Expense claims never touch the ledger at all (`expense-claims.service.ts:280` — zero journal references in the whole directory) while the close checklist tells you they will "leak across periods". The Cash Flow Statement reports total assets as cash, because every seeded asset sits in the 1000–1099 band the code treats as cash (`accounts.service.ts:904`) — and it still reconciles, so there is no warning. A failed accounting event is never retried automatically (`accounting.scheduler.ts:26`), and the "Quick Close" button whose tooltip says *"Skip the checklist"* can manufacture them in bulk.

### PROCURE — the buy-to-receive half is strong; the counting half is dangerous
**Works:** control numbers, no double receive on a repeat, cancel refused once anything is in stock, Manila-dated request numbers, per-line posting so one bad line does not cost the delivery, transfers that claim their status atomically.
**Does not work:** **a cycle count posted while the shop is open charges the same consumption twice.** The expected quantity is snapshotted when you start the count (`warehouse.service.ts:307`) and the variance is computed against that stale number at post time (`:389`). Sell 40 lattes during the count and 8,000 ml of milk is relieved once as COGS at the till and again as a count shortage — 1051 goes negative, the write-off line grows with losses that never happened, and every entry balances so the trial balance still foots. The count also ignores the period lock (`warehouse.service.ts:16` injects no periods service), pre-fills the system's own answer so an untouched line posts as "verified" (`:311`), and cannot be flagged as opening stock — the flag exists in the API and no screen sends it (`cycle-counts/page.tsx:36`), so a first count credits the whole opening value to 5060 Inventory Write-off, i.e. invented profit on your first BIR income statement.

---

## 4. THE KITCHEN QUESTION — answered directly

**Will rice bowls work? The selling half, yes. The prep half, no.**

**What is genuinely fine, verified by reading it:** one ticket mixing a latte and a rice bowl works — stock is a single per-branch map and both recipes resolve against it (`orders.service.ts:915`). A 15-line recipe costs the same database round trips as a 3-line one (`products.service.ts:697`). Recipe cycles are rejected by a full breadth-first walk. Food modifiers net correctly — "no egg" costs nothing, "extra rice" cannot double-drain. Food routes to a kitchen station, the KDS screen has a chime, a wait timer and per-tablet printing, and the cook's device can reach it. Ingredient count is uncapped on your plan. Kitchen stock capitalises to 1051 and comes out of 1051.

**What you would SEE go wrong, concretely:**

1. **The sauce never depletes.** Batch prep has a working API and **no screen anywhere** — grep for `sub-recipes`, `batchYield` or `/batches` across the whole web app returns zero (`sub-recipes.controller.ts:50`). So you create "House Sauce" as an ingredient, the cook makes five litres, and the tomatoes and garlic sit at their opening quantity forever. They never trip a reorder alert, never reach a buy list, and you run out mid-service while the system insists you hold eight kilos. **{known}**
2. **Units will bite, and this is the honest answer to what you asked.** Real unit conversion exists in exactly one place: the spreadsheet importer (`import.service.ts:2755`). Everywhere else the unit is a free-text label a human must obey — the receive form has no unit field at all (`receive-raw-material.dto.ts:8`), recipe lines have no unit column (`schema.prisma:1426`). Worse, Settings → Units of Measure shows Gram → Kilogram at 0.001 and is wired to Products only, never to ingredients (`schema.prisma:2247`) — so it looks like the system converts. It does not. **Type 250 against rice defined in kg and you put 250 kg of rice in one bowl; the first sale zeroes the shelf and books a five-figure COGS.**
3. **Large and Regular cost the same.** Variant recipes are written by an endpoint with no screen and read by nothing that consumes or costs (`orders.service.ts:915` queries `bomItem` only). Model the bowl as Regular/Large variants and the Large sells higher, deducts the same 200 g and posts the same COGS. Margin on the Large reads great. No error.
4. **New ingredients are free until first received.** An ingredient with no stock row at the branch is skipped for cost as well as deduction (`orders.service.ts:1040`) — a sauce ingredient created but not yet received contributes ₱0 to every bowl, forever, still labelled recipe-costed.
5. **The ingredient variance report prints impossible numbers.** It derives usage from product recipes only, so a component consumed through batches reports zero usage and a **negative opening balance** (`ingredient-reports.service.ts:317`). Garlic bought 5,000 g, ending 1,000 g, prints opening −4,000 g. The drinks half of the same report looks fine, so it will read as a kitchen problem rather than a report problem.
6. **The cook cannot record waste.** Write-off is gated to manager/owner/warehouse (`inventory.controller.ts:291`); GENERAL_EMPLOYEE is excluded. Trim, a burnt pan, a dropped tray — all the cook's knowledge, none of it enterable. 5070 Spoilage stays empty, which defeats the reason it was split out.
7. **"Send to kitchen" is a mock.** The F&B header button is `toast.info('Sent to kitchen (mock)')` (`terminal/page.tsx:543`). The kitchen *is* told at payment, so nothing is lost — but a barista firing food before payment will believe it worked. Remove or gate it.
8. **Dine-in vs takeaway never reaches the server** (`terminal/page.tsx:60`), so a takeaway box either drains on every dine-in plate or never appears in the dish's cost. Model it as a "Takeout" modifier option carrying the container — that path works today.

**Practical answer:** enter the kitchen menu **through the Setup Pack importer** (Products page → Setup Pack; it bundles Ingredients and Recipes sheets and does real unit conversion with a mass-vs-volume family check). Do **not** hand-type recipes into the product screen — see EOU-4 below. Model sizes as separate products, not variants, until variant recipes are wired.

---

## 5. WHAT TO FIX BEFORE GO-LIVE

### Must fix — do not open the doors without these

| # | Fix | Where |
|---|-----|-------|
| 1 | Pass `'AP'`/`'AR'` as the 4th argument to `journal.create` in three services — otherwise you can never pay a supplier | `ap-bills.service.ts:265`, `ap-payments.service.ts:160`, `ar-invoices.service.ts:287` (also `vendor-advances.service.ts:158,317`) |
| 2 | Write the AP bill at gross with its VAT, not net with zero | `inventory.service.ts:1692` |
| 3 | Change `'PROMOTION'` to `'PROMO'` — five characters between you and a 500 at the Charge button | `terminal/page.tsx:266` |
| 4 | Re-read live stock at cycle-count post time instead of using the start-of-count snapshot | `warehouse.service.ts:389` |
| 5 | Call `POST /reports/z-read` from the close-shift handler | `layout.tsx:660-694` |
| 6 | Include refunds in expected cash | `shifts.service.ts:516` |
| 7 | Make the owner open a shift like everyone else | `ShiftGate.tsx:157` |
| 8 | Send `isOpeningBalance: true` from the count screen, or establish opening stock only via the importer | `cycle-counts/page.tsx:36` |
| 9 | Warn on a per-unit cost wildly different from the existing WAC — one keystroke currently rewrites every drink's cost | `inventory.service.ts:1568` |
| 10 | Remove or gate the "Send to kitchen" mock button | `terminal/page.tsx:543` |

### Should fix in week one

| # | Fix | Where |
|---|-----|-------|
| 11 | Cash Flow Statement: cash band should be 1010–1029, not 1000–1099 | `accounts.service.ts:904` |
| 12 | Retry FAILED accounting events on the cron, or alert on them | `accounting.scheduler.ts:26` |
| 13 | Disable or confirm-gate "Quick Close" on periods | `periods/page.tsx:583` |
| 14 | POS dashboard gross profit should use the same COGS basis as the ledger | `reports.service.ts:223` |
| 15 | Sales Book must read `Order.taxType` — senior/PWD sales are VAT-exempt by law and currently print as taxable | `bir.service.ts:490` |
| 16 | Purchase Book must include stock receipts, or 2550Q input VAT has no supporting book | `bir.service.ts:522` |
| 17 | Show paid-outs on the Close Shift panel so the three numbers add up | `CloseShiftModal.tsx:112` |
| 18 | Let a manager or owner close another person's shift | `shifts.service.ts:154` |
| 19 | Period lock on cycle counts (inject the periods service) | `warehouse.service.ts:16` |
| 20 | Use relative `{increment}`/`{decrement}` on receive and sale stock writes, as transfers already do | `inventory.service.ts:1548`, `orders.service.ts:1116` |

### Can wait — real, but not launch-blocking

Expense claims never posting to the GL (`expense-claims.service.ts:280`) — do not use that screen yet. Trial balance cutting off at midnight while P&L and balance sheet include the whole day (`accounts.service.ts:527`) — only bites a reversal made on the as-of day. Sub-recipe batches not draining lot layers **{known}**, no period lock or idempotency on a batch **{known}** — both dormant until the batch screen exists. X-Read counting COMPLETED only (`reports.service.ts:436`) — currently harmless because nothing calls X-Read, but wire it wrong and every unbumped rice bowl vanishes from the shift read. Auto-created bill numbers using their own series (`inventory.service.ts:1675`). A branch manager shown the stock screen with no controls **{known}** — you have no branch manager. The "no stock row = free ingredient" hole (`orders.service.ts:1040`) closes itself once every ingredient has been received once.

### Backlog hygiene — **{known}, low}**
Several boxes in `tasks/costing-sod-isolation.md`, `tasks/procure.md` and `tasks/ux-sweep-open.md` are still unticked but were fixed in commits `271a15b` / `1aac5ff`: the SOD tile is gone, the permission-union bug is fixed, 1051 is now SYSTEM_ONLY, the Vendors and Customers nav entries are back, the past-requests list exists, `limitedBy` is named. Two of those are boxed as *critical*. Tick them — the remaining work is smaller than the list says, and the genuinely open items are losing urgency by sitting in a file that has taught its reader to distrust it. The one item still genuinely half-open: account **1054 Supplies Inventory** is still seeded `OPEN`/`isSystem: false` (`accounts.service.ts:88`), harmless only because nothing posts to it any more.

---

## 6. EASE OF USE — the five that matter

1. **"On Hand" on the ingredient detail page is the lifetime quantity you have ever bought.** It sums lot remainders (`inventory/[id]/page.tsx:140`), and on your default WAC valuation nothing ever drains a lot — so Fresh Milk reads 4 L on the stock list and 96 L on the screen you reach by tapping its name, and the gap widens with every delivery. This is the screen an owner opens to check a suspicion. Fix it first; it is the fastest way to lose trust in everything else.
2. **Ledger's front page speaks accountant.** It is titled "Ledger Operations Health" and leads with JE lag, DSO and DPO, then tells you to go elsewhere for revenue and profit (`ledger/dashboard/page.tsx:174`). Put Revenue / COGS / Gross Profit at the top; keep the ops metrics below the fold.
3. **The recipe editor silently drops a mistyped ingredient.** Five good rows and one typo saves five rows, no error, toast says "Product updated." (`products/page.tsx:268`), and the save is a full replacement. Refuse the save and highlight the unresolved row — this is the screen you would use for the rice bowls.
4. **"Save what was bought" discards half-filled lines client-side and always says "Shopping recorded."** (`requests/page.tsx:200`, `:211`). Count what was saved, say so, and mark the incomplete rows. Also: the note promising unbought items "stay on the list for next time" is false — the request closes as RECEIVED (`procure.service.ts:317`) **{known}**.
5. **Put the importer where the work happens.** Procure — the app that owns stock — has no import affordance at all; the Ingredients and Recipes uploaders live in owner-only Settings whose card copy never mentions them (`settings/page.tsx:478`). Put a "Bulk import" link on the Stock-on-hand empty state.

**Two small ones worth a line each:** Close Shift is `hidden sm:flex` and invisible at phone width while the help page tells staff to tap it (`layout.tsx:781`); and the P&L, Balance Sheet and Cash Flow screens throw away the server's error message and show a fixed red one-liner, when `LoadFailed` already does this properly seven other places in the app.