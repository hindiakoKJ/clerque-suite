/**
 * Clerque — Admin How-To (for the HNS operator setting up and supporting tenants).
 * Labels quoted from the real Console / owner Settings / Counter app.
 * Re-run:  node apps/api/scripts/gen-admin-howto.js
 */
const path = require('path');
const { createDoc, finish } = require('./lib/manual-pdf');

const OUT = path.resolve(__dirname, '../../../onboarding/Clerque-Admin-How-To.pdf');
const m = createDoc({
  title: 'Clerque — Admin How-To',
  subtitle: 'For the HNS operator: set up a client, support them, and the things never to click on a live tenant',
  footer: 'Clerque Admin How-To (HNS internal)',
  outPath: OUT,
});

m.p('This is your field guide for onboarding and supporting a tenant. It is organised in the order you will actually do things on-site. Every label is quoted from the real screens. Read the "Gotchas" boxes - they are the things that cost time when you are standing in the shop.');
m.careful('The Console (console.clerque.cc) is SUPER_ADMIN only. There is no screen to create the first super-admin - that was done at the database level. Guard that login: it can see every tenant\'s operational state (never their money) and run destructive operations on demo tenants.');

/* ───────────────────── 0/1 ───────────────────── */
m.h1('0.  Before the first tenant (one-time)');
m.steps([
  'Sign in at console.clerque.cc with the super-admin account ("Tenant ID" = the HNS company code). You land on /admin/dashboard ("Platform Overview").',
  'Click "Settings" in the Console footer → tab "Company". Fill "Company name", "TIN" (010-986-552-000), "Registered address", contact details, and "Tax status" = VAT. This is printed on every subscription receipt HNS sends to tenants.',
  'Tab "Billing" → section "HNS Corp PH tenant" → click "Provision HNS Corp PH tenant" (safe to re-run; it later relabels to "Re-sync from PlatformConfig").',
]);
m.careful('PlatformConfig must exist in PRODUCTION before you bootstrap the client. Earlier it was only ever set on the local machine - check the Console "Company" tab on production first.');

/* ───────────────────── 2 ───────────────────── */
m.h1('1.  Create the tenant');
m.steps([
  'Console → "Tenants" → "Add Tenant". The modal is "New Tenant".',
  { text: 'Fill "Business Name", "Company Code (slug)" (auto-derived; lowercase letters, numbers and hyphens - this is their "Tenant ID" at login), "Business Type" = COFFEE_SHOP, "Owner Name", "Owner Email".', note: 'The owner email must be unique across ALL of Clerque. If it is already used anywhere you get: Email "..." is already registered.' },
  { text: 'Tick the modules. TICK "Ledger / Accounting" EXPLICITLY - the modal defaults it OFF (only "POS / Counter" is on).', note: 'Leave "Add-on seats" at 0 - the plan has uncapped seats and any value above 0 is rejected.' },
  'Click create. Toast: Tenant "slug" created. A modal "Tenant created" shows the slug and a one-time password.',
]);
m.stop('The owner\'s password is shown ONCE in that modal and is NOT emailed - no invite email is sent. Click "Copy Password" and hand it over yourself (securely). The modal shows Tenant ID and Password but NOT the owner email - write the email down too. If you lose it, reset it from the tenant detail page ("Reset PW").');
m.p('The owner then signs in at clerque.cc/login with "Tenant ID" = the company code, their email, and that password, and should change it at Settings → "Security" → "Change My Password".');

/* ───────────────────── 3 ───────────────────── */
m.h1('2.  Tax status and TIN (Console only)');
m.p('Tax status is a policy field the owner cannot change themselves - it flips VAT computation and the receipt format, which BIR has to approve. You set it from the Console.');
m.steps([
  'Console → "Tenants" → click the tenant → "Tenant Profile" card → "Edit" → modal "Edit Tenant Profile".',
  'Set "Registered Business Name" (as on their BIR COR), "Tax Status" (VAT / NON-VAT / UNREGISTERED), "TIN" (000-000-000-000 or 000-000-000-00000), tick "BIR Registered", fill "Address". Save.',
]);
m.careful('Changing Tax Status REVOKES EVERY SESSION in that tenant - all their staff must log in again. Do it before they start ringing sales, not mid-shift.');
m.note('On the owner\'s side, Settings → "BIR & Tax" shows a banner explaining the status is controlled by HNS support. They can still update TIN, PTU, registered address and receipt notes themselves. Do NOT tick "BIR Permit to Use (PTU)" unless the tenant actually has a PTU/MIN for Clerque - that toggle is half of what turns the receipt into a Sales Invoice.');

/* ───────────────────── 4/5 ───────────────────── */
m.h1('3.  Branch and staff');
m.h2('Branch');
m.p('A default "Main Branch" is created with the tenant. More branches: owner login → Settings → "Branches" → "Add Branch" ("Branch name", "Address") → "Add Branch".');
m.h2('Staff - use the POS Staff page, not the Console');
m.steps([
  'Owner login → left menu "Staff" → "Add Staff". Modal "Add Staff Member": "Full Name", "Email", "Temporary Password" (min 8), "Role", "Branch", and "Kiosk PIN (optional - 4-8 digits)".',
  'Roles for a cafe: "Cashier" (till only), "Sales Lead" (cashier + can approve voids/discounts), "Branch Manager" (supervises; cannot open a shift), "Business Owner" (everything). Pick "Accountant" for their bookkeeper if they have one.',
  'The Kiosk PIN is what the cashier types on the "PIN" tab at login. It must be unique within the tenant ("PIN already in use. Choose another.").',
]);
m.careful('Do NOT add cashiers from the Console "Add User to Tenant" - that form cannot set a Kiosk PIN or a branch. Always use the owner\'s "Staff" page.');
m.h2('Supervisor PIN (for authorising voids) - a DIFFERENT PIN');
m.p('Owner / Branch Manager / Sales Lead each set their own at Settings → "Security" → "Supervisor PIN" ("Current Login Password", "New PIN", "Confirm PIN" → "Set Supervisor PIN"). This is the PIN a cashier hands the screen over for.');
m.stop('Make supervisors set a SIX-digit Supervisor PIN. The Counter tablet\'s approval box says "Enter 6-digit supervisor PIN" and auto-submits at 6 - a 4- or 5-digit PIN cannot authorise anything on Counter. Two supervisors cannot share the same PIN.');

/* ───────────────────── Counter ───────────────────── */
m.h1('4.  The Counter app (Android) - sign-in quirks to know');
m.steps([
  'Screen 1 "Sign in to Counter": "Tenant ID" (company code), "Email", then "Password" or "PIN (4-8 digits)" (the Kiosk PIN).',
  { text: 'Screen 2 "Welcome, {name}" asks for a PIN again. For a CASHIER this screen checks a SUPERVISOR PIN, not the cashier\'s own Kiosk PIN. The owner skips this screen entirely.', note: 'Practical workflow: the owner/manager stands by and types their 6-digit Supervisor PIN to let the cashier in. Explain this to the client up front or it looks like "the PIN does not work".' },
  'The on-screen hint "No PIN yet? Ask your owner to set one in Settings → Security." is misleading - the cashier\'s sign-in PIN is the Kiosk PIN set on the "Staff" page. Settings → Security is the Supervisor PIN.',
]);
m.h2('Bluetooth receipt printer');
m.steps([
  'Pair the printer in Android\'s own Bluetooth settings FIRST.',
  'Open Counter → menu "Printer" ("Pair a Bluetooth thermal printer (58 mm or 80 mm ESC/POS)") → "Discover devices" → pick the printer → "Connect" → "Test print". It reconnects automatically next time.',
]);
m.careful('Counter needs a custom development build of the app, not Expo Go, for Bluetooth ("Bluetooth printer module not available - use a custom dev build"). Also: the APK installed on the client\'s tablet must be the build that includes the receipt fix (Acknowledgement Receipt / "AR #"). An older APK prints "Official Receipt / OR #" - check the printed slip on the first test sale.');
m.note('Counter has no post-sale void/refund screen. Voids and refunds of a PAID sale are done on the web "Orders" page. Counter\'s long-press PIN void only removes a cart line BEFORE payment. "Park" on Counter is "coming soon".');

/* ───────────────────── Ledger mode ───────────────────── */
m.h1('5.  Ledger mode');
m.p('Owner login → Settings → "Business Profile" → card "Ledger mode" → "Simple books" or "Full accounting". It saves immediately and takes effect after the owner logs out and back in (the card says so).');
m.note('Simple books HIDES Chart of Accounts, Journal, Periods, Trial Balance and the BIR page, and blocks them server-side. If YOU need those (e.g. to load opening balances via the Trial Balance import), switch the tenant to Full accounting first, do the work, then let the owner pick Simple books again.');

/* ───────────────────── Import ───────────────────── */
m.h1('6.  Importing their data');
m.p('Templates: owner login → Settings → "Import Templates" (/settings/imports) → each row has an ".xlsx" download. Order for a cafe: Products → Ingredients → Recipes (→ Inventory). Sample rows in every template start with "SAMPLE - " and are ignored on import.');
m.table(['Data', 'Where the UPLOAD button is'], [
  ['Products', 'POS → "Products" → "Import" (also "Setup Pack" for products + opening stock)'],
  ['Customers', 'Ledger → AR → Customers → "Import Customers"'],
  ['Vendors / Suppliers', 'Ledger → AP → Vendors → "Import Vendors"'],
  ['Chart of Accounts', 'Ledger → Accounts → "Import Chart of Accounts" (Full accounting)'],
  ['Journal Entries', 'Ledger → Journal → "Import" - but for OPENING BALANCES use Ledger → Journal → Trial Balance import instead'],
  ['**Ingredients, Recipes, Opening stock, Stock receipts', '**NO upload button in the web UI yet - API only. WE upload these for the client (see note).'],
], [140, 375]);
m.careful('Ingredients and Recipes have download templates but no upload screen. Plan to load them yourself via the API (POST /import/ingredients, /import/recipes) or enter them on-screen with the client. Do not promise the owner a self-serve upload for these.');
m.tip('Do the data migration from the old POS on Thursday from your own desktop, against production, and review it with the client on a call. Friday becomes verification and training instead of a live migration.');

/* ───────────────────── Health ───────────────────── */
m.h1('7.  Checking on a tenant');
m.bullets([
  'Console → "Dashboard" ("Platform Overview"): tenant footprint, security posture, "Failed events" / "Pending events". Operational only - no tenant financial data is shown, by design.',
  'Console → "Tenants" → the tenant: status badge, an "Account health bar" (locked / inactive accounts), "Users (n)" with "Last Login" and "Sessions", and "Backup Snapshots".',
  'Console → "Audit Log": every Console action, immutable. The "Filter by Tenant ID" field wants the tenant UUID (shown under the name as "slug · id"), not the company code.',
  'Owner-side: Ledger → "Audit Log" is the tenant\'s own immutable trail (voids, price changes, period reopens, login history with failed-login bursts).',
]);

/* ───────────────────── Support ops ───────────────────── */
m.h1('8.  Everyday support actions');
m.table(['Need', 'Do this'], [
  ['Reset a password', 'Console → tenant → "Users" → "Reset PW" (shows a new one-time password). For Business Owner / Bookkeeper / Finance Lead / Payroll Master it asks you to type the tenant slug to confirm. Or the owner can do it: "Staff" → reset.'],
  ['Unlock a locked account', 'Console → tenant → "Users" → "Unlock". (Locks also clear by themselves after 15 minutes.)'],
  ['Kick a stuck session', '"Force logout" on the user row.'],
  ['Staff member left', '"Deactivate" on the user row (kills sessions). "Reactivate" to undo.'],
  ['Change tax status / TIN', 'Console → tenant → "Tenant Profile" → "Edit". Remember: revokes all their sessions.'],
  ['Suspend a non-paying tenant', '"Account Status" → "Set SUSPENDED" (type the slug to confirm). Their login then says "This account has been suspended. Please contact support."'],
  ['Something looks wrong, stop writes now', '"Emergency Read-Only Mode" → "Freeze tenant (read-only)" with a reason. Cashiers cannot ring sales while frozen. "Unfreeze (restore writes)" to resume.'],
], [150, 365]);

/* ───────────────────── NEVER ───────────────────── */
m.h1('9.  Never click these on a live tenant');
m.stop('"Reset Demo Data..." and "Clear All Data..." exist for DEMO tenants only. On a live (non-demo) tenant the page hides them and shows "Live Tenant Protected", and the API refuses with LIVE_TENANT_PROTECTED. Never mark a real client as a demo tenant to get those buttons back - "Clear All Data" wipes products, ingredients, orders and journal entries.');
m.bullets([
  'After importing the client\'s catalog, never use "Reset Demo Data" or "Clear All Data" to "clean up" a test sale - void the test sale instead (it stays listed, greyed, with a red badge).',
  '"Seed Ingredients..." (the coffee-shop ingredient pack, ~110 items) is idempotent and skips duplicates, but only run it if the client wants our master list mixed into theirs.',
  'Do not flip "Inventory Valuation" (WAC / FIFO) once they have posted transactions - it warns "POST-LOCK"; it produces inconsistent COGS.',
  'Do not enable the maker-checker "Threshold (₱)" for voids (Settings → Void approval) - the request side is not built yet, so any void at or above the threshold is simply refused. Leave it at 0.',
  'Do not tick "BIR Permit to Use (PTU)" on a tenant without a real PTU/MIN - combined with provider phase 2 it would print Sales Invoices they are not entitled to.',
]);

/* ───────────────────── Receipt rule ───────────────────── */
m.h1('10.  The receipt rule, in one table');
m.p('What Clerque prints is decided by the TENANT\'s own facts. HNS\'s registration never enters into it.');
m.table(['Tenant tax status', 'PTU toggle', 'Provider phase', 'Prints'], [
  ['UNREGISTERED', 'any', 'any', 'ACKNOWLEDGEMENT RECEIPT · AR # · disclaimer'],
  ['VAT or NON-VAT', 'off', 'any', 'ACKNOWLEDGEMENT RECEIPT · AR # · disclaimer  (the coffee shop on go-live)'],
  ['VAT or NON-VAT', 'on', '1 (current prod)', 'ACKNOWLEDGEMENT RECEIPT - phase 1 is the HNS safety catch'],
  ['VAT', 'on', '2', 'VAT SALES INVOICE · SI # · VAT line · PTU/MIN'],
  ['NON-VAT', 'on', '2', 'SALES INVOICE · SI # · no VAT line · PTU/MIN'],
], [115, 70, 95, 235]);
m.note('Phase is the Vercel env NEXT_PUBLIC_PROVIDER_PHASE (currently 1). Flipping it to 2 promotes ONLY tenants that are registered AND have the PTU toggle on; everyone else stays on Acknowledgement. The Counter app is pinned to Acknowledgement until it carries the PTU flag.');

m.h1('11.  Go-live day checklist (Friday)');
m.steps([
  'Console "Company" tab has HNS PlatformConfig (TIN, VAT). HNS tenant provisioned.',
  'Tenant created with Ledger ticked; owner has their password (copied, handed over); tax status + TIN set from Console BEFORE staff log in.',
  'Owner logged in on the web and changed password. Supervisor PIN set (6 digits).',
  'Staff added on "Staff" page with roles, branch, Kiosk PINs.',
  'Catalog imported (ideally Thursday); sizes/add-ons set on screen; a few recipes done together.',
  'Counter tablet: correct APK installed, Bluetooth printer paired, "Test print" shows ACKNOWLEDGEMENT RECEIPT / AR #.',
  'Cashier: open shift → ring a cash sale → ring a GCash sale with a reference → print receipt → cash-out ₱50 with a reason → close shift → Z-read prints → variance makes sense.',
  'Owner: Ledger → Record Entry → one Utilities expense → see it in "Recent entries" and the profit card.',
  'Void the test sales from the web "Orders" page (same day) - do NOT clear data.',
  'Leave them the Owner & Staff Manual and devsupport@hnscorpph.com.',
]);
m.small('HNS internal. Labels quoted from the go-live build; re-generate this document when screens change.');

finish(m).then((p) => console.log('written: ' + p));
