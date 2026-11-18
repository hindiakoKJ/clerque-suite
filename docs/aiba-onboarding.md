# Onboarding AIBA to a Clerque client

Draft, 18 Nov 2026. For KJ to decide on. Nothing here is built unless the
"Exists today" column says so.

## The rule

- **Clerque records.** Every sale, purchase, stock move, journal entry and
  pay run of every client lives in Clerque.
- **AIBA processes.** Its AI seats read the client's Clerque data through a
  key the owner issues, and send back **drafts**.
- **A person approves in Clerque.** The seat that drafts never posts. Who
  approves, and what may post on its own, is set per room (the posting
  policy: inventory may auto-post with holds and an Undo; month-end close
  needs a person unless the owner switches that off).

This uses the rooms already planned in AIBA's
`ba-agent/docs/finance-accounting-plan.md` (Floor 2: Payroll, Inventory,
AP, AR, GL, Tax). Each room has an AI processor, a code check (QC), a person
as team lead, and a signed-off guide. The Controller (period close, BIR
filing) is a person.

## 1. The core team: every client gets these

| Room | What the AI seat does | Reads | Sends back to Clerque | Who approves | Exists today |
|---|---|---|---|---|---|
| **Inventory** | Compares counts with what sales used, builds the buy list, flags waste and stock with no cost | `inventory:read` | Count draft, buy-list lines, receiving draft | Owner or branch manager | Clerque side built on branch `aiba-service` (PR #35, not merged). AIBA room: plan only |
| **AP (supplier bills)** | Reads supplier receipts sent by Telegram, matches them to deliveries | `procure:receipts` | Receipt posted (only when every line is one the shop confirmed before), else a draft | Owner, in Telegram | Clerque side built on `aiba-service` |
| **GL (bookkeeper)** | Daily review: wrong accounts, missing costs, accruals, reclasses | `ledger:read` | Journal draft (balanced, own accounts only) | Owner; above the approval threshold, a second person | Clerque side built on `aiba-service` |
| **Month-end close** | Checklist, stock valuation tie-out, close note | `ledger:read`, `inventory:read` | Proposals only | The Controller (a person) closes the period in Clerque | Not built. Close is not exposed to keys, on purpose |
| **Tax** | Deadline calendar and form drafts for the client's tax status | Nothing yet (no tax scope) | Form drafts | The Controller | Not built. BIR filing for clients may need tax-agent accreditation |

## 2. Added case by case

### By business type (Clerque's `BusinessType`, `packages/shared-types/src/verticals.ts`)

| Business types | How Clerque counts stock | Extra work for the rooms | Payroll shape |
|---|---|---|---|
| COFFEE_SHOP, RESTAURANT, BAKERY, FOOD_STALL, BAR_LOUNGE, CATERING | Recipes and prep batches (RECIPE_BOM) | Recipe cost vs actual use, spoilage, batch yield (the pot that made 17 plates, not 20), prep planning | Shifts, tips pool, meal allowance |
| RETAIL | Per unit, weighted average | Shrinkage, slow movers (ABC), expiry, reorder levels | Shifts, sales commission |
| PHARMACY | Per unit, lots and expiry (FIFO) | Expiry watch, prescription and DDB register checks. **A person reviews everything**: regulated | Shifts |
| GAS_STATION | Per unit | Meter readings vs sales vs tank dips, every shift | Shifts |
| MEDICAL_EQUIPMENT | Per unit, serial numbers | Rentals, deposits, repairs billed on time | Shifts, commission |
| LAUNDRY | Service-based | Unclaimed-laundry aging, machine use, per-load bonus | Shifts, piece rate |
| SERVICE, MANUFACTURING, CONSTRUCTION | Projects (work in progress) | WIP aging, progress billing (AR room), materials vs estimate | Project hours, piece rate, site allowance |
| TRUCKING | Projects (trips) | Trip profit, cash-advance liquidation, maintenance due | Trip pay, project hours |

### By how the client is set up

| Switch in Clerque | What it turns on or off |
|---|---|
| **Tax status** VAT / NON_VAT / UNREGISTERED | Tax room: VAT returns, or percentage tax, or no BIR forms at all (books only) |
| **Ledger mode** FULL / SIMPLE | FULL: GL and month-end close rooms. SIMPLE: a cash summary only |
| **Staff on Clerque payroll** | Payroll room on or off. Most small shops give staff cash advances (CA); Clerque records them and takes them back off each payslip, so the room reads what each person still owes and its draft pay run must show that deduction |
| **More than one branch** | Transfers between branches, a count per branch |
| **Sales from another app** (court bookings, magnet booths, later the yard) | AR room matches payouts (Xendit, GCash, bank) to the sales those apps sent in |
| **Sells or buys on credit** | AR room (customer balances, 2307s received) and AP due dates |

## 3. Our clients today

| Client | Clerque setup | Rooms to start with | Later |
|---|---|---|---|
| **Cafe Carolina** | COFFEE_SHOP, one branch | Inventory (recipe cost vs actual is the biggest win), AP, GL | Payroll, once Clerque payroll is ready for real pay; Tax |
| **Carolina Picklepop** | RETAIL, own TIN, not created yet | Inventory (small), AP, GL | AR, once the PicklePop court app sends its sales to Clerque (its outbox is ready; nothing connects it yet) |
| **Glorick (container yard)** | Not a Clerque client yet; runs on YMS | none yet | AR (slips, 2307s) and Payroll (bundy cards), after we know why YMS's link to Clerque was removed on 7 Oct |

## 4. What has to exist before the first client is onboarded

| # | What | Where | Status |
|---|---|---|---|
| 1 | Merge PR #35 (scoped keys, read routes, drafts a person confirms). It has migrations | Clerque | Waiting on KJ |
| 2 | Owner issues the client's key at Settings > API keys, with only the scopes for the rooms switched on | Clerque | Built in PR #35 |
| 3 | The Inventory, AP and GL rooms themselves (processor seat, code check, queue per client) | AIBA | Plan only. AIBA has no scheduler yet, so nothing runs daily |
| 4 | Payroll scope and a pay-run draft in Clerque | Clerque | Not built. Needs a migration, so a PR |
| 5 | Settlement screen (GCash and card money leaves the holding account) | Clerque | Not built. Bank reconciliation can't start without it |
| 6 | Data processing agreement with each owner (payroll is sensitive personal data) | HNS | Not done |

## 5. One conflict to settle

AIBA's plan (decision 1) recommends keeping **payroll records in AIBA** and
rewriting the yard's payroll engine in Python there. KJ said on 15 Nov that
**payroll is handled by Clerque**, which is the single source of truth.

Proposed: payroll records (employees, time sheets, pay runs) live in Clerque.
AIBA's Payroll room reads time sheets, computes and checks, and sends a
**draft pay run** to Clerque, which the owner releases with one tap. Only
one copy of the pay rules is kept, and it is Clerque's.
