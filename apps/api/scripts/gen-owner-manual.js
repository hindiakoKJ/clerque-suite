/**
 * Clerque — Owner & Staff Manual (plain-language, coffee shop).
 * Every screen name, button and message below is quoted from the real app.
 * Re-run:  node apps/api/scripts/gen-owner-manual.js
 */
const path = require('path');
const { createDoc, finish } = require('./lib/manual-pdf');

const OUT = path.resolve(__dirname, '../../../onboarding/Clerque-Owner-and-Staff-Manual.pdf');
const m = createDoc({
  title: 'Clerque — Owner & Staff Manual',
  subtitle: 'How to run your coffee shop on Clerque: the till, your menu, your stock, your money, and what keeps you safe',
  footer: 'Clerque Owner & Staff Manual',
  outPath: OUT,
});

/* ───────────────────────────── WELCOME ───────────────────────────── */
m.p('Clerque is two things in one login: a till for ringing sales (we call it Counter) and a set of books that writes itself from those sales (we call it Ledger). You ring the sale; Clerque records the money, reduces the stock, and works out your profit. You never have to "do the accounting" - but you can always see it.');
m.p('This manual is written for the owner and the people at the counter. It uses the exact words you will see on the screen, so when it says click "Close Shift", that is the button\'s name.');
m.note('Two ways to use the till: on a computer or tablet in the web browser (clerque.cc), or the Counter app on an Android tablet or phone. They do the same job. A few actions are web-only - the manual says so where it matters.');

m.h1('1.  Signing in');
m.h2('On the web (computer or tablet browser)');
m.steps([
  'Go to clerque.cc/login. The page says "Sign in to Clerque Counter".',
  'Type your "Tenant ID" (your shop\'s company code - we give you this), your "Email", and your "Password".',
  { text: 'Cashiers can use the "PIN" tab instead of a password: Tenant ID, email, then your 4-8 digit PIN on the keypad.', note: 'Your PIN is set by the owner on the Staff page. If you have no PIN yet, ask the owner.' },
  'Click "Sign in to Clerque Counter". Leave "Remember me on this device" ticked on the shop\'s own device.',
]);
m.h2('On the Counter app (Android)');
m.steps([
  'Open Counter. The screen says "Sign in to Counter".',
  'Type "Tenant ID", "Email", then "Password" (or switch to the "PIN" tab).',
  { text: 'A second screen says "Welcome, {your name}" and asks for a PIN. Cashiers type a 4-digit PIN here.', note: 'IMPORTANT: on this second screen, cashiers type a SUPERVISOR\'s PIN (the owner\'s or manager\'s), not their own. The owner skips this screen. Ask the owner to stand by the first time.' },
]);
m.careful('If you type the wrong password or PIN 5 times in 15 minutes, the account locks for 15 minutes. That is normal - it protects you. Wait, or ask the owner to unlock it.');

/* ───────────────────────────── THE TILL ───────────────────────────── */
m.h1('2.  Your day at the counter');
m.h2('Start the day: open your shift');
m.p('A shift is one cashier\'s stretch at the till. You open it with the cash already in the drawer, and close it by counting the cash at the end. Clerque tells you if the count is right.');
m.steps([
  'When you open the till and no shift is open, a box titled "Open Shift" appears: "Enter the opening cash before starting your shift."',
  { text: 'Type the cash already in the drawer in "Opening cash (₱)" - or switch to "Count by denomination" and type how many of each bill and coin.', note: 'If your shop has more than one till, pick "Which terminal are you at?" first.' },
  'Click "Start Shift". The top bar now shows "Cash Out" and "Close Shift".',
]);
m.tip('Only a cashier opens a shift. The owner and manager can ring sales on the web without opening one - but if a cashier is on duty, let them open it so the cash count is theirs.');

m.h2('Ring a sale');
m.steps([
  'Tap a product on the grid. Use the search box ("Search by name, SKU, or barcode") if the menu is long. Typing "3x latte" adds 3 with one tap.',
  { text: 'If the drink has sizes or add-ons, a box titled with the drink\'s name opens ("Customize your order"). Pick the size, tick any add-ons, then "Add to cart · ₱x".', note: 'Anything marked "REQUIRED" must be chosen before you can add it.' },
  'The order builds up on the right under "Order". Use "−" and "+" to change quantity, or the bin icon to remove a line.',
  'Discounts: "Subtotal", "Discount" and "Total" update as you go. For a Senior Citizen or PWD, use the PWD/Senior option and type the ID number - the law requires this on the receipt.',
  'When the customer is ready, click "Charge ₱x".',
]);
m.tip('Need to pause an order (customer went to get money)? Click "Park", give it a name, and "Park sale". Click the "N parked" pill later to "Recall" it. Parked orders live on that device for 24 hours. (Web only.)');

m.h2('Take the payment');
m.steps([
  'After "Charge", the "Tendering · Bayad" screen shows "Amount due ₱x". Pick the tab: "Cash · Bayad", "GCash", "PayMaya", "Card", or "Split".',
  { text: 'CASH: type what the customer hands you under "Bayad · cash received" (or tap a quick amount like "₱100" / "₱500", or "Exact"). "Sukli · change" shows the change. Click "Confirm payment · ₱x received".', note: 'If the amount is not enough it says "Short by ₱x - keep entering."' },
  { text: 'GCASH / PAYMAYA: the customer pays on their phone. Type the "GCash reference no." from their confirmation SMS (13 digits). Click confirm.', note: 'Always wait for the customer\'s "Sent successfully" screen before you confirm.' },
  'SPLIT: when they pay part cash, part GCash. "Add payment" for each part until "Remaining" is zero.',
  'A box "Sale complete · #{order number}" appears with the receipt. Click "Thermal print" (if a printer is connected) or "Re-print receipt". Then "Start next sale →".',
]);
m.note('What the receipt says: your receipt prints as "ACKNOWLEDGEMENT RECEIPT / Resibo ng Pagtanggap" with an "AR #" number and the line "THIS IS NOT A SALES INVOICE OR OFFICIAL RECEIPT. FOR INTERNAL MANAGEMENT USE ONLY." This is correct for now - see section 6, "What the receipt says and why". Keep issuing your BIR-registered receipts the same way you do today.');

m.h2('Cash leaving the drawer during the day');
m.steps([
  'Click "Cash Out" in the top bar.',
  'Choose "Paid Out" (a real expense paid from the till - ice, a COD delivery) or "Cash Drop" (moving cash to the safe for safekeeping).',
  'Type "Amount (₱)", pick a "Category" (for paid-outs), and write a "Reason" - at least a short sentence. Click "Pay out" or "Drop to safe".',
]);
m.careful('A cash drop, or a paid-out above ₱500, asks you to pick the "Approving manager". The manager confirms verbally for now. Both reduce the "Expected in drawer" amount when you close - so the count still balances.');

m.h2('End of day: close your shift');
m.steps([
  'Click "Close Shift". You see "Orders", "Total Sales", "Cash Sales", "Digital", and the box "Opening cash / + Cash sales / Expected in drawer".',
  'Count the cash in the drawer and type it in "Actual cash in drawer (₱)". The "Variance" line shows "Balanced", "Overage ₱x" or "Shortage ₱x" as you type.',
  'Click "Close Shift". A summary titled "Close shift · Z-read" appears. Click "Print Z-read" to print it, then "Close shift & sign out".',
]);
m.tip('If you try to sign out with a shift still open, Clerque warns you: "Shift Still Open". Always close the shift first - otherwise today\'s cash count is not recorded.');
m.careful('Digital payments (GCash / Maya) show under "Digital breakdown - verify against your apps". Check that total against your GCash/Maya app before you close. Differences are easier to find the same day.');

m.h2('If the internet drops');
m.p('Keep selling. An amber bar says "You\'re offline - orders are saved locally and will sync automatically when you reconnect." You can take CASH only while offline (GCash needs the network). Each sale is saved on the device with a temporary number; when the internet returns they are sent automatically and never counted twice. If something did not send, the "Pending Sync" page shows it with a "Sync Now" button.');

m.h2('Cancelling a sale (void) and returning an item (refund)');
m.p('Mistakes happen. A paid sale can be cancelled ("void") only on the same day, always with a written reason, and a cashier needs a manager to type their Supervisor PIN on the screen. This protects the cashier as much as the shop - every void records who asked and who approved.');
m.steps([
  'WEB: open "Orders" in the left menu. Find the order and click "Void" in the Action column. Type the "Reason". A cashier then hands the screen to the manager to type the Supervisor PIN. Click "Confirm Void".',
  'For one item only: expand the order, click "Refund" beside the item, choose the quantity, reason, and how you refund ("Refund method"). Tick "restock" if the item went back on the shelf.',
]);
m.note('Voids and refunds of a PAID sale are done on the web "Orders" page. On the Counter tablet, the PIN-protected void only removes a line BEFORE payment (long-press the line). If a paid sale must be cancelled, do it on the web.');

/* ───────────────────────────── MENU ───────────────────────────── */
m.h1('3.  Your menu (Products)');
m.p('Open the left menu and click "Products". This is your menu: every drink, pastry and bottle you sell, with its price and its cost.');
m.h2('Add a drink or item');
m.steps([
  'Click "New Product". Fill "Name" (e.g. Brewed Coffee), "Price", and "Cost Price" - what it costs you to make or buy one. Cost is required so your profit is real; type 0 only if it is truly free.',
  { text: 'Pick a "Category" (Coffee, Pastries...). If none exists yet, choose "+ Create new category..." and type a name.', note: 'Categories decide which drink-station ticket prints and how your sales reports group things. Every product should have one.' },
  'If you are VAT-registered you will see "VAT-able (12%)". Leave it ON for normal items.',
  'Click "Create". Clerque asks "Add to Inventory?" - for bottled or packaged items, give the "Opening Quantity"; for made-to-order drinks, click "Skip".',
]);
m.h2('Sizes and add-ons (Small / Medium / Large, extra shot, oat milk)');
m.p('Sizes and add-ons are "modifier groups". A group called Size has options Small / Medium / Large, each with an extra price (Small +₱0, Medium +₱20, Large +₱35). A group called Add-ons has extra shot, oat milk, and can allow more than one.');
m.steps([
  'Easiest: set Size once for a whole category. "Products" → "Categories" → open your Coffee category → "New group for this category". Name it "Size", tick "Required", click "Create". Then add options with their prices.',
  'For one product only: on the Products table, click the layers icon in the "Modifiers" column → "Modifier Groups" → "Add existing group" or create one, then add options ("Option name" and "+₱").',
]);
m.tip('Set up sizes and add-ons together with us on-site. They cannot be imported from the Excel file - they are set on this screen.');

/* ───────────────────────────── STOCK ───────────────────────────── */
m.h1('4.  Your stock and your real cost per cup');
m.p('Clerque can track two kinds of stock. "Unit" items (bottled water, a pastry) go down by one each sale. "Recipe" drinks (latte, americano) go down by their ingredients - 18 g of beans, 200 ml of milk, one cup, one lid. If you set up ingredients and recipes, you will know what each cup truly costs and how many you can still make.');
m.h2('Ingredients (beans, milk, syrups, cups)');
m.steps([
  'Left menu → "Ingredients". Click to add each raw material with its unit (g, ml, pc) and its cost per unit.',
  'When a delivery arrives: find the ingredient, click "Receive stock". Type "Quantity", "Cost / unit (₱)", the "Receipt date", and "Paid by": "Cash" (from the drawer), "Credit / Net-30" (supplier bill to pay later), or "Owner funds" (you paid from your own pocket).',
  'Click "Receive". Clerque updates the stock, updates the average cost, and writes the books entry for you - the screen even tells you: "A journal entry will be posted automatically".',
]);
m.h2('Recipes (what goes into each drink)');
m.steps([
  'Open a drink in "Products" → "Edit" → turn on "Recipe-based inventory".',
  'Under "Recipe Ingredients" click "Add ingredient", search the ingredient, type the "Qty" (in that ingredient\'s unit). Example Latte 12oz: Espresso Beans 18 g, Fresh Milk 200 ml, 12oz Cup 1 pc, Lid 1 pc.',
  'The "Cost Price" turns read-only with a "DERIVED" badge - Clerque now computes it from the ingredients and keeps it up to date when bean prices change.',
]);
m.h2('Packaged items (bottles, pastries you buy in)');
m.p('To receive stock of a unit item, open "Inventory" and use the stock adjustment. Choose "Stock In", the quantity, what you paid per unit, and "Paid with": "Cash on hand" or "Owner funds". For an opening count, pick the reason "Initial count" - it defaults to owner funds, which is usually right.');
m.tip('Low stock shows on the product tile as "LOW · x" and "OUT" when empty. Out-of-stock tiles cannot be sold.');

/* ───────────────────────────── MONEY ───────────────────────────── */
m.h1('5.  Your money (Ledger, the simple way)');
m.p('Sales from the till go into your books automatically. The Ledger is for everything that did NOT go through the till: the rent, the electric bill, money you put in, money you took out. You do not need to know accounting. Open the left menu and click "Ledger".');
m.note('Your Ledger is set to "Simple books": you see Record Entry, Settlement, Reports, and your Dashboard - nothing more. If you ever want the full accountant\'s view (journal, statements, tax), the owner can switch it in Settings → "Ledger mode". Your records are kept either way.');
m.h2('Record a bill, an expense, or owner money');
m.steps([
  'Ledger → "Record Entry". The page says: "Log money in and out that doesn\'t go through the till - rent, utilities, owner cash, deposits."',
  'Under "What happened?" tap one tile: "Expense" (money out for a cost), "Other income" (money in that is not a sale), "Owner put in", "Owner took out", "Cash → Bank" (you deposited till cash), or "Bank → Cash" (you withdrew).',
  'Type "Amount (₱)" and the "Date". For an expense, pick a "Category": Rent, Utilities, Supplies, Repairs, Transport, or Other. For the Meralco bill, pick Utilities.',
  'Choose where the money came from or went: "Cash on hand" (the drawer) or "Bank / GCash / Maya".',
  'Add a short "Note" (e.g. "June rent, Meralco bill"). Click "Save entry". You will see "Recorded: Utilities expense - Meralco bill · ₱x".',
]);
m.h2('See this month\'s profit');
m.p('At the top of "Record Entry" is a card called "This month" with three numbers: "Money in" (your sales and other income), "Money out" (your costs and expenses), and "Profit" - green if you made money, red if not. Use the "<" and ">" arrows to look at earlier months.');
m.note('Money you put in or take out yourself, and moving cash between the drawer and the bank, do not change your profit - the card says so underneath. Profit is sales minus costs.');
m.h2('Made a mistake?');
m.p('In "Recent entries", click "Reverse" on the wrong line. Clerque asks "Reverse this entry?" and writes an opposite entry so the books stay honest - the original stays visible, struck through, marked "Reversed". Nothing is ever deleted.');
m.h2('Where does my GCash money show up?');
m.p('When a customer pays by GCash or Maya, the money is not in your bank yet - the e-wallet sends it a day or two later. Clerque keeps it in "Awaiting Settlement" until you confirm it arrived. Ledger → "Settlement" → "New Batch" for the period → when you see it in your bank, click "Confirm" and type the "Actual Amount Received (₱)". If the amount matches, it moves to your bank in the books. If it does not match (fees, a shortfall), it is marked "Disputed" so you can look into it.');
m.h2('Reports');
m.p('Ledger → "Reports" lets you download your numbers as Excel files to keep or to hand to your accountant.');

/* ───────────────────────────── SAFETY ───────────────────────────── */
m.h1('6.  What keeps you safe');
m.p('Clerque has built-in rules that protect the shop, the owner, and the staff. You will bump into them occasionally - that is them working. Here is what each one is, in plain words.');

m.h2('Nobody approves their own work');
m.p('The person who does a thing and the person who approves it must be different people. A cashier cannot cancel their own sale alone - a manager\'s Supervisor PIN is needed. Someone who enters a supplier bill cannot be the same person who approves paying it. The owner is the exception, and even that is written down. If you see "Supervisor authorisation required" or "Separation of duties", that is this rule.');

m.h2('Cancelling sales is controlled');
m.bullets([
  'A sale can only be cancelled the same day it was made, always with a written reason.',
  'A cashier needs a manager\'s Supervisor PIN typed on the screen. Both names are recorded.',
  'Guessing the PIN is blocked: "Too many supervisor-PIN attempts. Wait 15 minutes or have a supervisor log in."',
  'The owner can go stricter: Settings → "Returns & Refunds Policy" → "Owner-only returns" means nobody but the owner can void or refund.',
]);
m.note('Supervisors (owner, manager): set your Supervisor PIN in Settings → "Security" → "Supervisor PIN". Make it SIX digits - the Counter tablet needs exactly 6.');

m.h2('Last month can be locked');
m.p('Once the owner closes a month (Ledger → "Accounting Periods", full accounting view), nothing can be back-dated into it - not an expense, not a bill, not a correction. This is what makes your books trustworthy after you hand them to your accountant. Only the owner can reopen a month, must type a reason, and every reopen is counted and logged. If you see "Cannot post to a closed accounting period", ask the owner.');

m.h2('Some accounts only the system can touch');
m.p('Inventory and GCash-money accounts are written only by real sales, stock moves and settlements. Nobody can "fix" inventory by typing a number into the books. If you ever see "Only the system event processor may post to it", that is this protection.');

m.h2('Everything important is written down - and cannot be erased');
m.p('Voids, price changes, discounts, settings changes, month closes and reopens, who logged in and when - all go into an audit log that the database itself refuses to edit or delete. The owner can read it at Ledger → "Audit Log" ("Immutable trail of all sensitive changes"). Failed login bursts are flagged there too.');

m.h2('Who can do what (roles)');
m.table(['Role', 'What they can do'], [
  ['**Cashier', 'Open and close their shift, ring sales, take payments, park orders, cash-outs. No settings, no menu changes, cannot void alone.'],
  ['**Sales Lead', 'Everything a cashier does, plus approve voids and discounts with their PIN.'],
  ['**Branch Manager', 'Supervises orders, stock and branch reports; can void directly. Cannot open a shift. No payroll, no ledger writing.'],
  ['**Business Owner', 'Everything. The only one who can add staff, change tax status, close a month, or switch Ledger mode.'],
  ['**Accountant / Bookkeeper', 'Works in the Ledger (journal, statements, tax). No till.'],
], [110, 405]);
m.p('The owner adds staff and sets their role and PIN at "Staff" in the left menu ("Add Staff").');

m.h2('Signing in is protected');
m.bullets([
  'Cashiers sign in with a PIN; 5 wrong tries in 15 minutes locks the account for 15 minutes.',
  'Each new sign-in signs that person out everywhere else - one login cannot be used on two tills at once.',
  'Changing a password signs out all other devices.',
  'The owner and accountant can add two-factor authentication (a code from an authenticator app) in Settings → "Security".',
]);

m.h2('Selling offline is safe');
m.p('If the internet drops, sales are saved on the device and sent when it returns. Each sale carries a unique tag, so even if it is sent twice, Clerque records it once. You will never be charged or counted double.');

m.h2('What the receipt says and why');
m.p('Clerque decides what to print from YOUR shop\'s BIR registration, not ours. Right now your receipts print as "ACKNOWLEDGEMENT RECEIPT" with an "AR #" number and the line "THIS IS NOT A SALES INVOICE OR OFFICIAL RECEIPT". That means: Clerque is your till, your stock and your books - and you keep issuing your BIR-registered receipts exactly as you do today. When (and if) your BIR Permit to Use for Clerque is on file, we switch it on for you and the same slip becomes a "SALES INVOICE" with an "SI #" number. We will never print something your shop is not entitled to print.');

m.h2('Your data is backed up - and it is yours');
m.p('A copy of your shop\'s data is taken every night. The owner can download everything at any time as one Excel file: Settings → "Business Profile" → "Download all my data (.xlsx)". If you ever leave, your data goes with you.');

/* ───────────────────────────── FAQ ───────────────────────────── */
m.h1('7.  Questions people ask in the first week');
m.faq('I rang the wrong item. What do I do?', 'If you have not charged yet, tap the bin icon on that line. If you already charged, a manager must void it on the web "Orders" page (same day, with a reason and their Supervisor PIN), then ring it again correctly.');
m.faq('The customer paid GCash but I forgot the reference number.', 'Ask for the reference from their GCash app (Transactions) - it is 13 digits. The receipt prints it on both copies; it is how you match the money later on the Settlement page.');
m.faq('My drawer is short at closing. Does Clerque stop me?', 'No. Type the real count. The "Variance" shows "Shortage ₱x" and it is recorded on the Z-read. Owners see the variance; it is better to be honest than to "fix" it.');
m.faq('The internet is down. Can I still sell?', 'Yes - cash only. Keep going. The amber bar at the top tells you orders are saved and will send themselves when you are back online.');
m.faq('Can I give a discount to a friend?', 'Cashiers can apply a manual discount only where the owner allows it; a Sales Lead or manager may need to approve it with their PIN. Senior Citizen / PWD discounts are always available and need the ID number.');
m.faq('Where do I put the electric bill?', 'Ledger → "Record Entry" → "Expense" → Category "Utilities" → amount → "Paid from" → "Save entry".');
m.faq('I put ₱5,000 of my own money into the drawer. Is that profit?', 'No. Record it as "Owner put in". It shows in your books as money you contributed, and it does not change profit.');
m.faq('Why does the receipt say it is not an official receipt?', 'Because Clerque will only print an official sales document once your shop\'s BIR Permit to Use for it is on file. Until then, it is an internal acknowledgement and you keep issuing your registered receipts as today. See section 6.');
m.faq('Why is "Ledger → Journal" not in my menu?', 'Your Ledger is on "Simple books". The owner can switch to "Full accounting" in Settings → "Ledger mode", then log out and back in.');
m.faq('I changed a setting but nothing happened.', 'Some settings (Ledger mode, receipt details) only apply after you log out and log back in. The screen tells you: "Please log out and back in for this to take effect."');
m.faq('A cashier forgot their PIN.', 'The owner opens "Staff", edits the person, and types a new "Kiosk PIN". Cashier PINs are set there - not in Settings → Security (that one is the Supervisor PIN for voids).');
m.faq('How many lattes can I still make?', 'If the latte has a recipe, its tile shows "x left" computed from your ingredients - the number of full drinks your beans, milk and cups can still make.');
m.faq('Prices went up at the supplier. Do I update every drink?', 'No. Receive the delivery at the new "Cost / unit". Every recipe drink that uses that ingredient updates its cost automatically.');
m.faq('Can two people use the same login?', 'No - each sign-in signs out the other device. Give each person their own account and PIN; it is also what makes the audit log meaningful.');
m.faq('I closed the month and found a missing bill.', 'Only the owner can reopen it: Ledger → "Accounting Periods" → "Reopen Period", type a reason. Every reopen is counted and logged - that is expected, just do not make a habit of it.');
m.faq('Who can see my sales numbers?', 'Only your own staff, by role. HNS support does not look at your money - the Console we use shows operational health only, never your financial data.');

m.h1('8.  When to call us');
m.p('Email devsupport@hnscorpph.com. Tell us your shop name, what you were trying to do, and the exact message on the screen (a photo helps). Things we can do for you quickly: unlock a locked account, reset a password, change your tax status or TIN, switch receipt settings, and load your opening balances.');
m.small('This manual describes Clerque as of the go-live build. Screens may gain features over time; the names quoted here are from the app itself.');

finish(m).then((p) => console.log('written: ' + p));
