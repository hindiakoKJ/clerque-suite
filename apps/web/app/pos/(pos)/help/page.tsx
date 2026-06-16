'use client';
import { HelpPage, type HelpSection } from '@/components/help/HelpPage';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { isLaundryType } from '@repo/shared-types';
import { LAUNDRY_SECTIONS } from './laundry-sections';

const SECTIONS: HelpSection[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'guide',
    description: 'First-time setup checklist for a new till.',
    items: [
      {
        q: 'I\'m setting up Counter for the first time. What should I do?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sign in with the cashier account given to you by the business owner.</li>
            <li>If prompted, open a shift — enter the cash float in the drawer (e.g. ₱2,000 for change).</li>
            <li>You should now see the product grid. Tap a product to add it to the cart.</li>
            <li>When the customer is ready to pay, tap <strong>Checkout</strong>, choose payment method, enter amount, and confirm.</li>
            <li>Print the receipt (browser or thermal). Hand to customer.</li>
            <li>At end-of-day, tap <strong>Close Shift</strong>, count the cash drawer, declare the closing amount.</li>
          </ol>
        ),
      },
      {
        q: 'What roles can use Counter?',
        a: (
          <p>
            Cashiers, Sales Leads, Branch Managers, Business Owners, MDM (Master Data Managers — read access),
            Warehouse Staff, and Super Admins. Cashiers see only the till. Owners see everything including reports.
          </p>
        ),
      },
      {
        q: 'Can I use Counter offline?',
        a: (
          <p>
            Yes. If your internet drops mid-shift, orders are saved locally to your browser&apos;s storage and a yellow
            <strong> Offline </strong> banner appears. When connection returns, orders auto-sync to the cloud. The
            <strong> Pending Sync </strong> page in the sidebar shows queued orders.
          </p>
        ),
      },
      {
        q: 'What devices does Counter run on?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Desktop / laptop</strong> — full layout with side cart. Best for fixed counters.</li>
            <li><strong>Tablet (iPad / Android tablet)</strong> — bigger touch tiles, cart slides up as a sheet on portrait mode.</li>
            <li><strong>Phone</strong> — works but cramped. Use only for quick lookups.</li>
            <li>Receipt: thermal printer (USB/Bluetooth) via the Printer button, or browser print.</li>
            <li>Barcode scanner: any USB HID keyboard-emulation scanner — just point cursor at the search bar and scan.</li>
          </ul>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'shifts',
    title: 'Shifts (Open & Close)',
    icon: 'how-to',
    description: 'A shift bookends every sales session — required for cash accountability.',
    items: [
      {
        q: 'How do I open a shift?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>You can&apos;t miss it — a modal appears the moment you land on Counter.</li>
            <li>Count the physical cash already in the drawer (your cash float for giving change).</li>
            <li>Type that amount into the field. If your business uses denomination counting, tap each bill/coin&apos;s count.</li>
            <li>Tap <strong>Open Shift</strong>. The till is now active.</li>
            <li>Only <strong>one</strong> shift can be open per cashier at a time.</li>
          </ol>
        ),
      },
      {
        q: 'How do I close a shift?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Close Shift</strong> in the top-right of the screen.</li>
            <li>The system shows expected cash (= opening cash + cash sales − refunds − paid-outs).</li>
            <li>Count the actual cash in the drawer. Enter that as the closing amount.</li>
            <li>Variance is calculated automatically. A non-zero variance is logged for audit.</li>
            <li>You see the EOD report — payment methods, top products, hourly breakdown. Print or screenshot if needed.</li>
          </ol>
        ),
      },
      {
        q: 'My closing cash doesn\'t match expected. What do I do?',
        a: (
          <p>
            Enter the actual count anyway. The variance (over or short) is recorded with your name. Your manager will
            review during reconciliation. <strong>Don&apos;t fudge the count.</strong> Common causes: missed paid-out
            entry, change calculation error, missed cash drop, or shrinkage. Note any explanation in the &ldquo;notes&rdquo;
            field on the close screen.
          </p>
        ),
      },
      {
        q: 'Can I switch cashiers without closing the shift?',
        a: (
          <p>
            No. Each cashier closes their own shift. If a colleague takes over, you close yours, they open theirs with
            the new cash float (which becomes their drawer). This protects you from being responsible for someone
            else&apos;s sales.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'terminal',
    title: 'Terminal — Selling',
    icon: 'how-to',
    description: 'The product grid + cart at the heart of every sale.',
    items: [
      {
        q: 'How do I add an item to the cart?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Tap any product tile.</li>
            <li>Or scan a barcode — the search bar accepts scanner input directly.</li>
            <li>Or type to search. Try &ldquo;<strong>3x latte</strong>&rdquo; to add 3 lattes in one tap.</li>
            <li>Use the category pills at the top to filter the grid.</li>
          </ul>
        ),
      },
      {
        q: 'How do I change the quantity of a cart item?',
        a: (
          <p>
            In the cart panel, use the <strong>−</strong> and <strong>+</strong> buttons next to the quantity number.
            To remove an item entirely, tap the trash icon.
          </p>
        ),
      },
      {
        q: 'What are modifiers and how do I use them?',
        a: (
          <p>
            Modifiers customize a product (e.g. &ldquo;Iced Latte + extra shot + oat milk&rdquo;). When a product has
            modifier groups attached (set up in Products), tapping it opens a modifier picker. Pick the options and
            confirm. Each modifier may add to the price; the cart shows the total with modifiers included.
          </p>
        ),
      },
      {
        q: 'How do I park a sale and come back to it later?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap the <strong>Park</strong> button in the cart actions bar.</li>
            <li>Give the parked sale a label (e.g. &ldquo;Table 4&rdquo; or customer name).</li>
            <li>The cart clears and you can serve the next customer.</li>
            <li>To resume, tap <strong>Open Parked Sales</strong> in the cart actions — pick the parked sale.</li>
            <li>Parked sales are local to the device. They survive page refresh but not different devices.</li>
          </ol>
        ),
      },
      {
        q: 'How do I void a current cart line?',
        a: (
          <p>
            Tap the trash icon on the line. <strong>Voiding a completed order</strong> (one already paid) is different —
            see &ldquo;Voiding a completed order&rdquo; below.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'payments',
    title: 'Payments & Receipts',
    icon: 'how-to',
    description: 'Multi-tender, change calculation, and receipt printing.',
    items: [
      {
        q: 'What payment methods can I accept?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Cash</strong> — change auto-calculates as you type the tendered amount.</li>
            <li><strong>GCash (personal)</strong> — for sole-prop or backyard businesses with personal GCash.</li>
            <li><strong>GCash (business)</strong> — for registered GCash for Business merchants.</li>
            <li><strong>Maya (personal / business)</strong> — same split as GCash.</li>
            <li><strong>QR Ph / Bank Transfer</strong> — interbank QR or fund transfer references.</li>
            <li><strong>Charge to Account</strong> — for B2B customers with credit terms (creates an AR invoice).</li>
          </ul>
        ),
      },
      {
        q: 'How do I split payment across multiple methods?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>On the payment screen, tap a method (e.g. Cash) and enter the partial amount.</li>
            <li>Tap <strong>Add another payment</strong>.</li>
            <li>Choose the second method (e.g. GCash) and enter the rest.</li>
            <li>Repeat as needed. The remaining-due field updates live.</li>
            <li>When the total matches, tap <strong>Confirm</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'How do I apply a PWD or Senior Citizen discount?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Before checkout, tap <strong>PWD / SC discount</strong> in the cart actions.</li>
            <li>Pick which line items qualify (PH law: only food, medicine, and certain services).</li>
            <li>Enter the customer&apos;s ID number, name, and date of birth (required by BIR for audit).</li>
            <li>System computes the 20% discount on the VAT-exclusive base (per PH RA 9994 / RA 7277).</li>
            <li>Confirm. The cart shows the discount line and the saved amount.</li>
          </ol>
        ),
      },
      {
        q: 'How do I print a receipt?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>After a sale completes, the receipt modal appears automatically.</li>
            <li>Tap <strong>Print</strong> to use the connected thermal printer (you&apos;ll need to pair it via the Printer icon in the header).</li>
            <li>Tap <strong>Browser Print</strong> to use any standard printer.</li>
            <li>For VAT-registered tenants, the receipt includes BIR-compliant header (TIN, MIN, business name) per RR No. 1-2026.</li>
          </ul>
        ),
      },
      {
        q: 'Voiding a completed order (cashier with supervisor PIN)',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sidebar → <strong>Orders</strong>. Find the order. Tap <strong>Void</strong>.</li>
            <li>Enter the void reason (required, free text).</li>
            <li>If you&apos;re a CASHIER, a yellow <strong>Supervisor authorisation required</strong> box appears with a PIN input.</li>
            <li>Hand the device to your manager (Sales Lead, Branch Manager, or Owner). They tap their 4-6 digit PIN into the box.</li>
            <li>Tap <strong>Confirm Void</strong>. System verifies the PIN, identifies the supervisor, and logs the void with both names.</li>
            <li>The journal entry is reversed. Inventory is restocked. Audit log captures: order #, reason, cashier name, supervisor name, timestamp.</li>
          </ol>
        ),
      },
      {
        q: 'I\'m a Sales Lead / Manager / Owner — do I need a PIN?',
        a: (
          <p>
            No. Direct-void roles (Sales Lead, Branch Manager, Business Owner, Super Admin) skip the PIN field
            entirely. Just enter the reason and confirm. The void is recorded under your own name.
          </p>
        ),
      },
      {
        q: 'How does my supervisor set up their PIN?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Supervisor signs in to Clerque (any app).</li>
            <li>Sidebar → <strong>Settings</strong> → <strong>Security</strong> tab.</li>
            <li>Scroll to <strong>Supervisor PIN</strong> card.</li>
            <li>Enter their current login password (confirmation), then a 4-6 digit PIN twice.</li>
            <li>Save. The PIN is hashed and stored. They can use it at any cashier&apos;s till in their tenant.</li>
            <li>To change or rotate, repeat the process.</li>
          </ol>
        ),
      },
      {
        q: 'I tried the PIN and it says "Invalid PIN".',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Make sure the supervisor has set a PIN in Settings → Security.</li>
            <li>The supervisor&apos;s role must be Sales Lead, Branch Manager, or Owner — Cashier PINs are silently rejected.</li>
            <li>The supervisor must be active (not deactivated) and in your tenant.</li>
            <li>If still failing, the supervisor can reset their PIN at Settings → Security.</li>
          </ul>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'cash-out',
    title: 'Cash Out (Paid-Out & Drop)',
    icon: 'how-to',
    description: 'When cash legitimately leaves the till mid-shift.',
    items: [
      {
        q: 'What\'s the difference between Paid-Out and Cash Drop?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Paid-Out</strong> — real expense paid from the cash drawer. E.g. tipping a delivery rider, buying ice mid-shift, paying a small supplier in cash. Posts an expense JE.</li>
            <li><strong>Cash Drop</strong> — safekeeping. Cashier hands cash to manager who locks it in the safe. No expense — moves cash from &ldquo;Cash on Hand&rdquo; to &ldquo;Cash on Safe&rdquo;.</li>
            <li>Both reduce the expected closing cash, so your variance reconciles cleanly.</li>
          </ul>
        ),
      },
      {
        q: 'How do I record a paid-out?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Cash Out</strong> in the header.</li>
            <li>Choose <strong>Paid-Out</strong>.</li>
            <li>Enter amount and reason (e.g. &ldquo;Tip for delivery rider&rdquo;).</li>
            <li>Optional: snap a photo of the receipt. AI receipt OCR will pre-fill the amount, vendor, and category — review before confirming.</li>
            <li>Confirm. The cash leaves the drawer; the expense is booked to the appropriate GL account.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'products',
    title: 'Products',
    icon: 'how-to',
    description: 'Master data for everything you sell.',
    items: [
      {
        q: 'How do I add a new product?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sidebar → <strong>Products</strong> → <strong>+ New Product</strong>.</li>
            <li>Enter Name (required), Category, Selling Price (required), <strong>Cost Price (required)</strong>, VAT toggle.</li>
            <li>Cost Price drives gross profit reporting. If the item is genuinely free, enter 0 — but never leave it blank.</li>
            <li>Optional: SKU, barcode, description, image URL, unit of measure.</li>
            <li>Save. The product appears immediately on the cashier grid.</li>
          </ol>
        ),
      },
      {
        q: 'How do I bulk-import products?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sidebar → <strong>Inventory</strong> → <strong>Setup Pack</strong> (or Products → Import).</li>
            <li>Download the template. It has instruction blocks at the top — read them.</li>
            <li>Fill in your products (one per row). Cost Price column is required.</li>
            <li>Save as .xlsx (or .csv) and upload back.</li>
            <li>Existing products are matched by Name and updated; new ones are created.</li>
            <li>Errors are returned per row so you can fix and re-upload.</li>
          </ol>
        ),
      },
      {
        q: 'What\'s the difference between Unit-Based and Recipe-Based?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Unit-Based</strong> — each sale deducts 1 unit from inventory. For finished goods (bottled water, packaged snacks).</li>
            <li><strong>Recipe-Based</strong> — each sale subtracts the recipe (the list of ingredients) from your ingredient stock. For food &amp; drink (one ensaymada = flour + butter + sugar + cheese).</li>
            <li>You add your ingredients in the Ingredients page, then attach a recipe (the list of ingredients and how much of each) to a Recipe-Based product.</li>
          </ul>
        ),
      },
      {
        q: 'How do I add a product image?',
        a: (
          <p>
            Edit the product → paste a public image URL (Cloudinary, Google Drive direct link, supplier site). The
            image appears on the cashier grid. Direct file upload (no URL needed) is on the roadmap; for now, paste a
            URL.
          </p>
        ),
      },
      {
        q: 'Why is the Cost Price field required?',
        a: (
          <p>
            For accurate gross-profit reporting and BIR compliance. Without it, sales record revenue but no Cost of
            Goods Sold (COGS), so profit appears overstated. The dashboard warns you about any product missing cost
            and gives a one-click jump to fix.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'inventory',
    title: 'Inventory',
    icon: 'how-to',
    description: 'On-hand quantities, low-stock alerts, raw materials.',
    items: [
      {
        q: 'How do I set opening stock for a new branch?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sidebar → <strong>Inventory</strong> → switch to the branch.</li>
            <li>Either tap a product&apos;s <strong>Adjust</strong> button (one-by-one), or use <strong>Setup Pack</strong> import for bulk.</li>
            <li>For each item, enter the quantity on hand. This <em>replaces</em> the current quantity (not added to).</li>
            <li>Optionally set a Low Stock Alert threshold — the dashboard flags items below this number for re-ordering.</li>
          </ol>
        ),
      },
      {
        q: 'What does the LOW or OUT badge on a product tile mean?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>OUT</strong> — quantity is 0. The tile is greyed out and can&apos;t be sold (prevents negative stock).</li>
            <li><strong>LOW · 5</strong> — at or below the alert threshold. Tile is highlighted amber. You can still sell it; this is a reminder to reorder.</li>
            <li>No badge means quantity is healthy.</li>
          </ul>
        ),
      },
      {
        q: 'How do raw materials work for F&B?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Inventory → <strong>Ingredients</strong> tab → New Ingredient (e.g. &ldquo;Espresso shot, 30ml&rdquo;).</li>
            <li>Set its unit, cost, and on-hand quantity per branch.</li>
            <li>When you create a Recipe-Based product, attach a BOM linking it to ingredients with quantities.</li>
            <li>Selling that product deducts the recipe from raw material stock automatically.</li>
            <li>The ingredient&apos;s cost is summed into the product&apos;s effective COGS.</li>
          </ol>
        ),
      },
      {
        q: 'How do I record a stock adjustment that\'s not a sale?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Inventory → tap the product → <strong>Adjust</strong>.</li>
            <li>Choose the type:
              <ul className="list-disc pl-6 mt-1">
                <li><strong>RECEIVE</strong> — new stock arrived from supplier.</li>
                <li><strong>WRITE_OFF</strong> — damage, expiry, breakage. Posts an expense JE.</li>
                <li><strong>STOCKTAKE</strong> — physical count correction.</li>
              </ul>
            </li>
            <li>Enter the new quantity (or +/- delta) and reason.</li>
            <li>The adjustment is logged with your name in the audit trail.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'orders',
    title: 'Orders',
    icon: 'guide',
    description: 'Browse, void, and reprint past orders.',
    items: [
      {
        q: 'Where can I see today\'s orders?',
        a: (
          <p>
            Sidebar → <strong>Orders</strong>. Lists all orders with status (Completed / Voided / Charge), totals,
            payment method, and timestamp. Filter by date range or status. Tap any order to see details and actions.
          </p>
        ),
      },
      {
        q: 'How do I reprint a receipt?',
        a: (
          <p>
            Open the order from the Orders page → tap <strong>Reprint Receipt</strong>. The receipt modal reopens.
            Useful when a customer asks for another copy or the printer jammed.
          </p>
        ),
      },
      {
        q: 'I sold something on credit. Where does it appear?',
        a: (
          <p>
            Charge sales (paid via &ldquo;Charge to Account&rdquo;) appear in the Orders list with status <strong>OPEN</strong>.
            They also appear on the Ledger app under <strong>POS Collections</strong>. The customer&apos;s outstanding
            balance grows. When they pay, record a payment from the Orders page or the Collections page.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'guide',
    description: 'Daily KPIs, top products, profitability.',
    items: [
      {
        q: 'What does the Profitability row show?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Gross Profit</strong> = Revenue − Cost of Goods Sold. The actual margin.</li>
            <li><strong>COGS</strong> = sum of (qty × cost) for all sold lines.</li>
            <li><strong>Gross Margin %</strong> = profit / revenue.</li>
            <li>If a sold item had no Cost Price set, its revenue counts but cost doesn&apos;t — the COGS card flags this with &ldquo;X line(s) untracked&rdquo;.</li>
          </ul>
        ),
      },
      {
        q: 'What\'s the amber warning banner about?',
        a: (
          <p>
            It appears when one or more of your active products has no Cost Price set, or today&apos;s sales include
            untracked-cost lines. Both situations break gross-profit accuracy. Tap <strong>Fix products now</strong> to
            jump to the Products page where you can patch the missing data.
          </p>
        ),
      },
      {
        q: 'Top Products — does it count voided orders?',
        a: (
          <p>
            No. Voids and pre-void cancelled orders are excluded. Only COMPLETED orders for the selected date count
            toward Top Products and other dashboard KPIs.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'close-and-plan',
    title: 'Close & Plan (evening routine)',
    icon: 'guide',
    description: 'Your night-time routine: wrap up today and get tomorrow ready, all on one screen.',
    items: [
      {
        q: 'What do I do on this page each night?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Look at <strong>Today recap</strong> to see your sales and number of orders.</li>
            <li>If any flour, butter, or other supplies were delivered today, add them under <strong>Today&apos;s deliveries</strong>.</li>
            <li>Check <strong>Tomorrow&apos;s plan</strong> so you know what to bake and who is picking up.</li>
            <li>Tap the big <strong>Print morning briefing</strong> button at the bottom.</li>
            <li>Stick the printed sheet on the kitchen wall for the baker.</li>
          </ol>
        ),
      },
      {
        q: 'A delivery of flour came in today. How do I record it?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>In the <strong>Today&apos;s deliveries</strong> box, tap <strong>Add a delivery</strong>.</li>
            <li>Tap <strong>Pick a raw material…</strong> and choose the item (like flour).</li>
            <li>Type the <strong>Quantity</strong> and the <strong>Cost / unit</strong> (price for one bag or kilo).</li>
            <li>If it spoils, type the <strong>Expiration date</strong> (you can skip this).</li>
            <li>Tap <strong>Add to delivery</strong>, then the green <strong>Save delivery items</strong> button.</li>
          </ol>
        ),
      },
      {
        q: 'A yellow "Possible duplicate" box popped up. What does that mean?',
        a: (
          <p>
            It means you may have already typed in this same delivery a few minutes ago. The app is just
            double-checking so you don&apos;t count it twice. If it really is the same one, tap <strong>Skip — it
            was a duplicate</strong>. If it is a separate, real delivery, tap <strong>It&apos;s real — save anyway</strong>.
          </p>
        ),
      },
      {
        q: 'What is the "Use first" list telling me?',
        a: (
          <p>
            These are perishable supplies (things that spoil, like fresh milk or butter) that should be used soon so
            nothing goes to waste. Items marked <strong>Use first</strong> or <strong>Soon</strong> should go into
            tomorrow&apos;s baking before the newer stock. <strong>Expired</strong> means do not use it.
          </p>
        ),
      },
      {
        q: 'I forgot to print the briefing. Can I print it again?',
        a: (
          <p>
            Yes. Just tap <strong>Print morning briefing</strong> again. A preview opens in a new tab — print to your
            usual receipt printer from there.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'bake-list',
    title: 'Bake list',
    icon: 'how-to',
    description: 'A simple daily list that tells the baker how many of each item to bake.',
    items: [
      {
        q: 'How does the app decide the bake numbers?',
        a: (
          <p>
            It compares two things and picks the bigger one: your average daily sales over the last 7 days, and any
            pre-orders for that date. So you never run short on a busy day and never forget a promised cake.
          </p>
        ),
      },
      {
        q: 'How do I see the list for a different day?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Today</strong> to see today, or <strong>Tomorrow</strong> for the next day.</li>
            <li>For any other date, tap the date box next to <strong>Bake for</strong> and pick the day.</li>
          </ol>
        ),
      },
      {
        q: 'How do I print the list for the kitchen?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Pick the right date first.</li>
            <li>Tap the purple <strong>Print</strong> button at the top right.</li>
            <li>Print to your thermal (receipt) printer.</li>
          </ol>
        ),
      },
      {
        q: 'The page says "Nothing to bake yet." Why?',
        a: (
          <p>
            This is normal for a brand-new shop. The app needs a few days of sales (or some pre-orders for that date)
            before it can suggest amounts. Keep ringing up sales and the numbers will appear. Tap <strong>Refresh</strong> to
            pull the latest numbers.
          </p>
        ),
      },
      {
        q: 'What do the columns "7-day avg," "Pre-orders," and "Bake" mean?',
        a: (
          <p>
            <strong>7-day avg</strong> is how many you usually sell in a day. <strong>Pre-orders</strong> is how many
            were already reserved. <strong>Bake</strong> (the big purple number) is the final amount to bake — that is
            the one the baker follows.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pre-orders',
    title: 'Pre-orders (custom cakes & advance orders)',
    icon: 'how-to',
    description: 'Your digital logbook for custom cakes and advance orders — who, what, when, and the deposit paid.',
    items: [
      {
        q: 'A customer wants a custom birthday cake next Saturday. How do I write it down?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>New pre-order</strong> at the top right.</li>
            <li>Choose the <strong>Customer</strong> (or leave it as <strong>Walk-in / unknown</strong>).</li>
            <li>Set the <strong>Pickup date</strong> and, if you know it, <strong>Pickup time</strong>.</li>
            <li>Type the cake message in <strong>Inscription</strong>, like &ldquo;Happy Birthday Maria.&rdquo;</li>
            <li>Add any <strong>Notes</strong> (color, allergies, photo reference).</li>
            <li>Under <strong>Items</strong>, pick the product and type the quantity. Tap <strong>Add another item</strong> for more.</li>
            <li>Type the <strong>Deposit (₱)</strong> the customer paid, then tap <strong>Create pre-order</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'What does the purple "Today\x27s pickups" box at the top mean?',
        a: (
          <p>
            It shows how many orders are being picked up today, and the total money still owed (<strong>balance
            due</strong>) for them. It&apos;s your quick morning glance so nothing is forgotten.
          </p>
        ),
      },
      {
        q: 'The cake is finished. How do I mark it ready?',
        a: (
          <p>
            Find the order in the list and tap the green check-circle button on its row. Its tag changes to
            <strong> Ready</strong>, so anyone can see it&apos;s done and waiting for pickup.
          </p>
        ),
      },
      {
        q: 'How do deposits and balances work?',
        a: (
          <p>
            When you type a deposit, the app saves it as money already received. The leftover amount becomes the
            <strong> Balance due on pickup</strong>. The customer pays that balance at the counter when they collect.
          </p>
        ),
      },
      {
        q: 'A customer changed or cancelled their order. What do I do?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>To change it:</strong> tap the pencil button on its row, edit the items/message/deposit/date, then <strong>Save changes</strong>.</li>
            <li><strong>To cancel it:</strong> tap the X button, type a reason (e.g. &ldquo;customer changed mind&rdquo;), and confirm. The tag changes to <strong>Cancelled</strong>. Check your own refund rules for the deposit.</li>
          </ul>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'modifier-recipes',
    title: 'Modifier recipes (sizes & add-ons)',
    icon: 'how-to',
    description: 'Tell the app what extra ingredients each option uses, so every sale subtracts the right amount of stock by itself.',
    items: [
      {
        q: 'What are the two parts of this page?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Recipe × (the multiplier)</strong> — for sizes. It tells the app how much of the normal recipe a size uses. Normal = 1. A &ldquo;Large&rdquo; that uses one-and-a-quarter of everything = 1.25. A small that uses half = 0.5.</li>
            <li><strong>Adds on top of base recipe (the ingredients)</strong> — for add-ons. Extra stuff the option puts in, on top of the normal recipe. Example: &ldquo;Oat milk&rdquo; adds 240 ml of oat milk; &ldquo;Extra cheese&rdquo; adds 20 g of cheese.</li>
          </ul>
        ),
      },
      {
        q: 'My "Large" uses more dough than the regular one. How do I tell the app?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Find the group with your size choices (like &ldquo;Size&rdquo;) and tap it to open it.</li>
            <li>Find the <strong>Large</strong> option.</li>
            <li>In the box next to <strong>Recipe ×</strong>, type how much it uses compared to normal. If Large uses one-and-a-quarter, type 1.25.</li>
            <li>Tap <strong>Save changes</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'A customer can add extra cheese. How do I make the app remove cheese from my stock?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the group that has &ldquo;Extra cheese&rdquo; and find that option.</li>
            <li>Under <strong>Adds on top of base recipe</strong>, tap <strong>Add ingredient</strong>.</li>
            <li>Pick the ingredient (Cheese) from the list.</li>
            <li>In the <strong>qty</strong> box, type how much it adds, like 20. The unit (g) shows beside it.</li>
            <li>Tap <strong>Save changes</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'What is "Est. COGS" beside my ingredients?',
        a: (
          <p>
            COGS just means <strong>what the ingredients cost you</strong>. It is a quick estimate of how much that
            add-on costs you in money, based on your ingredient prices. It helps you check your add-on price is fair.
            You don&apos;t type it — the app figures it out.
          </p>
        ),
      },
      {
        q: 'My size doesn\x27t add anything new, it just uses more of the normal recipe. Do I add ingredients?',
        a: (
          <p>
            No. Just set the <strong>Recipe ×</strong> number and leave the ingredients empty. The app will say
            &ldquo;No add-on ingredients&rdquo; and that is fine. Use ingredients only for extra things added on top.
          </p>
        ),
      },
      {
        q: 'I don\x27t see my product choices here. Where are they?',
        a: (
          <p>
            This page only shows choices you already made. If it says there are none, create them first on the
            <strong> Products</strong> page, then come back here to set the recipe.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'price-lists',
    title: 'Price lists (wholesale / special prices)',
    icon: 'how-to',
    description: 'Give certain customers their own special prices — like a lower price for shops that buy in bulk.',
    items: [
      {
        q: 'A coffee shop wants to buy my pandesal cheaper than the store price. How do I set this up?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>In the box at the top, type a name like &ldquo;Wholesale (cafes)&rdquo;, then tap <strong>Create list</strong>.</li>
            <li>Find your new list and tap <strong>Edit prices</strong>.</li>
            <li>Tap <strong>Add product</strong> and pick Pandesal.</li>
            <li>In the <strong>Override</strong> box, type their special price, like 8. Your normal price shows beside it as <strong>Default</strong>.</li>
            <li>Tap <strong>Save price list</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'What does "Override" mean?',
        a: (
          <p>
            It&apos;s simply the special price that replaces your normal price for this customer. The normal price is
            shown as <strong>Default</strong> so you can compare. You only override the products you want; everything
            else stays at the normal price.
          </p>
        ),
      },
      {
        q: 'How does the customer actually get these prices?',
        a: (
          <p>
            Making the list is only step one. You must <strong>link the list to the customer on their profile</strong>.
            After that, when you ring up that customer at the counter, their special prices come up by themselves.
          </p>
        ),
      },
      {
        q: 'What is the "Min qty" box for?',
        a: (
          <p>
            <strong>Min qty</strong> is the smallest amount they must buy to get the special price. Example: pandesal is
            ₱8 only if they buy 50 or more. Leave it blank and the special price always applies. It is optional.
          </p>
        ),
      },
      {
        q: 'I added a product to the list but didn\x27t set a price. What happens?',
        a: (
          <p>
            If you leave the price empty or zero, that product won&apos;t be saved to the list — it just sells at your
            normal price. Always type a real price in the <strong>Override</strong> box for products you want to discount.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'units-uom',
    title: 'Units (grams, ml, pieces)',
    icon: 'how-to',
    description: 'The measuring words your shop uses, so stock counts are always clear.',
    items: [
      {
        q: 'How do I add a new unit, like "piece"?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Add Unit</strong> at the top right.</li>
            <li>In <strong>Name</strong>, type the full word, like &ldquo;Piece&rdquo;.</li>
            <li>In <strong>Abbreviation</strong>, type the short form, like &ldquo;PC&rdquo;.</li>
            <li>Tap <strong>Add Unit</strong> to save.</li>
          </ol>
        ),
      },
      {
        q: 'I buy flour by the sack but my recipes use grams. How do I link them?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Add Unit</strong> (or edit the Sack unit with the pencil).</li>
            <li>Name it &ldquo;Sack&rdquo;, abbreviation &ldquo;SACK&rdquo;.</li>
            <li>Under <strong>Conversion</strong>, in <strong>Base Unit Abbrev.</strong> type the small unit, &ldquo;G&rdquo;.</li>
            <li>In <strong>Factor</strong>, type how many of the small unit are in one big unit. For 1 sack = 25,000 grams, type 25000.</li>
            <li>Tap <strong>Add Unit</strong> (or <strong>Save Changes</strong>).</li>
          </ol>
        ),
      },
      {
        q: 'What do "Base Unit" and "Factor" mean? They confuse me.',
        a: (
          <p>
            <strong>Base Unit</strong> is the small unit you want to count in (like grams). <strong>Factor</strong> is
            how many of that small unit fit in this one. This part is optional — if a unit stands alone, like
            &ldquo;Piece&rdquo;, just leave it blank.
          </p>
        ),
      },
      {
        q: 'I don\x27t use a unit anymore. Can I hide it without deleting it?',
        a: (
          <p>
            Yes. Tap the green toggle switch on that unit&apos;s row to turn it off — it moves to the
            <strong> Inactive</strong> list and is grayed out. Tap the toggle again to bring it back. (Only the owner
            sees this switch.)
          </p>
        ),
      },
      {
        q: 'I can\x27t see the "Add Unit" button. Why?',
        a: (
          <p>
            Those controls are only for owners and managers. A regular cashier can look at the list but can&apos;t
            change it. If you need a new unit, ask the owner or manager to add it.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'staff',
    title: 'Staff (your workers)',
    icon: 'how-to',
    description: 'Add your workers and choose what each one is allowed to do.',
    items: [
      {
        q: 'How do I add a new cashier?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Add Staff</strong> at the top right.</li>
            <li>Type the full name, like &ldquo;Maria Santos&rdquo;.</li>
            <li>Type their email.</li>
            <li>Type a starting password (at least 8 letters or numbers). Tap <strong>Show password</strong> to check it.</li>
            <li>Tap the <strong>Role</strong> box and pick <strong>Cashier</strong>.</li>
            <li>Tap <strong>Create Staff</strong>. Maria can now log in and ring up pandesal.</li>
          </ol>
        ),
      },
      {
        q: 'My cook only needs to clock in and out. What do I do?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Add Staff</strong> and type his name and email.</li>
            <li>Type a <strong>Kiosk PIN</strong>, like 1234 — the secret number he taps to clock in.</li>
            <li>Tick the box <strong>Clock-only employee</strong>.</li>
            <li>Tap <strong>Create Staff</strong>. He can punch in at the shared tablet, but cannot open the register or reports.</li>
          </ol>
        ),
      },
      {
        q: 'What is a "Sales Lead", and why would I turn on that star?',
        a: (
          <p>
            A Sales Lead is a trusted worker you allow to approve special things, like a manager discount or cancelling
            (voiding) an order. Tapping the star next to their name gives them this power; tap again to take it back.
            (Your plan may only allow a few Sales Leads.)
          </p>
        ),
      },
      {
        q: 'A cashier left the bakery. How do I stop them from logging in?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Find their name in the list.</li>
            <li>On the far right, tap the toggle switch (the round on/off button).</li>
            <li>Their status changes to <strong>INACTIVE</strong> — they can no longer log in. You can turn it back on if they return.</li>
          </ol>
        ),
      },
      {
        q: 'A worker forgot their password. How do I give them a new one?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Find their name and tap the key icon on the right.</li>
            <li>Type a new password (at least 8 characters).</li>
            <li>Tap <strong>Reset Password</strong>. This logs them out everywhere, so they must log in again with the new password.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'promotions',
    title: 'Promotions (sales & discounts)',
    icon: 'how-to',
    description: 'Set up deals so the register lowers the price by itself.',
    items: [
      {
        q: 'How do I make a "20% off day-old bread" deal?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>New Promotion</strong>.</li>
            <li>In Name, type &ldquo;20% off day-old bread&rdquo;.</li>
            <li>Leave Discount Type on <strong>Percentage</strong>.</li>
            <li>In Discount Percent, type 20.</li>
            <li>Under <strong>Applies To</strong>, tap <strong>Specific products</strong>, search for your bread, and tick it.</li>
            <li>Tap <strong>Create Promotion</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'I want a flat ₱25 price on ensaymada instead of a percent off. Can I?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>New Promotion</strong> and give it a name.</li>
            <li>For Discount Type, tap <strong>Fixed Price</strong>.</li>
            <li>In the Fixed Price box, type 25.</li>
            <li>Choose the ensaymada under <strong>Specific products</strong>.</li>
            <li>Tap <strong>Create Promotion</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'How do I make a deal that only runs on weekends from 3pm to 5pm?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Under <strong>Active Days</strong>, tap <strong>Sa</strong> and <strong>Su</strong>.</li>
            <li>In <strong>Hours From</strong>, set 15:00. In <strong>Hours To</strong>, set 17:00.</li>
            <li>Save. Leave days empty to run every day; leave hours empty to run all day.</li>
          </ol>
        ),
      },
      {
        q: 'I want to end a sale. Do I delete it?',
        a: (
          <p>
            You turn it off, you don&apos;t erase it. Find the promotion, tap the trash-can icon, then tap
            <strong> Deactivate</strong>. It stops at the register right away, and you can switch it back on later by
            editing it.
          </p>
        ),
      },
      {
        q: 'What does "Stackable" mean?',
        a: (
          <p>
            Stackable means this deal can be added on top of another deal at the same time. If it&apos;s off, only one
            deal applies. Leave it off unless you really want two discounts to combine.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pending-sync',
    title: 'Pending Sync (offline orders)',
    icon: 'how-to',
    description: 'Sales you made while the internet was down, waiting to be uploaded.',
    items: [
      {
        q: 'The internet went out. Did I lose the sales I made?',
        a: (
          <p>
            No. Every offline sale is saved safely on this page. You&apos;ll see an orange <strong>Offline</strong> tag
            at the top, and the number tells you how many sales are still waiting.
          </p>
        ),
      },
      {
        q: 'The internet is back. How do I upload the waiting sales?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the <strong>Pending Sync</strong> page.</li>
            <li>Tap <strong>Sync Now</strong> at the top right.</li>
            <li>Wait a moment — it tells you how many sales went up, and the list empties out. (The button only works when you&apos;re back online.)</li>
          </ol>
        ),
      },
      {
        q: 'Can I print a receipt for an offline sale?',
        a: (
          <p>
            Yes. Find the order and tap the printer icon on its row. The receipt prints with a note saying
            &ldquo;OFFLINE ORDER — PENDING SYNC&rdquo;. The customer still gets their paper.
          </p>
        ),
      },
      {
        q: 'One order says "FAILED" in red. What do I do?',
        a: (
          <p>
            First, just tap <strong>Sync Now</strong> again — many times it works the second time. If it keeps failing,
            note the small red message under the order and tell your manager. <strong>Do not delete it.</strong>
          </p>
        ),
      },
      {
        q: 'What does the trash can on an order do?',
        a: (
          <p>
            It removes that one waiting sale and it will <strong>not</strong> be uploaded. Only do this if the sale was
            a mistake, because the money won&apos;t show in your reports. It asks you to confirm first.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'sales-report',
    title: 'Sales Report',
    icon: 'guide',
    description: 'A summary of how much your bakery sold and earned over the days you choose.',
    items: [
      {
        q: 'How do I see this week\x27s sales?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the Sales Report page.</li>
            <li>Tap the <strong>Last 7d</strong> button near the top. (<strong>Last 30d</strong> and <strong>Last 90d</strong> are there too.)</li>
            <li>The numbers update by themselves. You can also pick exact <strong>From</strong> and <strong>To</strong> dates.</li>
          </ol>
        ),
      },
      {
        q: 'What do the four boxes at the top mean?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Total Revenue</strong> — all the money that came in from sales.</li>
            <li><strong>Gross Profit</strong> — what&apos;s left after taking out what the items cost you. The margin percent shows how much of each peso is profit.</li>
            <li><strong>Avg Order Value</strong> — the typical amount one customer spends per order.</li>
            <li><strong>Voids</strong> — cancelled orders. These are NOT counted as money earned.</li>
          </ul>
        ),
      },
      {
        q: 'Which of my breads sells the best?',
        a: (
          <p>
            Scroll down to <strong>Top products by revenue</strong>. It lists your best sellers, number 1 first, with
            how much money each made and how many were sold.
          </p>
        ),
      },
      {
        q: 'How do I save this report to open in Excel?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Pick the dates you want.</li>
            <li>Tap <strong>Export CSV</strong> at the top right.</li>
            <li>A file downloads — open it in Excel or Google Sheets and send it to your bookkeeper.</li>
          </ol>
        ),
      },
      {
        q: 'Why is my Gross Profit smaller than my Total Revenue?',
        a: (
          <p>
            Because profit is what&apos;s left AFTER you pay for ingredients and goods. If you sold ₱100 of bread but the
            flour and supplies cost you ₱60, your gross profit is ₱40. That is normal.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'displays',
    title: 'Displays (extra screens)',
    icon: 'how-to',
    description: 'Connect an extra screen — a customer-facing TV or a kitchen monitor — without logging in twice.',
    items: [
      {
        q: 'I have a TV I want to face the customers. How do I connect it?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Find the <strong>Customer-facing display</strong> card.</li>
            <li>Tap <strong>Generate pairing code</strong>. A big 4-digit number and a QR code appear.</li>
            <li>On the TV (or other tablet), open the website address shown, or scan the QR code.</li>
            <li>Type the 4-digit number on that device. The screens are now linked — no second login needed.</li>
          </ol>
        ),
      },
      {
        q: 'The big number disappeared before I finished. What happened?',
        a: (
          <p>
            The code only lasts a short time for safety (you can see the countdown). If it runs out, just tap
            <strong> Generate pairing code</strong> again for a fresh number, then type that one.
          </p>
        ),
      },
      {
        q: 'How do I set up a kitchen screen so my bakers see the orders?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Find the <strong>Kitchen Display (KDS)</strong> card.</li>
            <li>Pick a station if you have them set up, or leave it as <strong>Any matching station</strong>.</li>
            <li>Tap <strong>Generate pairing code</strong>.</li>
            <li>On the kitchen monitor, open the address or scan the QR, then type the number.</li>
          </ol>
        ),
      },
      {
        q: 'How do I know my screens are still connected?',
        a: (
          <p>
            Look at the <strong>Paired devices</strong> list. Each screen shows a status: <strong>Active</strong>
            (working now), <strong>Idle</strong> (quiet but fine), <strong>Stale</strong> (hasn&apos;t checked in for a
            while — may be off), or <strong>Awaiting pairing</strong> (code made, no device used it yet).
          </p>
        ),
      },
      {
        q: 'A screen is broken or I don\x27t use it anymore. How do I remove it?',
        a: (
          <p>
            Find it in the <strong>Paired devices</strong> list, tap <strong>Revoke</strong> on its row, and confirm.
            The screen is kicked off the next time it refreshes. (Only owners and managers can do this.)
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'troubleshoot',
    items: [
      {
        q: 'My order won\'t go through — "Failed to process payment" appears.',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Check your internet — a yellow Offline banner means saving locally is fine, but online sync failed.</li>
            <li>Refresh the page (Ctrl+Shift+R or Cmd+Shift+R). Try again.</li>
            <li>If still failing, sign out and sign back in to refresh your session token.</li>
            <li>If it persists across sessions, contact your business owner — the period may be locked, or your role may have lost permissions.</li>
          </ol>
        ),
      },
      {
        q: 'The thermal printer isn\'t printing.',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap the Printer icon in the header. If it shows &ldquo;Disconnected&rdquo;, tap to pair.</li>
            <li>Make sure the printer is powered on and paper is loaded.</li>
            <li>For Bluetooth: only Chromium-based browsers (Chrome, Edge) support direct print pairing. Safari does not.</li>
            <li>As fallback, tap <strong>Browser Print</strong> for a regular print dialog.</li>
          </ol>
        ),
      },
      {
        q: 'I see "Pending Sync — 12 orders" but I can\'t tell what\'s happening.',
        a: (
          <p>
            Sidebar → <strong>Pending Sync</strong> shows each queued offline order with retry count. If retries keep
            failing, sign out and sign back in. If individual orders are stuck (rare), an admin can manually clear them
            from the Settlement page in Ledger.
          </p>
        ),
      },
      {
        q: 'I clicked Counter and got "This page couldn\'t load."',
        a: (
          <p>
            Hard refresh (Ctrl+Shift+R). If it persists, clear the browser&apos;s site data for clerque.cc and
            sign in again. This was a known bug fixed in build 2026-04-30.
          </p>
        ),
      },
      {
        q: 'My closing cash variance is huge (&gt; ₱100). What now?',
        a: (
          <p>
            Don&apos;t adjust the count to match expected. Submit the actual count. In the Notes field, note any
            possible cause (forgot to record paid-out, gave wrong change, etc.). Your manager will reconcile during
            review. Repeated large variances may trigger a shift audit.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'tips',
    title: 'Tips & Shortcuts',
    icon: 'tip',
    items: [
      {
        q: 'Quick multiplier — sell 5 of the same item in one tap.',
        a: (
          <p>
            Type <code>5x</code> (or any number followed by &ldquo;x&rdquo;) in the search bar. The next product you tap is
            added 5 times. The multiplier badge shows in the search bar. Clears after one product or when you clear
            search.
          </p>
        ),
      },
      {
        q: 'Barcode scanner setup',
        a: (
          <p>
            Most USB scanners work as keyboards — no driver needed. Click the search bar to keep it focused, then scan.
            For best results, set the scanner to add Enter after the code. The matching product will be auto-added.
          </p>
        ),
      },
      {
        q: 'Tablet kiosk mode',
        a: (
          <p>
            Add the Counter URL to your tablet&apos;s home screen for full-screen kiosk experience. iPad: Safari → Share →
            Add to Home Screen. Android: Chrome menu → Add to Home Screen. Tip: lock the tablet to a single-app mode
            for cashier-only stations.
          </p>
        ),
      },
      {
        q: 'Speeding up checkout for repeat customers',
        a: (
          <p>
            Set up modifier groups for common combos (e.g. &ldquo;Iced + Oat milk&rdquo; as a single modifier set). Use
            recipe-based products to avoid having to re-enter ingredients. Pre-load the cash float at the same amount
            every shift so the open-shift modal only takes 5 seconds.
          </p>
        ),
      },
    ],
  },
];

export default function CounterHelpPage() {
  // Help content swaps based on the tenant's vertical. The default SECTIONS
  // above are F&B / Retail flavoured ("the till", "products", "shifts").
  // Laundry tenants get a workflow-flavoured set (intake, claim ticket, queue,
  // service prices) loaded from laundry-sections.tsx — none of the F&B
  // copy maps onto a wash-and-fold operation.
  const { layout } = useFloorLayout();
  const isLaundry  = isLaundryType(layout?.tenant?.businessType);

  return (
    <HelpPage
      appName="Counter"
      appTagline={
        isLaundry
          ? 'Laundromat guide — intake, claim tickets, the wash → dry → fold queue, pricing.'
          : 'Point-of-sale guide for cashiers, sales leads, and managers. Search any topic or browse by section.'
      }
      sections={isLaundry ? LAUNDRY_SECTIONS : SECTIONS}
    />
  );
}
