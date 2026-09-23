/**
 * Clerque — the three guides a shop hands to its people.
 *
 *   onboarding/Clerque-Owner-Guide.pdf            (the owner / manager)
 *   onboarding/Clerque-Cashier-Guide.pdf          (the person at the till)
 *   onboarding/Clerque-Kitchen-and-Bar-Guide.pdf  (the cook and the barista)
 *
 * Every screen name, button and message quoted below was read off the code in
 * this repo. Where the shop must set something up before a step works, the
 * guide says so in a "BEFORE THIS WORKS" box instead of pretending.
 *
 * House rules kept here on purpose:
 *   - Plain, warm, short sentences. No computer words, no accounting words.
 *   - Pesos as the peso sign. Arial is registered in lib/manual-pdf so it prints.
 *   - The two staff guides never mention what anything costs. The shop keeps
 *     its buying prices to itself, and the app already hides them.
 *   - No price of Clerque itself appears in any of the three.
 *
 * Re-run:  node apps/api/scripts/gen-role-guides.js
 */
const path = require('path');
const { createDoc, finish } = require('./lib/manual-pdf');

const OUT_DIR = path.resolve(__dirname, '../../../onboarding');
const SUPPORT = 'devsupport@hnscorpph.com';

/**
 * Start the next part on a clean page — unless the page we are standing on is
 * barely used, in which case a break just wastes it.
 *
 * Section 3 of the owner guide used to spill its last five steps and one box
 * onto a fresh page (ending a fifth of the way down), and the unconditional
 * break then threw the rest of that page away: page 5 was four-fifths white,
 * which reads as "something is missing here". A page already half full is
 * still worth breaking after; one barely started is not.
 */
function freshPage(m) {
  const BARELY_USED = 300; // points down an A4 page, out of ~780 usable
  if (m.doc.y > BARELY_USED) m.pageBreak();
}

/* ═══════════════════════════════════════════════════════════════════════════
   1.  CASHIER GUIDE
   ═════════════════════════════════════════════════════════════════════════ */
function buildCashier() {
  const m = createDoc({
    title: 'Clerque — Cashier Guide',
    subtitle: 'Your day at the till, from opening the drawer to counting it at the end.',
    footer: 'Clerque Cashier Guide',
    outPath: path.join(OUT_DIR, 'Clerque-Cashier-Guide.pdf'),
  });

  m.callout('START HERE',
    'Open the shop page in the browser. The heading reads "Sign in to Clerque Counter". Type the shop code in the box marked "Tenant ID", then your own email and your own password, and press "Sign in to Clerque Counter". Use your own sign-in, never anybody else\'s — signing in anywhere signs that person out everywhere else. Something not working? Ask the owner first. If the owner is stuck too, email ' + SUPPORT + ' with the shop name, what you were doing, and a photo of what the screen said.');
  m.p('This guide follows a real day, from the first sign-in to the last count. Read it once from the front. After that, find the number you need. Everything in quotes is the exact wording you will see.');

  /* ── the day ── */
  m.h1('1.  Sign in at the till');
  m.p('Do this at the start of the day, and again after every shift close. Closing a shift always signs you out, so the next person starts under their own name.');
  m.steps([
    'Open the shop page. The left side reads "Clerque · Counter" and "Sell faster. Close the till."',
    'Stay on the "Password" tab. Type the shop code in "Tenant ID", your own email, and your password. The small eye shows the password if you need to check it.',
    'Leave "Remember me on this device" ticked on the shop\'s own device. Press "Sign in to Clerque Counter".',
    { text: 'Once the owner has given you a number, the "PIN" tab is quicker: shop code, email, then your 4 to 8 digit number on the keypad.', note: 'Forgot the password? "Forgot password?" is on the same screen, or ask the owner. Five wrong tries in fifteen minutes locks the account for fifteen minutes — nothing is broken, just wait.' },
  ]);

  m.h1('2.  Open the shift with the money in the drawer');
  m.p('A shift is your own stretch at the till. It starts with the money already in the drawer and ends when you count it. The box that asks for it cannot be closed, so this is always the first thing.');
  m.steps([
    'The box reads "Open Shift" and "Welcome, {your name}. Enter the opening cash before starting your shift."',
    { text: 'If the shop has more than one till, a row asks "Which terminal are you at?". Choose the one you are standing at.', note: 'With only one till this row is not shown.' },
    'Count the money in the drawer. Type it under "Opening cash (₱)", or switch to "Count by denomination" and say how many of each note and coin — it adds up for you.',
    { text: 'Check the big figure, then press "Start Shift". The top now shows "Cash Out" and "Close Shift".', note: '"Notes (optional)" takes a short remark first, like "Drawer A, morning shift". Opening the page again later does not start a second shift — the same one comes back.' },
  ]);

  m.h1('3.  Ring a sale');
  m.steps([
    'Find the drink: press its picture, or type part of its name in the search box at the top. The same box takes a barcode.',
    'The round buttons above the pictures are the menu groups. "All" is first, then each group the owner made.',
    { text: 'For several of the same drink, type the number first — "3x latte". A small "x3" shows at the right of the search box, and the next drink you press goes in three times.', note: 'The search box clears itself afterwards.' },
    'A scanner works too. Scan and the item drops straight in. If it matches nothing you hear an error and read "No product matches barcode".',
    'Each line on the right has a minus, the number, a plus, and a bin to take the line off. "Subtotal" and "Total" add up underneath.',
    'When the customer is ready, press the big "Charge ₱x".',
  ]);
  m.p('The small tag on each picture is how many are left: "12 left" in green, "LOW · 3" in amber, "OUT" in grey. An "OUT" picture cannot be pressed. When one thing is holding a drink back, the picture says it in one line, like "needs Fresh Milk".');
  m.careful('Check the order before you press "Charge". Taking a line off beforehand is free and needs nobody\'s permission. Once it is charged, only a void or a refund can undo it, and that needs a supervisor.');
  m.p('The bar and the kitchen see nothing until the sale is paid. There is no button to send an order through early — tickets arrive on their screens the moment the payment is confirmed.');

  m.h1('4.  Sizes and add-ons');
  m.steps([
    'Press the drink. If it needs a choice, a box opens with the drink\'s name at the top and "Customize your order" under it.',
    'Each group shows "REQUIRED" or "OPTIONAL" on the right, and "· UP TO 3" where several are allowed.',
    'Press the options. Each shows "+₱20" or "Included", and a tick appears.',
    'Press "Add to cart · ₱x". The button stays dim until every "REQUIRED" group has an answer.',
  ]);
  m.p('The choices then show in small grey words under the drink in the order, and they print on the receipt. If a "3x" count was typed, the choices are asked once and used for all three.');
  m.careful('A choice cannot be changed once the line is in the order — there is no "customise" on an order line. Take the line off with the bin and ring it again.');

  m.h1('5.  Park a sale and bring it back');
  m.p('For the customer who steps away to get money, or the big group still deciding.');
  m.steps([
    'Press "Park". The box reads "Park this sale" and "Save the cart for later — recall it from the same terminal within 24 hours."',
    'Give it a name, or leave it and it becomes "Park #1". Press "Park sale". The order clears and you can serve the next customer.',
    'To bring it back, press the purple "N parked" at the top of the order, then "Recall" on the right one. The bin beside it throws a parked sale away.',
  ]);
  m.careful('A parked sale lives on that one device for 24 hours. Park it at this till and it comes back only at this till. If something is already in the order it asks "Replace current cart?" — "Discard & recall" throws away what is on the screen.');

  m.h1('6.  Senior citizen and PWD discount');
  m.p('This one is always yours. It needs nobody\'s permission.');
  m.steps([
    'Ring the drinks first, then press "Apply PWD / Senior Citizen Discount", and choose "Senior Citizen" or "PWD".',
    { text: 'Under "Items to discount", tick what this card covers. "All" and "None" are shortcuts.', note: 'Nothing is ticked to begin with, on purpose — the card does not cover the whole table. The law gives one of each item, so a line with two lattes reads "1 discounted + 1 full price".' },
    'Type the "Name of ID Holder" and the card number. Both are required. There is no set shape — type the number as printed on the card.',
    'Press "Apply Discount". Both the name and the number print on the receipt.',
    'More than one card in the group? Press "Add another PWD / Senior in this order". Up to five, and items already claimed are hidden from the next person.',
  ]);
  m.p('For this shop the sum is simply 20% off the price. The small print on that screen also mentions VAT — a tax this shop is not registered to charge — so it makes no difference to what the customer pays. Say out loud that you are writing down the name and the card number. The law asks for it, and the customer should hear it from you rather than wonder.');

  m.h1('7.  A discount that is not senior or PWD');
  m.p('Goodwill, a damaged item, a friend of the shop. You will not see that button at all — it belongs to a Sales Lead, a manager or the owner. The way to do it without losing the order: leave the order on the screen, press "Lock" at the top, and let them take the till over with their own number. They press "Apply manual discount", give the amount and a reason, and apply it. Then press "Lock" again and take the till back with your own number before pressing "Charge".');
  m.careful('Whoever is signed in when "Charge" is pressed is the name written on the sale. Always take the till back before charging. And the bin beside a discount is not locked — do not press it by accident.');

  m.h1('8.  Take the payment');
  m.p('After "Charge ₱x" the whole screen becomes the payment sheet. The heading is "Tendering · Bayad" and the amount is in huge type under "Amount due". The tabs across the top are "Cash · Bayad", "GCash", "PayMaya", "Card" and "Split".');
  m.h2('Cash');
  m.steps([
    'Type what the customer hands over on the number pad, or press a quick amount (₱20 up to ₱1,000), or "Exact".',
    '"Bayad · cash received" and "Sukli · change" show side by side. The change box turns green when it is enough, and red with "Short by ₱x — keep entering." when it is not.',
    'Press "Confirm payment · ₱x received".',
  ]);
  m.p('Taking more than the amount due is fine. The books record the sale; the receipt still shows what was handed over and the change.');
  m.h2('GCash or Maya');
  m.steps([
    'Press "GCash" or "PayMaya". The customer pays using the shop\'s own code at the counter — Clerque does not put one on the screen.',
    'Wait for the customer\'s "Sent successfully" message. Do not confirm before you have seen it.',
    'Type the reference number from that message into the box. It takes digits only.',
    'Press "Confirm GCash · ₱x". The reference prints on the receipt and is how the money is matched later.',
  ]);
  m.stop('Never leave the reference blank and never make one up. Without it the money cannot be traced when it lands in the bank.');
  m.h2('Card');
  m.p('Run the card on the bank\'s own machine as usual — Clerque does not talk to it. Then type the number from the machine\'s slip into "Authorization / Reference no." and press "Confirm Card · ₱x". "Last 4 digits of card" is optional.');
  m.h2('Two ways at once');
  m.steps([
    'Press "Split". The right side shows "Total · Bayaran" and "Remaining".',
    'Under "Add payment" press how they are paying, type the amount or press "Exact remaining", and add a reference for anything that is not cash.',
    { text: 'Press "+ Add ... payment", and repeat until "Remaining" turns into "Settled". Then press "Confirm split · ₱x".', note: 'Only cash may go over the amount due. Anything else is refused.' },
  ]);

  m.h1('9.  The receipt');
  m.steps([
    'The box reads "Sale complete · #..." with a green "Paid" tag, and shows the slip exactly as it prints.',
    'Press "Print receipt — Receipt Printer". On a tablet with no named printer the button reads "Print via Bluetooth" instead.',
    'Press "Start next sale →". To print an older one again, open "Orders" and press the order number.',
  ]);
  m.note('This shop\'s slip is an "ACKNOWLEDGEMENT RECEIPT" and carries the line "THIS IS NOT A SALES INVOICE OR OFFICIAL RECEIPT." The shop keeps giving out its own registered receipts exactly as before. If a customer asks, that is the whole answer — this slip is for the shop, the registered receipt is theirs.');

  m.h1('10.  Money leaving the drawer during the day');
  m.steps([
    'Press "Cash Out" at the top.',
    'Choose "Paid Out" for money really spent, or "Cash Drop" for notes moved to the safe.',
    'Type the "Amount (₱)". For a paid-out, pick a category — Supplies, Delivery, Fuel, Change fund, Tip, Other.',
    'Write the reason. It needs at least a short sentence or the button stays dim.',
    'A cash drop always needs an approving manager chosen from the list, and so does a paid-out over ₱500. Ask them in person first.',
    'Press "Pay out" or "Drop to safe".',
  ]);
  m.stop('There is no undo on this. Once it is pressed, it is recorded. Get the amount right before you press, and tell the manager straight away if it was wrong.');
  m.p('Both kinds lower what the drawer is expected to hold at closing, so your count still comes out right. Ingredients do not belong here — those go into the shop\'s stock, not out of the drawer.');

  m.h1('11.  Count the till partway through the day');
  m.p('About every two hours a blue strip appears across the top: "Time to count the till." Press "Count it now", count the drawer, type the amount and press "Save the count". It answers "spot on" or says what the difference was. "Later" pushes it back fifteen minutes.');
  m.tip('This is not a test. It protects you. A drawer counted every couple of hours narrows any shortage to a couple of hours instead of the whole day. Nothing stops while you do it, and selling carries straight on.');

  m.h1('12.  Lock the till for a break, or hand it over');
  m.steps([
    'Press "Lock". The screen goes dark: "Till locked" and "The shift stays open."',
    'Coming back yourself: type your own number and press "Unlock".',
    { text: 'Somebody else taking over: they type their own number, and the screen says "Now ringing as {name}."', note: 'A takeover offers a count. It is worth doing — if the drawer is short later, it shows whether it happened before or after the handover.' },
  ]);
  m.p('The order on the screen and the open shift carry straight on. The drawer, the opening money and the closing count stay with whoever opened the shift, whoever is ringing.');

  m.h1('13.  See what is running low');
  m.p('Press "Buy Now" at the top. The list shows what is "OUT OF STOCK" first, then what is "RUNNING LOW", with how much there is and how much is short. "Print" puts it on the receipt printer so you can hand the slip to whoever is shopping. Things the kitchen makes itself — syrups, sauces — are left off on purpose, because nobody buys those. They are watched on the kitchen and bar screens instead. Only when there is nothing at all to buy does the slip say so and point you there.');

  m.h1('14.  Cancel a paid sale, or give one item back');
  m.p('A paid sale can only be undone the same day, always with a reason, and a supervisor must type their own number on the screen. That protects you as much as the shop: both names are written down.');
  m.h2('The whole sale (void)');
  m.steps([
    'Open "Orders". Search by order number or by cashier if you need to.',
    'Press "Void" in the "Action" column.',
    'Read the red warning, then type the reason.',
    'Hand the screen to the manager. They type their number under "Supervisor authorisation required".',
    'Press "Confirm Void". The row goes pale and reads "voided by {name}".',
  ]);
  m.h2('One item only (refund)');
  m.steps([
    'Open "Orders" and press the row to open it out. It shows "Sold", "Already refunded" and "Remaining".',
    'Press "Refund" beside the item. Give the quantity, the reason and how the money goes back.',
    { text: 'Leave "Restock inventory" ticked unless the item is damaged. Hand the screen over for the supervisor number, then press "Confirm Refund".', note: 'Hand the money back yourself. Clerque writes it down; it does not pay anything out.' },
  ]);
  m.careful('A supervisor cannot approve their own void — the app refuses their own number as the approver. What this means for the bar: a drink they had not yet marked ready was never made, so nothing of it is used; a drink already made is written down as waste. A cash refund takes money out of the drawer, and the closing count already expects that.');

  m.h1('15.  When the internet drops');
  m.steps([
    'An amber strip appears: "You\'re offline — orders are saved locally and will sync automatically when you reconnect."',
    'Keep selling. Ring the order exactly as normal.',
    'On the payment sheet only "Cash · Bayad" and "Split" work. The heading reads "Offline · Cash only".',
    'The receipt prints with an amber band, "OFFLINE ORDER — PENDING SYNC", and a temporary number starting "LOCAL-".',
    'When the connection comes back the sales send themselves. If any are stuck, open "Pending Sync" and press "Sync Now".',
  ]);
  m.careful('A shift cannot be opened or closed while the connection is down — both of those need the system. If it drops right at opening time, wait for it to come back before starting the shift.');
  m.p('Every saved sale carries its own tag, so it can never be counted twice, even if it is sent twice.');

  m.h1('16.  Close the shift and print the Z-read');
  m.steps([
    'Press "Close Shift". The top shows "Orders", "Total Sales", "Cash Sales" and "Digital".',
    'If anything was paid by phone, check the "Digital breakdown" against the shop\'s GCash and Maya before going further.',
    'The blue block does the sum for you: opening money, plus cash sales, less refunds, paid-outs and cash drops, ending in "Expected in drawer".',
    'Count the drawer for real and type it into "Actual cash in drawer (₱)". "Variance" appears as you type: "Balanced", "Overage" or "Shortage".',
    '"Notes (optional)" is where an explanation goes. Press "Close Shift".',
    'The "Z-read" opens. Press "Print Z-read", then "Close shift & sign out".',
  ]);
  m.stop('Type the real count, even when it is short. Never adjust it to fit. The difference is recorded with your name and the manager looks at it — an honest short count is a small thing, a changed one is not.');
  m.p('Trying to sign out with the shift still open brings up "Shift Still Open". Choose "Close Shift First, then Sign Out". Only the person who opened the drawer can close it, though a manager or the owner can close it for you if you had to go home.');

  /* ── first time only ── */
  m.h1('17.  Before this works — ask the owner');
  m.p('A few things in this guide need the owner to set them up once. Hand this page to the owner on the first day.');
  m.bullets([
    'Each person needs their own sign-in with the role "Cashier" AND a branch. Without a branch the till shows "This account has no branch" and nothing else.',
    'Each person needs a number of their own, set on the "Staff" page. Without it, the "PIN" tab and the "Lock" button cannot be used at all.',
    'A supervisor needs a Supervisor number, set in Settings under "Security". Until that exists, no void and no refund can be finished by anyone.',
    'Every drink needs a group, and every group must be pointed at the Bar or the Kitchen screen. A drink in a group pointed nowhere reaches nobody.',
    'Sizes and add-ons are set up by the owner on the Products page. They cannot come in from a spreadsheet.',
    'The shop needs a printer named as the receipt printer, or the till prints wherever the tablet happens to be pointing.',
    'Each ingredient needs an alert level, or "Buy Now" comes back saying nothing is below its alert level — even on a day the shelf is bare.',
  ]);

  m.h1('18.  If something goes wrong');
  m.faq('I rang the wrong drink.', 'Not charged yet? Press the bin on that line, or the minus to drop one. Already charged? It has to be a void or a refund on the "Orders" page, same day, with a supervisor.');
  m.faq('The customer paid GCash and I did not get the reference.', 'Ask them to open their GCash and read it out. It is on their confirmation message. Do not invent one.');
  m.faq('The drawer is short and I cannot find it.', 'Type the true count anyway and write what you know in the notes. Tell the manager tonight, not tomorrow — a same-day shortage is usually findable.');
  m.faq('The printer has stopped.', 'The printer button at the top is there at every screen size for exactly this. Press it, then print the receipt again from "Orders".');
  m.faq('I pressed "Pay out" with the wrong amount.', 'Nothing on the till can take it back. Tell the manager right away so it can be sorted before the count.');
  m.faq('A whole section of the menu on the left is grey with a small lock.', 'That is normal. Those parts belong to the owner. They are shown so you can see what the shop uses, not so you can open them.');
  m.faq('The help page inside the app says something different from this guide.', 'Trust this guide. The built-in help is older than the app: the shift button is "Start Shift" not "Open Shift", the "Lock" button really does hand the till to another person without closing the shift, and a cashier\'s end-of-day slip shows the drawer only.');

  /* ── cannot do ── */
  freshPage(m);
  m.h1('19.  What the till cannot do for you, and why');
  m.p('None of these is a fault, and none of them is about trust in you. They are the shop\'s safety rails, and most of them protect the person at the till more than anyone else.');
  m.table(['You cannot...', 'Why, and what to do instead'], [
    ['**Give a plain discount', 'The button is not yours. A Sales Lead, manager or the owner takes the till over with "Lock", applies it, and hands it back. Their name is on the discount, not yours.'],
    ['**Cancel a paid sale, or give an item back, on your own', 'You can start it on the "Orders" page, but a supervisor must type their number. Both names are recorded, which is what clears you if it is ever questioned. And a supervisor cannot approve their own, so it is always two people.'],
    ['**Undo yesterday\'s sale', 'Nobody can. Voids are same-day only. After that it is a refund, or a word with the owner.'],
    ['**Move money to the safe on your own, or take back a cash-out', 'A cash drop always names an approving manager, and so does a paid-out over ₱500. Once either is pressed there is no button anywhere to take it back — speak to the manager.'],
    ['**Close somebody else\'s shift', 'The drawer belongs to whoever opened it. A manager or the owner can close it if that person has gone.'],
    ['**See the day\'s takings on your slip', 'Your end-of-day slip shows the drawer only — money in, money out, what should be there. The sales figures are the owner\'s.'],
    ['**See what the shop paid for anything', 'Supplier prices are stripped out before they ever reach the till, and the "Buy Now" slip shows amounts only. There is nothing to look up.'],
    ['**Open the Dashboard, Products, Staff or Settings', 'Grey with a small lock, and the words "Your role doesn\'t have access to this section".'],
    ['**Take a phone or card payment while offline', 'Those need the connection. Cash only until it is back.'],
    ['**Send an order to the bar before it is paid', 'There is no button for it. The kitchen and bar pick the ticket up the moment payment is confirmed.'],
  ], [150, 365]);
  m.small('This guide describes Clerque as it works today. If a screen says something different from this page, trust the screen and tell the owner so the guide can be corrected.');

  return finish(m);
}

/* ═══════════════════════════════════════════════════════════════════════════
   2.  KITCHEN & BAR GUIDE
   ═════════════════════════════════════════════════════════════════════════ */
function buildKitchen() {
  const m = createDoc({
    title: 'Clerque — Kitchen & Bar Guide',
    subtitle: 'Your screen: the orders waiting, what to make ahead, and the count at the end of the week.',
    footer: 'Clerque Kitchen & Bar Guide',
    outPath: path.join(OUT_DIR, 'Clerque-Kitchen-and-Bar-Guide.pdf'),
  });

  m.callout('START HERE',
    'Your tablet should already open on your own screen — the Kitchen screen in the kitchen, the Bar screen at the bar. Nobody signs in and nobody types a password. If it asks you to sign in, or shows the wrong screen, see number 1. Something not working? Ask the owner first. If the owner is stuck too, email ' + SUPPORT + ' with the shop name, what you were doing, and a photo of what the screen said.');
  m.p('Three things on this screen keep the shop honest: tapping a ticket when it is really ready, writing down a batch when you make it, and writing down anything you throw out. Everything else follows from those three. Read this once from the front, then come back to the number you need.');

  m.h1('1.  Getting your screen up');
  m.h2('The normal way: a tablet that is already paired');
  m.p('A paired tablet needs no sign-in and stays paired for months. It sits on your screen and nothing else.');
  m.steps([
    'The owner or the cashier makes a code: in Counter, press "Displays" in the menu down the side, then the Kitchen or Bar card, then "Generate pairing code".',
    'A box shows the shop\'s "Company code" and a big four-digit number, counting down.',
    'On your tablet, open the shop page with /pair on the end. It reads "Pair this device".',
    'Type the company code, then the four numbers, and press "Pair device". The tablet goes to your screen and stays there.',
  ]);
  m.careful('The number lasts fifteen minutes and works once. Too late and it says "Code expired — ask for a new one." A Kitchen code will never show the Bar\'s orders.');
  m.p('If the screen ever says it is signed out or unpaired, nothing is lost. Press "Pair this screen again" and ask for a new code.');
  m.h2('The other way: your own sign-in');
  m.p('On a stand-in tablet, a phone or a laptop, sign in as yourself and open the bookmark for your screen. Keep that bookmark — the address never changes. A barista who also works the till can open it from the top of the Counter screen instead, where there is a button named after each screen.');
  m.careful('A cook signed in as themselves has no menu link to the Kitchen screen anywhere in the app. Ask the owner to put the bookmark on the tablet, or use a paired tablet.');
  m.callout('BEFORE THIS WORKS',
    'The station needs its screen turned on by the owner in Settings under "Floor Layout". Without it, pairing is refused with "That station has no screen turned on."', 'care');

  m.h1('2.  Turn the bell on, and give it its first tap');
  m.p('Do this every time the screen is opened or the tablet is restarted.');
  m.steps([
    'Look at the top right. "Bell on" in orange means it is on. "Bell off" in grey means it is off. Tap it to change.',
    'While an orange strip along the bottom asks you to tap the screen once, do it — tap an empty part, not a ticket.',
    'Tap "Test" to hear it. It rings twice for each new ticket.',
  ]);
  m.tip('That first tap is not fussiness. Tablets refuse to make any sound until somebody touches the screen. Without it the bell looks on and stays silent all morning.');
  m.p('The bell also rings when something made in advance turns into "needs doing now", and when a batch goes past its date. On or off is remembered on that tablet, not on you.');

  m.h1('3.  Read a ticket');
  m.bullets([
    'Each card is one order, with its number at the top. Oldest first.',
    'The clock at the top right of the card is how long the oldest thing on it has waited.',
    'A green edge is under five minutes. Amber is over five. Red is over ten.',
    'Under the number is each drink or dish. The size and add-ons are in the small grey line beneath it.',
    'Anything the customer asked for specially is in orange with a star. Read those first.',
    'Nothing to make? It says "All caught up".',
  ]);
  m.note('Only what the owner has sent to your screen appears here. A bottled drink or a pastry that nobody has to make never shows up, and that is right. If the screen cannot reach the shop it says so in words — it will never sit looking "All caught up" while orders are waiting.');

  m.h1('4.  Tap a ticket when it is ready');
  m.p('This is the most important tap on the whole screen.');
  m.steps([
    'Tap the line for the thing you have finished. It says "tap to bump" on the right until you do.',
    'The line turns green and gets a tick.',
    'When every line is tapped, the card leaves the screen.',
  ]);
  m.stop('That tap is the moment the milk, the beans, the cup and the lid come off the shelf in Clerque. Tap it once, when it is really ready — not early, and not all at once at closing. Tapping early makes the shop\'s numbers wrong for the rest of the day.');
  m.p('A ticket nobody ever taps is counted in the small hours anyway, so the books come right in the end — but the shelf was wrong all day and nobody knew. Tap as you go.');
  m.p('If it will not take: "This order was voided. There is nothing to make." means the till cancelled it. "This item was refunded." means the customer got their money back. Either way, do not make it.');
  m.callout('BEFORE THIS WORKS',
    'A drink only reaches your screen when the owner has ticked its group for your screen, in Counter under Products, then Categories, then "Prep screens". A group ticked nowhere prints on no screen at all.', 'care');

  m.h1('5.  Undo a tap made by mistake');
  m.steps([
    'A tapped line stays on the screen for about half a minute.',
    'Tapping it again is refused for you: "Only a supervisor or manager can undo a bump."',
    'Call the manager or the owner. They sign in on that screen and tap the line.',
  ]);
  m.p('Do not keep tapping. It will not work and nothing is broken. The undo also puts the milk and the beans back, which is why it belongs to somebody in charge.');

  m.h1('6.  Orders, prep levels, or both');
  m.p('The three buttons at the top share the screen out. "Orders + prep" is the usual one: orders across most of it, what is made in advance down the right. "Orders" gives the whole screen to the orders, and the number beside it is how many are still to make. "Prep levels" gives the whole screen to what is made in advance. "Full screen" hides everything around the edges, and stops the tablet going to sleep.');
  m.p('Whichever you pick, the orders keep coming in underneath and the bell still rings. Your choice is remembered on that tablet.');

  m.h1('7.  Read the prep levels');
  m.p('Look at these at opening, after the rush, and whenever the bell rings for them.');
  m.bullets([
    'Each card is one thing — a sauce, a syrup, breve milk. Read it from the top down.',
    'The headline says the one thing to do, like "Level 1: 12 servings left — make a batch from Level 2."',
    '"Level 1" is the tub you serve from. "Level 2" is the one behind it. "Level 3" makes Level 2.',
    'Red means do it now. Amber means next. Green means fine. Grey means nobody set a warning level, so nothing is watching it.',
    'Beside Level 1 it may say roughly how many servings are left.',
    'Worst first. Cards that need nothing sit lower down.',
  ]);
  m.p('"Every prep level is fine." means all clear. If it adds that items with no warning level are not checked, tell the owner — those are the ones that run out with no warning at all. Use-by amounts are worked out on the shelf, not counted: the oldest batch is taken to be used first. A card that says something is out, with the button greyed, cannot be fixed from this screen — put it on the asking list instead (number 11).');
  m.callout('BEFORE THIS WORKS',
    'Only things the owner has set up appear here, in Procure under "Prep & batches" — each with its recipe, how much one batch makes, and a warning level. With nothing set up the screen says "No pre-made items here."', 'care');

  m.h1('8.  Write down a batch you just made');
  m.p('The moment the batch is made or moved — not later when the tub runs low.');
  m.steps([
    'Find the card. Under the button it says what one batch uses.',
    'Tap the orange button once. It changes to "Tap again to record 1 batch" and glows for about five seconds.',
    'Tap it again. A green message confirms what was recorded.',
    'One batch per pair of taps, at the size the recipe says. There is nothing to type. Two batches means doing it twice.',
  ]);
  m.tip('Two taps on purpose. One tap used to be enough, and a knocked tablet took ingredients off the books with nothing to undo it. If you wait too long the button goes back to its own words — just start again.');
  m.p('Tapping twice by accident, or tapping again after the connection drops, never records it twice: it answers "Already recorded. Nothing was made again."');
  m.p('If it will not go through, it tells you why — usually not enough of something, and it names what and how much. Nothing was recorded. Something belonging to the other screen is refused too: each of you records your own.');
  m.careful('Made ahead of the rush — wings marinated overnight, syrup cooked early? Write it down then. Until you tap, the raw ingredients look untouched and the day\'s sheet is wrong.');

  m.h1('9.  Throw something out');
  m.p('The moment it happens.');
  m.steps([
    'Tap "Today\'s inventory" at the top.',
    'Find the item and tap "Thrown out" under its name.',
    'Say how much. For things bought by the pack there is a one-tap button for a whole pack.',
    'Pick why: "Spoiled", "Past its date", "Dropped or spilled" or "Other".',
    'Add a few words if it helps, then tap "Record it".',
  ]);
  m.tip('This is not telling on anybody. It takes the milk off the shelf in Clerque and puts it in the thrown-out column, so the numbers match the fridge and the owner buys the right amount. Milk quietly poured away is milk the shop thinks it still has — and then somebody is short on a Saturday.');
  m.p('If it says the books show less than you threw out, record what you can and tell the manager so the count can be put right. If it says the item is not on your sheet, it belongs to the other screen — ask the manager. And it can only go on today\'s sheet: step back a day and the buttons are gone.');

  m.h1('10.  Read today\'s sheet');
  m.steps([
    'Tap "Today\'s inventory". The heading names whose sheet it is, with the day, and "Running" or "Closed".',
    'Each line is one item, in groups: what is made in advance, ingredients, and supplies.',
    'Read the columns across: what you started with, what came in, what was thrown out, what the drinks and dishes used, and what should be there now.',
    'The arrows at the top step back and forward a day.',
    '"Print" prints it on paper with lines to sign. "Close" goes back to the orders — they keep coming in behind it and the bell still rings.',
  ]);
  m.p('Amounts only. There is no money anywhere on this sheet, on purpose. If a note in orange says some items are still at the kitchen or bar screen, those are tickets nobody has tapped ready yet.');

  m.h1('11.  Ask for what is running low');
  m.p('Once a day near closing, or the moment you notice something short.');
  m.steps([
    'Tap "Request what\'s running low".',
    'Clerque works out what is needed for the next day, puts it on the branch\'s one list, and sends it to the owner.',
    'A box tells you what happened, and what is new, what was raised, what is already on the way, and what you could make instead of buying.',
    'Tap "Done" when you have read it.',
  ]);
  m.p('The kitchen\'s tap and the bar\'s tap go on the same list, so nothing is asked for twice. Tapping again is safe. You are asking, not buying — the owner does the buying.');
  m.careful('In the first weeks it says Clerque is still learning the shop\'s usage. An empty list then does not mean all is well. Add what you know is short with "Add something".');
  m.h2('Add something the list cannot see');
  m.steps([
    'Inside the same box, tap "Add something".',
    'Type the name. Tap it if it is already there.',
    'If it is new, tap "New item", mark it as a kitchen, bar or office supply, and pick how it is measured.',
    'Set how much with minus and plus, then tap "Add and send".',
  ]);
  m.p('Tissue, dish soap, cling film, a new syrup nobody has bought before — this is where they go. Twenty things at most in one go.');

  m.h1('12.  The weekly count');
  m.p('Once a week, when the button says "Count due" with an orange dot. Best before opening or after closing.');
  m.steps([
    'Tap "Count due". The panel says "Weekly count" with your screen\'s name and how far along you are.',
    'On a paired tablet it asks "Who is counting?" once. Type your name — the owner sees who counted.',
    'Go down the list. Tap an item, then say how many full packs and how much is open or loose. It checks back what that adds up to.',
    'Tap "Save and next". Nothing left of something? Tap "None left".',
    'When it says everything is counted, tap "Send to the owner".',
  ]);
  m.stop('Count what is really there — in the shop, the fridge and the shelf. The screen never shows you what Clerque thinks should be there. That is on purpose, so the count is honest and not a guess at the right answer.');
  m.p('Saving and sending change nothing at all. Only the owner moves the numbers, after looking at what you counted. Counting an item again before you send simply replaces the first figure.');
  m.p('Sending partway asks first, and what is not counted is left out. If it says some orders are still being made, finish those tickets — the numbers settle once they are tapped ready. After sending, the count is closed and cannot be edited.');
  m.h2('When the owner asks for a second look');
  m.p('The button shows "Count due" again and a note names the items. Those rows are marked "Count again", and the panel jumps from one to the next. Count just those and send. Being asked again is normal — it usually means a delivery or a thrown-out item was not written down, not that anybody did anything wrong.');

  m.h1('13.  Print a ticket at your own printer');
  m.p('If your shop has a small printer on this tablet, a printer picture sits at the top right of a ticket. Tap it and the ticket prints there — the kitchen tablet on the kitchen printer, the bar tablet on the bar printer. On a computer the picture is simply not there, and nothing is wrong.');

  m.h1('14.  At closing');
  m.steps([
    'Clear the rail: tap every finished line until the screen reads "All caught up".',
    'Write down anything thrown out during the day that is not written down yet.',
    'Write down any batch made late that is not written down yet.',
    'Tap "Request what\'s running low" so the owner has tomorrow\'s list.',
    'Open today\'s sheet and read down the last column. If a number looks wrong, say so tonight — it is far easier to find today than next week.',
    'If your shop signs the sheet, tap "Print", sign it, and leave it for the manager.',
    'Leave the tablet on and on this screen. A paired tablet needs nothing else.',
  ]);
  m.p('The day\'s sheet closes when the last shift at the till is closed. Anything thrown out or made after that goes on the next day\'s sheet. If nobody taps the asking list, Clerque sends it to the owner at closing anyway.');

  /* ── cannot do ── */
  freshPage(m);
  m.h1('15.  What your screen cannot do, and why');
  m.p('None of this is about trust. These are the shop\'s safety rails, and a few of them exist to keep you out of arguments you should never be in.');
  m.table(['You cannot...', 'Why, and what to do instead'], [
    ['**Undo a ticket you tapped ready', 'A manager or the owner signs in on that screen and undoes it. The undo puts ingredients back on the shelf, so it belongs to somebody in charge.'],
    ['**Cancel or give money back on a sale', 'That is the till, the same day, with a reason and a supervisor\'s number.'],
    ['**Type a stock number in to fix it', 'Only three things move stock from your screen: tapping a ticket ready, writing down a batch, and writing down something thrown out. Everything else is the owner.'],
    ['**Make the weekly count change anything', 'A count is a record, nothing more. The owner compares it and decides. Do not tell anyone that counting "fixes" the number.'],
    ['**See what Clerque expects while counting', 'Deliberately hidden. A blind count is an honest count.'],
    ['**Write down the other screen\'s batch', 'The bar records the bar\'s, the kitchen records the kitchen\'s. It will say so if you try.'],
    ['**Write down something thrown out on an earlier day', 'Today\'s sheet only. Anything older goes through the manager.'],
    ['**Buy anything, or take in a delivery', '"Request what\'s running low" asks. The owner buys.'],
    ['**Pair a tablet, turn a screen on, or set up what the shop makes in advance', 'All of that belongs to the owner, on the Counter and Procure screens.'],
  ], [175, 340]);
  m.h2('And one thing nobody will ever ask you');
  m.p('You will never be asked what anything costs, what a drink sells for, what the shop took today, or what anybody is paid. None of it is on your screen. Every price is stripped out before your screen ever sees it, so there is nothing there to look up even by accident. Your screen deals in amounts — millilitres, grams, packs, servings — and nothing else.');
  m.small('This guide describes Clerque as it works today. If a screen says something different from this page, trust the screen and tell the owner so the guide can be corrected.');

  return finish(m);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3.  OWNER GUIDE
   ═════════════════════════════════════════════════════════════════════════ */
function buildOwner() {
  const m = createDoc({
    title: 'Clerque — Owner Guide',
    subtitle: 'Setting the shop up once, then running it: the day, the week, and the money that never goes through the till.',
    footer: 'Clerque Owner Guide',
    outPath: path.join(OUT_DIR, 'Clerque-Owner-Guide.pdf'),
  });

  m.callout('START HERE',
    'Go to the shop page and sign in: the shop code in "Tenant ID", your email, your password, then "Sign in to Clerque Counter". You then choose which part to open — Counter for the till, the menu, the staff and the sales figures; Procure for ingredients, buying and counts; Ledger for the money. Inside any of them, "Switch app" in the left menu takes you to another. Stuck? Email ' + SUPPORT + ' with the shop name, what you were doing, and a photo of what the screen said.');
  m.p('Clerque is three parts on one sign-in. You ring the sale; Clerque records the money, takes the ingredients off the shelf, and works out the profit. You never have to do the accounting, but you can always see it.');
  m.callout('IF THE SHOP IS NEW',
    'Do section 4, "First time only", before anything else. Most of those fifteen jobs take five minutes each, and two of them — the closing time and the alert levels — decide whether half of this guide works at all.', 'tip');

  /* ── THE DAY ── */
  m.h1('1.  Your day');
  m.h2('1.1  Watch the day');
  m.p('Counter, then "Dashboard". The arrows at the top move between days.');
  m.bullets([
    '"Profitability (today)" shows gross profit, what the sales cost you, and the margin.',
    'Below that: sales today, the average sale, non-cash sales, and voids and refunds.',
    'Further down: how people paid, your best sellers, and sales by hour.',
    'A card at the top shows what the kitchen and bar still have to make.',
  ]);
  m.careful('An amber box saying profit reporting is at risk means some items have no cost recorded, so the profit on the screen is flattering. "Fix products now" goes straight to the list. Fix it the day you see it.');
  m.note('A cashier who reaches this page sees their own counts only, with no money figures. That is deliberate.');

  m.h2('1.2  Read the bell');
  m.p('The bell in the top bar carries everything Clerque wants you to know. A number on it is how many are unread. Press a message to go to the page it is about.');
  m.p('Every night Clerque works out what is out of stock, what is running low and what needs making, and leaves one message. The same bell carries overdue bills, the reminder to close the month, and the end-of-day list of what the day used. If nothing has changed since last night, it does not repeat itself.');

  m.h2('1.3  The buy list the staff send');
  m.p('Procure, then "Purchase request".');
  m.steps([
    'The kitchen and the bar press "Request what\'s running low" on their own screens, and it lands here. Both go on the same list, so nothing is asked for twice.',
    'On the laptop, "Check stock" pulls in everything at or below its alert level. "Add" puts something on by hand.',
    'When the list is ready, press "Send to the owners".',
    '"Send as message" copies it for Viber or Messenger. "Share PDF" makes a copy for the group chat.',
  ]);
  m.note('If nobody sends one, Clerque sends it at closing so the shopping is never missed. That needs the branch closing time to be set — see 5.4.');

  m.h2('1.4  Record what was bought');
  m.steps([
    'Open the sent list. Tick each thing that was bought.',
    'Fill in how many packs, the size of a pack, and the price per pack. Brand is optional.',
    'Say where it was bought and when. The line adds up for you as you type.',
    'Press "Save what was bought".',
    'Something bought that was not on the list: press "Record something you bought", pick it, say how much, fill in the price, save.',
  ]);
  m.tip('Last time\'s price is filled in for you and marked as such. Check it against the receipt — it is the single most common way a wrong cost gets in.');

  m.h2('1.5  Put the shopping into stock and say who paid');
  m.steps([
    'Answer "Who paid for this?": "Owner paid" out of your own pocket, "Shop cash" (cash kept apart, like the safe), or "Shop bank / GCash".',
    'Set the day the goods came, and add a note if it helps.',
    'Add anything that was not stock — delivery, a platform fee — on the charges rows.',
    'Press "Add it all to stock". If only some arrived, it says so and takes the rest.',
    'A pack that came short: fill in how many really arrived and say whether the rest is still coming, lost, refunded, or not coming.',
  ]);
  m.stop('"Shop cash" is deliberately not the till drawer. Paying for ingredients out of the till leaves the drawer short at closing and the cashier carrying the blame. There is no way in Clerque to pay from the drawer and add stock at the same time, and that is on purpose.');
  m.careful('If a price is ten times above or below what is on file, Clerque refuses it as a likely slip of the finger until you tick that the price really changed that much. Do not tick it out of habit.');
  m.p('Money and goods are two separate moments. Something paid for on the day it was ordered shows as paid then, and waits for the parcel.');

  m.h2('1.6  Take in a delivery with no list');
  m.p('Procure, then "Stock on hand", then "Receive stock" on the row. Fill in the quantity, "Cost / unit (₱)", the receipt date and who paid, and press "Receive". The books are written for you.');
  m.p('Spoiled milk or a dropped bottle: "Write off" on the same row, with the amount and the reason. A whole supermarket receipt can go in at once at Procure, then "Upload a receipt" — the ingredients go into stock, the rest into the books, and the photo is filed beside it.');
  m.tip('Receiving at a new price updates the average cost, and every recipe that uses that ingredient follows on its own. You never have to edit a drink because the supplier put prices up.');

  m.h2('1.7  The day\'s Z-read');
  m.p('The cashier counts the drawer at "Close Shift" and the screen says balanced, over or short. Pressing it again shows the Z-read, which prints.');
  m.p('To look at past days: Ledger, then "Reports", then "Z-Read History", choose the dates, and export.');
  m.careful('Check the digital breakdown against the shop\'s GCash and Maya the same day. A difference found today is findable; the same difference next week is not. And if nobody closes the last shift, Clerque writes the day\'s Z-read itself, so no day is ever left without one.');

  m.h2('1.8  Money that left the drawer during the day');
  m.p('A cashier can record money spent from the till, or notes moved to the safe, with "Cash Out". Both lower what the drawer is expected to hold, so the closing count still balances. A move to the safe always names an approving manager, and so does anything spent over ₱500 — so expect to be asked in person before it is recorded. There is no undo on the till, so if a cashier tells you a wrong amount went in, sort it before the count.');
  m.stop('Ingredients must never be paid for out of the drawer. That kind of entry never adds stock, so the shop keeps selling drinks it no longer has. Buy from "Shop cash" instead, and record it in Procure.');

  m.h2('1.9  The end-of-day list of what the day used');
  m.p('It arrives on the bell, and on the phone if Telegram is linked, when the last shift is closed — or two hours after the closing time if nobody closed it.');
  m.bullets([
    'Each ingredient, and how much of it went.',
    'Under it, how much was thrown out and how much was written off.',
    'At the bottom, what the day used in pesos.',
    'Press the message to open the full list.',
  ]);
  m.note('It covers the hours from when the day before closed to when this day closed, not midnight to midnight, so a late-night sale lands on the right day. It goes only to you and to managers of that branch. If it mentions items still sitting at the kitchen or bar screen, those are tickets nobody tapped ready — nothing is counted for them until somebody does.');

  /* ── THE WEEK ── */
  m.h1('2.  Your week');
  m.h2('2.1  The weekly count, and making the books match the shelf');
  m.p('The cook and the barista count their own areas on their own screens and send the numbers to you. Nothing has moved yet when they do.');
  m.steps([
    'Procure, then "Cycle counts". The row has a "Review" button.',
    'At the top it says the count is recorded and that stock and the books have not changed.',
    'Read the lines: what was counted, what the books say, and the difference. The pills show only what differs, or everything, or what was never counted.',
    'Either tick the doubtful ones and press "Ask for a recount" — the station is shown those again — or press "Adjust the books to match".',
    'Choose "Routine count", or for the shop\'s very first count, "Opening stock".',
  ]);
  m.stop('"Adjust the books to match" cannot be undone. Neither can a count be edited — a wrong number is counted again, never corrected. Read the differences before you press it.');
  m.p('Anything sold while they were counting is kept: stock moves by the difference the count found, not to a fixed number. If two areas counted the same thing, the newer count stands. You can also start a count yourself from this page.');
  m.note('A message about this says "Procure > Counts". On the screen the tile is called "Cycle counts". Same thing.');

  m.h2('2.2  Chase up the GCash and Maya money');
  m.p('Money paid by phone is not in the bank on the day of the sale. Clerque keeps it waiting until you say it arrived.');
  m.steps([
    'Ledger, then "Settlement", then "New Batch". Choose the payment method and the dates.',
    'When the money lands in the bank, press "Confirm" on that batch.',
    'Fill in "Actual Amount Received (₱)", the date it arrived, and the bank reference. Press "Confirm Receipt".',
  ]);
  m.careful('If the amount that arrived does not match what was expected, it is marked as disputed rather than quietly absorbed. That is the point — a fee or a shortfall you never see is a fee you pay forever.');

  m.h2('2.3  Read the reports');
  m.bullets([
    'Money in and profit: Counter, then "Sales Report" — takings, gross profit and margin, average sale, voids, a table by day, how people paid, and best sellers. It exports.',
    'What the ingredients did: Procure, "Stock on hand", then "Reports" — stock on hand, purchases, what was used, and the daily sheet.',
    'Every single stock change: Procure, "Stock on hand", then "Movement Log" — sales, deliveries, batches, write-offs and adjustments, in one place.',
    'What is holding the menu back: Procure, then "What is limiting the menu" — the one ingredient behind each "x left" number on the till, with a button to put it on the buy list.',
    'Where things come from: Procure, then "Where things are bought".',
  ]);

  m.h2('2.4  See this month\'s profit');
  m.p('Ledger, then "Record Entry". The card at the top shows money in, money out, and profit, with arrows to look at earlier months. Money you put in or take out, and moving cash between the drawer and the bank, do not change profit — the card says so underneath.');

  /* ── MONEY OUTSIDE THE TILL ── */
  m.h1('3.  Money that never goes through the till');
  m.p('Rent, the electric bill, wages, a new fridge, your own money going in or out. Ledger, then "Record Entry".');
  m.steps([
    'Pick a tile under "What happened?": "Expense", "Other income", "Bought equipment", "Paid wages", "Owner put in", "Owner took out", "Cash → Bank" or "Bank → Cash".',
    'Fill in "Amount (₱)" and the date. For an expense, pick a category — Rent, Utilities, Supplies, Repairs, Transport or Other.',
    'For equipment, say what was bought. Equipment is recorded as something the shop owns, not as this month\'s cost.',
    'Choose where the money came from: "Cash", "Bank", and for equipment and wages also "Owner".',
    'Add a short note and press "Save entry".',
  ]);
  m.tip('Got it wrong? Press "Reverse" on that line in "Recent entries". An opposite entry is written and the original stays, struck through. Nothing is ever deleted, which is exactly what makes the books worth trusting.');

  /* ── SETUP ── */
  freshPage(m);
  m.h1('4.  First time only');
  m.p('Fifteen jobs, once. Most take five minutes. Two of them decide whether the rest of Clerque works, and they are marked.');

  m.h2('4.1  Fill in the shop\'s own details');
  m.p('Settings, then "Business Profile", then "Business Details". Fill in the name, the tax number, the contact email and phone, and the address, then save. This name prints at the top of every receipt. Only you can change these — everyone else sees that only a business owner can edit them. Sign out and back in afterwards so new receipts pick it up.');

  m.h2('4.2  Put the shop\'s logo on the receipt');
  m.p('Settings, then "Business Profile", then "Business Logo". Press the square that says "Add logo" and choose the picture. A square one reads best. It must be under 1 MB. The small paper printer prints words only, so the logo shows on the screen receipt and on one printed from the browser, not on the little slip.');

  m.h2('4.3  Change the words on the receipt');
  m.p('Settings, then "Business Profile", then "Receipt Template". A short line under the shop name, and a footer that replaces "Thank you" — the wifi name, the Facebook page. Watch the preview, then save.');
  m.note('Every receipt prints today as an "ACKNOWLEDGEMENT RECEIPT" with the line saying it is not an official receipt. That is decided by the shop\'s own tax registration, not by this page. Keep issuing the shop\'s registered receipts exactly as today.');

  m.h2('4.4  Set the closing time  —  the one the whole evening depends on');
  m.p('Settings, then "Branches", then the branch, then "Closes at". Fill in the hour the shop shuts, and save.');
  m.stop('Leave this empty and two things never happen at all: the end-of-day list of what the day used is never sent, and the buy list is never sent automatically at closing. There is no other screen that works around it. Do this on day one.');
  m.p('Clerque closes the day when the last shift is closed. If nobody closes it, Clerque does it two hours after this time. A shift closed more than two hours before closing is treated as a handover, not the end of the day.');

  m.h2('4.5  Add the staff and give each one the right job');
  m.p('Counter, then "Staff", then "Add Staff". Give the full name, the email, a temporary password of at least eight letters, and the role.');
  m.table(['For...', 'Choose'], [
    ['**The person at the till', 'Cashier. Opens shifts, rings sales, takes payments.'],
    ['**The barista who also rings sales', 'Cashier.'],
    ['**The barista who only works the bar screen', 'General Employee.'],
    ['**The cook', 'General Employee. They can still open the Kitchen screen, the buy list, the prep and the weekly count.'],
    ['**Someone who helps run the shop', 'Branch Manager.'],
    ['**Someone who only approves voids and discounts', 'Sales Lead.'],
  ], [175, 340]);
  m.steps([
    'Fill in the "Kiosk PIN" so they can sign in with a number instead of a password.',
    'Open "Edit" on the new person and set their branch.',
  ]);
  m.stop('Give everyone a branch. Without one, the till, the prep and the count screens simply refuse to open and say the account is not assigned to a branch. This is the most common first-day problem.');
  m.careful('Do not tick "clock-only employee" for the cook or the barista — that person can punch in but can never sign in, so they could not open their screen. And everyone needs their own account: signing in anywhere signs that person out everywhere else.');

  m.h2('4.6  Numbers and passwords');
  m.bullets([
    'Give or change someone\'s number: Counter, "Staff", "Edit", then "Kiosk PIN".',
    'Reset a forgotten password: Counter, "Staff", the round arrow on that row, type a new one, press "Reset Password". Ask them to change it after they sign in.',
    'Each person can set their own number at Settings, then "Security", then "Till & login PIN", and change their own password on the same page.',
  ]);
  m.p('The same number does three jobs: signing in, unlocking the till after a break, and punching in. Two people cannot share one — Clerque refuses and names whoever has it. Changing a password signs that person out on every other device.');
  m.note('Only you can reset somebody else\'s password. Not a manager. Do not promise a manager they can.');

  m.h2('4.7  Set your Supervisor number');
  m.p('Settings, then "Security", then "Supervisor PIN". Four to six digits, typed twice, with your password to confirm.');
  m.stop('Until this exists, nobody in the shop can finish a void or a refund — the cashier starts it and there is nothing to approve it with. Set it before the first day of trading.');
  m.careful('This is a different number from the one you sign in with. Do not use the same digits. Make it six if a tablet with the separate Counter app is ever used, because that one needs exactly six. A cashier never sees it: they hand the screen over, the number is typed, and both names go on the void.');

  m.h2('4.8  Keep what things cost away from the staff');
  m.p('Settings, then "Business Profile", then "Delivery Costs on the Shopping List". Turn off "Staff can see delivery costs".');
  m.stop('Staff can see delivery costs BY DEFAULT. Until you turn this off, a cook or a barista opening a shopping list sees supplier prices and the receipt photo. If the shop keeps its buying to itself, this is a day-one job.');
  m.p('With it off, the price boxes, the receipt photos, the reports link on the ingredients page and each ingredient\'s own page all disappear for staff. They keep what was asked for, what was bought, and how much arrived. The movement log stays visible to them — it has no money column at all.');
  m.note('Buying alerts on the phone show what was paid, which is the second reason only you and your managers can receive them.');

  m.h2('4.9  Send drinks to the Bar screen and food to the Kitchen screen');
  m.p('Counter, then "Products", then "Categories", then the "Prep screens" panel at the top. Under each screen\'s name, tap the grey pills for the groups that screen makes. A green pill means it goes there. Tap it again to take it off, or tap it under the other screen to move it.');
  m.stop('A group ticked nowhere prints on no screen at all. The drink sells and nobody is told to make it. Anything left grey is listed below as not on any screen — right for a bottled drink, wrong for anything somebody has to prepare. Read that list before you go live.');
  m.careful('A group can feed one screen only. Ticking it on the other moves it rather than sending it to both. There is no way to make one group print in two places.');

  m.h2('4.10  Rename or join up the Bar and Kitchen screens');
  m.p('Settings, then "Floor Layout". The pencil renames a screen. If the shop was set up with a hot bar and a cold bar but works as one, press "Merge into single Bar" and everything routed to either one moves across.');
  m.careful('The number of screens is fixed by the shop\'s setup. Adding a kitchen or splitting a bar back apart is not something you can do from here — and a merge can only be undone by us. Ask before you merge.');

  m.h2('4.11  Set up the kitchen and bar tablets');
  m.steps([
    'Counter, then "Displays". Press "Generate pairing code" on the Kitchen or Bar card.',
    'It shows the company code and a big four-digit number, counting down.',
    'On the tablet, open the shop page with /pair on the end and type those two things. The square code fills the number in if the camera reads it.',
    'The tablet is then listed under "Paired devices" with when it was last seen. "Revoke" unpairs it.',
  ]);
  m.p('The other way is for the cook and the barista to sign in on the tablet and open their screen. Both work. A paired tablet with nobody signed in can see the queue and press orders through, but sending the buy list and the weekly count needs a signed-in person.');
  m.careful('Leave the screen in front on the tablet. Browsers slow down a page left behind another one, and new orders stop arriving. And a cook signed in as themselves has no menu link to the Kitchen screen anywhere — put a bookmark on their tablet, or pair it.');

  m.h2('4.12  Tell Clerque when each ingredient is running low  —  the second one that matters');
  m.p('Procure, then "Stock on hand". Open an ingredient and fill in its alert level: the amount at which somebody should buy more. "Low stock only" at the top shows just the short ones.');
  m.stop('An ingredient with no alert level is watched by nothing at all: not the nightly message, not "Check stock" on the buy list, not the count on the Procure home page, and not the cashier\'s "Buy Now". There is no shop-wide fallback. The nightly message even tells you how many are unwatched.');
  m.tip('Do not try to do all of them. Spend an hour on the thirty or forty things the shop actually runs out of, and add the rest as they bite.');

  m.h2('4.13  Set up the things the shop makes in advance');
  m.p('Procure, then "Prep & batches", then "Set up what you prep", then "Set up something you make".');
  m.steps([
    'Pick the ingredient if the shop already buys or counts it, so it keeps its history. Otherwise give it a name and say how it is measured.',
    '"One batch makes" — roughly how much one pot yields. Do not know? Start from what goes in; the cook can measure the first pot and the number corrects itself.',
    'List what goes into one batch, and how much of each.',
    '"Tell me when it drops below" — the point where somebody should start the next batch.',
    'Press "Set it up".',
  ]);
  m.stop('Until a syrup is set up this way, making it moves nothing. The sugar and the water stay on the books and the syrup runs out mid-service while Clerque still believes it is there.');
  m.careful('Leave the warning level blank and nothing will ever tell anyone it is running out. The card says so on its face. The cook and the barista can write down a batch themselves, but only you or a manager can set one up.');

  m.h2('4.14  Get every sale and every buying step on the phone');
  m.p('Settings, then "Telegram alerts". Press "Make my link", then "Open Telegram" on the phone that should get the messages, and press "Start" there. The page turns green when it is linked. Tick what you want: every sale, and the buying messages — a list sent, what was bought and for how much, receipt photos, when it goes into stock, and each day\'s ingredients used. "Send a test alert" checks it.');
  m.careful('The link is personal, works once, and lasts ten minutes. Do not forward it or photograph it. Each person links their own phone, and only you and branch managers can link at all — the buying messages show what the shop paid. Sale messages leave out card numbers and customer details.');
  m.note('If the page says Telegram is not switched on for Clerque yet, that is ours to fix. Ask us.');

  m.h2('4.15  Choose which books you want');
  m.p('Settings, then "Business Profile", then "Ledger mode". "Simple books" records money in and out and shows your profit, with no accounting words. "Full accounting" adds the journal, statements, bills, tax and periods. Sign out and back in for it to take effect.');
  m.p('Nothing is lost either way — the records are the same, only more of them are shown. Simple books gives a coffee shop everything it needs day to day. Closing a month, so nothing can be back-dated into it, only exists on full accounting. Decide with us which one to go live on.');

  /* ── TROUBLE ── */
  freshPage(m);
  m.h1('5.  If something looks wrong');
  m.faq('Sales went missing after the internet dropped.', 'Counter, then "Pending Sync", then "Sync Now". Each sale carries its own tag, so nothing is ever counted twice.');
  m.faq('The profit looks too good.', 'The amber box on the Dashboard names how many items have no cost recorded. Press "Fix products now" and give them one.');
  m.faq('Stock looks untouched by sales.', 'Check that Settings, "Business Profile", "Ingredient Deduction" is not paused. If it was paused while recipes were being written, Procure, "Stock on hand", "Recipe Catch-Up" replays the backlog.');
  m.faq('Procure says it could not check stock levels.', 'Open the buy list and check the shelf by hand before anybody leaves for the market. Do not send people out on a list that did not load.');
  m.faq('A screen says the account is not assigned to a branch.', 'Counter, "Staff", "Edit", set the branch. See 4.5.');
  m.faq('Nothing appears on a kitchen or bar tablet.', 'Two things to check: the group is ticked under that screen in "Prep screens" (4.9), and the tablet\'s page is in front rather than behind another one.');
  m.faq('No end-of-day message arrived.', 'The branch has no closing time. See 4.4.');
  m.faq('An account is locked out.', 'Five wrong tries in fifteen minutes does it, and it clears itself after fifteen minutes. Nothing to do.');
  m.faq('Somebody was let through where they should not have been.', 'Settings, then "SOD Violations" — the shop\'s record of every time somebody was let past a rule. Voids, price changes, settings changes and sign-ins are all written down there and cannot be erased.');
  m.faq('I do not understand a message on the screen.', 'Photograph it and send it to us with what you were doing at the time. That is almost always enough to answer it in one reply.');

  m.h1('6.  What only we do');
  m.bullets([
    'Create the shop and its code, and set its tax standing and tax number.',
    'Decide what the receipt is allowed to say, and switch it over when the shop\'s own permit is on file.',
    'Add a screen beyond the ones the shop already has, or undo a merged bar.',
    'Unlock an account that will not clear, sign a stuck device out, or freeze the shop if something has gone badly wrong.',
    'Load the shop\'s ingredients, recipes and opening balances from a file.',
  ]);
  m.p('Email ' + SUPPORT + ' with the shop name, what you were doing, and a photo of the screen.');
  m.note('Nobody at HNS looks at the shop\'s money. What we can see is whether things are running, never what was earned.');

  /* ── cannot do ── */
  freshPage(m);
  m.h1('7.  What even the owner cannot do, and why');
  m.p('You can do almost everything in Clerque. These are the handful you cannot, so you never spend an evening looking for a screen that is not there.');
  m.table(['You cannot...', 'Why, and what to do instead'], [
    ['**Have a branch manager ring sales at the till', 'A manager supervises the till; they do not ring on it. That separation is exactly what makes their approval of a void worth anything. You yourself can open a shift and ring sales — in a shop this size the owner is meant to.'],
    ['**Make a manager who can only look', 'The roles are a fixed list. The only lever is changing somebody\'s role. The extra ticks on the staff screen only ever add, never take away — do not rely on them to hold a manager back.'],
    ['**Add a Kitchen or Bar screen, split a bar, or undo a merge', 'The number of screens is fixed by the shop\'s setup. Ask us.'],
    ['**Make one menu group print on both screens', 'A group feeds one screen only.'],
    ['**Load sizes and add-ons from a spreadsheet', 'They are set by hand on the Categories and Products screens.'],
    ['**Edit or undo a weekly count', 'The numbers are a record. The only correction is to ask for a recount. "Adjust the books to match" cannot be undone either.'],
    ['**Print the logo on the small paper slip', 'That printer prints words only.'],
    ['**Change the business type, tax standing or tax number', 'Set once, at setup. Ask us.'],
    ['**Print an official receipt from Clerque', 'Every slip prints as an acknowledgement receipt with the disclaimer. Keep issuing the shop\'s own registered receipts. We switch it over when the permit for Clerque is on file, and never before.'],
    ['**Work around a missing closing time', 'There is no other screen for it. Without it the evening messages simply never happen.'],
    ['**Fall back on a shop-wide low-stock level', 'An ingredient with no alert level is watched by nothing.'],
    ['**Switch Telegram on yourself', 'If the page says it is not set up, only we can fix it.'],
    ['**Pay for ingredients from the till drawer', 'There is no way to record a drawer payment that also adds stock. "Shop cash" is deliberately cash kept apart from the till.'],
  ], [185, 330]);
  m.h2('And one thing worth knowing about the cost-hiding switch');
  m.p('Turning off "Staff can see delivery costs" hides prices, receipt photos and the ingredient pages from staff. It does not hide the movement log, which staff can still open — but that log has no money column, so what they see there is amounts moving, never what anything cost.');
  m.small('This guide describes Clerque as it works today. If a screen says something different from this page, trust the screen and tell us so the guide can be corrected.');

  return finish(m);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
Promise.all([buildOwner(), buildCashier(), buildKitchen()])
  .then((paths) => paths.forEach((p) => console.log('written: ' + p)))
  .catch((e) => { console.error(e); process.exit(1); });
