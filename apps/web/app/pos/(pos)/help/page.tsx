'use client';
import { HelpPage, type HelpSection } from '@/components/help/HelpPage';

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
        q: 'Voiding a completed order',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Go to the <strong>Orders</strong> page in the sidebar.</li>
            <li>Find the order, tap it, then tap <strong>Void</strong>.</li>
            <li>If you&apos;re a CASHIER, a supervisor (Sales Lead or Branch Manager) must enter their PIN. This is a required Segregation of Duties check.</li>
            <li>Enter a reason. The void is logged with both your name and the supervisor&apos;s name.</li>
            <li>The journal entry is reversed. Inventory is restocked.</li>
          </ol>
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
            <li><strong>Recipe-Based</strong> — each sale deducts the BOM (recipe) from raw materials. For F&amp;B (latte = espresso shot + milk + syrup).</li>
            <li>You set up raw materials in the Inventory page, then attach a BOM to a Recipe-Based product.</li>
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
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'troubleshoot',
    items: [
      {
        q: 'My order won\'t go through — &ldquo;Failed to process payment&rdquo; appears.',
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
        q: 'I clicked Counter and got &ldquo;This page couldn\'t load.&rdquo;',
        a: (
          <p>
            Hard refresh (Ctrl+Shift+R). If it persists, clear the browser&apos;s site data for clerque.hnscorpph.com and
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
  return (
    <HelpPage
      appName="Counter"
      appTagline="Point-of-sale guide for cashiers, sales leads, and managers. Search any topic or browse by section."
      sections={SECTIONS}
    />
  );
}
