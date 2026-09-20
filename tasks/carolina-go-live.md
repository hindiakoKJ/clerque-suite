# Cafe Carolina: Day 1 runbook and the first week

Written for KJ on site. Plain steps, in order, each with a way to check it worked.
Based on the go-live audit (2026-09-20) and the fixes shipped with it.

**The three rules to repeat all week**
1. **Ice, water and anything else delivered is paid with owner money** and recorded in Procure as "Owner paid".
   Never through Cash Out / Paid Out: that books the money twice and leaves the stock short.
2. **Tap Ready on every kitchen and bar item.** That is what takes the ingredients off stock.
3. **Anne posts a purchase to stock as soon as the "bought" alert arrives**, or the till starts refusing drinks.

---

## A. Before leaving for the shop

| # | Step | Check |
|---|---|---|
| A1 | Railway: the API service has `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_BASE=https://api.clerque.cc`, and `USAGE_ON_READY` is not "off". | The deploy log says "Connected as @ClerqueBot" and "Webhook registered". |
| A2 | Open `https://api.clerque.cc/api/docs`. | It must NOT load (production mode). |
| A3 | Create the new Carolina tenant in Console: business type COFFEE_SHOP, tax status NON-VAT (change only if Anne is VAT-registered), TIN and business name filled in. | The tenant card shows NON-VAT and the right name. |
| A4 | Bring the Setup Pack workbook with the corrections in section C. | — |

---

## B. Settings, as Anne, before any data

| # | Step | Check |
|---|---|---|
| B1 | Settings > Branches > Main: set the **closing time** (e.g. 21:00). | The branch row shows "Closes 9:00 PM". |
| B2 | Settings: Recipe cost ON, Ingredient deduction ON, Ledger mode FULL, **Sell when out of stock OFF** for now. | The choices survive a page reload. |
| B3 | Decide **show purchase costs to staff**. ON lets staff record what they bought (prices visible on Procure screens). Kitchen/bar screens never show costs either way. | — |
| B4 | Settings > Floor Layout: keep the Kitchen and Bar **screens**, turn the Bar and Kitchen **printers** OFF unless real station printers are installed. | Two station cards, each with a screen, no printer. |
| B5 | Settings > Security: Anne sets a 6-digit **supervisor PIN** (not a date, not 123456). Anne sets **no till PIN**. | Saving is accepted (weak PINs are refused). |
| B6 | Settings > Business logo: upload Carolina's logo (PNG or JPEG, under 1 MB). | The logo shows in the menu and on the receipt preview. |
| B7 | Settings > Telegram alerts > Make my link, press Start in Telegram. | The page shows "Linked", and a test alert arrives. |

---

## C. Data, before any counting

Fix these in the Setup Pack (or straight after import):

| # | What | Why |
|---|---|---|
| C1 | **One record per ingredient.** No "Ice" and "Ice Cubes", no two "Chicken Wings", no "Coffee Beans" and "Arabica Roasted Beans". Brand names only where the brand IS the product (Biscoff, Oreo, Milo). | A purchase recorded on the twin never reaches the recipe: stock stays 0 and the till refuses the drinks. |
| C2 | **Every ingredient used in a recipe has a real cost.** No blanks, no zeros. | An ingredient at ₱0 silently makes the dish cost ₱0. Clerque now lists these under "missing cost". |
| C3 | **Every recipe is complete.** Wings recipes must include the chicken. | A missing line is a missing cost, all week. |
| C4 | **No pre-made item that yields one serving** (French Fries). Put its ingredients straight on the dish instead. | A 1-serving prep forces the cook to tap Made before every order. |
| C5 | Units are the unit on the invoice; pack size bridges containers. Never fix a cost by re-importing: edit it in Procure > Stock on hand. | Re-importing can change an item's unit, which Clerque now refuses when the item is in use. |

**Import order:** Ingredients, Preps, Products, Recipes.
**Check:** 0 errors, nothing "partially imported". Download the Recipe costing export: its Notes sheet must say 0 products cannot be costed.

---

## D. Menu routing, levels and people

| # | Step | Check |
|---|---|---|
| D1 | Counter > Products > Categories: every food category goes to **Kitchen**, every drink category to **Bar**. | Nothing is left unrouted. |
| D2 | Procure > Stock on hand: set reorder levels on the daily items (ice, milk, beans, cups, lids, rice, wings) and pars on the preps (rice, marinated wings, sauces, syrups). | The station Prep levels show OK / Low / Out, never "No par set". |
| D3 | Counter > Staff (not Settings > Users): one account per person, branch Main. Baristas = CASHIER, cooks = GENERAL_EMPLOYEE. | A barista's first sign-in shows "Open shift". |
| D4 | **Opening count:** Procure > Cycle counts > Start count. Enter a figure for **every** item used in a recipe or prep, including ice and the preps (0 is fine for a prep not yet made). Post it as opening stock. | The ledger shows Dr Raw materials / Cr Owner's capital, with no "no cost on file" warning, and no tile on the till is greyed out. |
| D5 | Today's ice and water: Procure, Owner paid, recorded against the ingredient the recipes use, with the bag or gallon size as the pack size. Tap "Add it all to stock". (Skip if it was already in the count.) | Ice stock rises by the bag's grams. |
| D6 | **Pair the tablets from the web** (Settings > Displays): Kitchen card > pick **Kitchen** > Generate; on the tablet open /pair and enter the company code and the 4 digits. Repeat for Bar. | The tablet's address ends with the station id, and the screen title says Kitchen or Bar. |
| D7 | POS device: the barista signs in with her own account, prints a RawBT test slip, opens the shift with the float. | The test slip prints. |

---

## E. Prove it works (15 minutes)

1. Ring one iced drink and one kitchen dish, paid in cash.
   - **Check:** the ticket and the bell reach Bar and Kitchen.
2. Tap Ready on both.
   - **Check:** Today's inventory on each screen shows Used moving by the recipe amount.
   - **Check:** the ledger has a sale entry and a cost-of-goods entry; the cost matches the Recipe costing export.
3. Void that order as the cashier, using Anne's supervisor PIN.
   - **Check:** it goes through, and the drawer's expected cash drops back.
4. On the kitchen tablet: "Request what's running low" > send.
   - **Check:** Anne gets the bell and the Telegram message.
5. On the kitchen tablet: "Thrown out" on one item, small amount.
   - **Check:** the Waste column moves and stock drops.
6. Turn **Sell when out of stock ON** for the week (so a data gap never stops the till), then open for customers.

---

## F. Staff briefings (5 minutes each)

**Baristas**
- Tap Ready on every drink.
- No cash out of the drawer for ice, water or supplies. Anne pays those.
- Close the shift from the header button at the end of the night. Never leave the drawer open overnight.
- Check the Senior/PWD amount on screen before taking payment.
- Table number and Dine in / Takeout are not saved yet.

**Cook and bar**
- Tap Made when a batch is made; the card tells you what to refill or make next.
- Tap "Thrown out" for spoiled or dropped items. No more paper waste list.
- "Today's inventory" shows the day's Beginning, In, Waste, Used and Ending. Print it at closing if you want a paper copy.
- If something is low, tap "Request what's running low". Use "+" for tissue, soap and anything not in a recipe.

**Anne**
- Post a purchase to stock as soon as a "bought" alert arrives.
- Bills you pay yourself: Procure > Receipts, "Owner paid". Not Record Entry, not Expense Claims.
- Cash you take home: Ledger > Record Entry, "Owner took out".
- Use the Ledger P&L for profit.
- Don't use the Settlement screen this week (GCash and card money sits in a holding account until we build it).

---

## G. The first week, day by day

**Every night**
- The last shift close writes the Z-Read, saves the day's closing stock, sends Anne the day's ingredient usage, and sends the buy list if nobody sent one.
- **Check:** Anne got the usage message; Today's inventory for the day says CLOSED; the next morning's Procure shows the buy list.

**Day 2**
- Count the 10-15 costliest items at night and compare with Today's inventory's Ending.
- The **Adjust** column is the part the columns don't explain: count corrections, or something recorded outside Clerque.
- Watch for: an ingredient with Adjust every day (usually a recipe amount that doesn't match real practice).

**Day 3**
- Check the recipe costs against reality: Ledger P&L gross profit vs what Anne expects.
- Recipe costing export: 0 products uncosted.
- Fix any recipe with Anne on the spot.

**Day 4**
- Buy list quality: does "Request what's running low" ask for the right things? By now it has sales history to learn from.
- Check a Shopee order end to end: record it as "Ordered — on the way", then post it when the parcel arrives.

**Day 5**
- Cash: every shift closed with a count, over/short small.
- Every "bought" purchase posted to stock the same day.
- Telegram: Anne is getting sales and buying alerts, and the daily usage.

**Before leaving**
- Turn **Sell when out of stock OFF** again if the data is now clean, so the till protects stock.
- Set any remaining reorder levels and pars from what the week showed.
- Leave Anne this page, printed.

---

## H. Known limits this week (tell Anne, don't fight them)

- GCash and card money stays in a holding account; the Settlement screen can't clear it yet.
- Expense Claims books everything to Miscellaneous. Use Procure > Receipts or Record Entry instead.
- A paid-out above ₱500 or a cash drop needs an owner or manager; the approval is a name picked from a list, not a PIN.
- A drawer left open overnight is closed by Clerque with no count, so that night's over/short is lost.
- Table number and Dine in / Takeout are not saved.
- The daily sheet's Ending is the book figure, not a shelf count. Cycle counts are how you correct it.
- Today's inventory prints on A4, not on the thermal printer.
