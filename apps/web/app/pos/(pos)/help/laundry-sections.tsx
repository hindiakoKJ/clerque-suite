/**
 * Laundry-specific Help & Guide content.
 *
 * Loaded dynamically when the tenant's businessType === LAUNDRY. The original
 * SECTIONS array (in this folder's page.tsx) is coffee-shop / F&B-flavoured
 * and refers to "products", "shifts", "the till" — concepts a laundromat
 * operator doesn't think about. This file replaces that surface with
 * laundromat workflows: intake, claim tickets, machine fleet, pricing.
 */
import type { HelpSection } from '@/components/help/HelpPage';

export const LAUNDRY_SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'guide',
    description: 'First-time setup for a laundromat / wash-and-fold business.',
    items: [
      {
        q: 'I just signed up. What\'s the fastest path to my first paid claim?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open <strong>Settings → Laundry → Prices</strong> and enter your per-kg or per-load rates for Wash, Dry, Wash + Dry combo, Dry-clean, etc.</li>
            <li>(Optional) Add machines under <strong>Settings → Laundry → Machines</strong> if you want to track which washer/dryer ran which load.</li>
            <li>(Optional) Add retail items (detergent, fabric softener, hangers) under <strong>Products</strong>.</li>
            <li>Hit <strong>Intake</strong> in the sidebar, pick service lines, print the claim ticket.</li>
            <li>Move the order through <strong>Queue</strong>: Received → Washing → Drying → Folding → Ready for pickup.</li>
            <li>When the customer comes back, tap <strong>Claim</strong> — the order goes through POS and an OR receipt prints.</li>
          </ol>
        ),
      },
      {
        q: 'Where do I set my service prices?',
        a: (
          <p>
            <strong>Settings → Laundry → Prices.</strong> Each service code (Wash, Dry,
            Wash + Dry combo, Dry-clean, Iron, Fold) has separate Self-Service and
            Full-Service rates. Without a price set, the intake form will price the
            line at ₱0.00 — there's a yellow banner reminding you of this.
          </p>
        ),
      },
      {
        q: 'How do I sell retail items (detergent, hangers, garment bags)?',
        a: (
          <p>
            Add them under <strong>Products</strong> just like a retail store. They appear in the
            "Retail items" section of the intake form so you can attach them to a
            customer's claim ticket. You can also sell them standalone via
            <strong> Terminal</strong>.
          </p>
        ),
      },
      {
        q: 'What roles can use the laundry shell?',
        a: (
          <p>
            Business Owner, Branch Manager, Cashier, and General Employee can run
            intake + queue. Bookkeeper / Accountant roles see the financial side
            (Orders, Reports). External Auditor is read-only.
          </p>
        ),
      },
    ],
  },
  {
    id: 'intake',
    title: 'Intake & Claim Tickets',
    icon: 'how-to',
    description: 'Receive a load, build a ticket, print a claim stub.',
    items: [
      {
        q: 'How do I record a new customer drop-off?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <strong>Intake</strong> in the sidebar.</li>
            <li>Pick the branch + customer (Walk-in is fine for first-time customers).</li>
            <li>Tap a service quick-add button (+ Wash, + Dry, + Wash + Dry combo, etc.). Pick Self-Service or Full-Service. Enter the number of sets / weight.</li>
            <li>(Optional) Add retail items (detergent, fabric softener) under "Retail items".</li>
            <li>Set a promised pickup date if you want.</li>
            <li>Tap <strong>Record Intake</strong> — a claim ticket prints with a unique claim number (CLA-YYYY-NNNNNN).</li>
          </ol>
        ),
      },
      {
        q: 'Can I save a customer\'s name + phone for repeat visits?',
        a: (
          <p>
            Tap <strong>+ New Customer</strong> from the customer dropdown to add name +
            phone (and address if you offer pickup / delivery). Their next intake
            will autocomplete the moment you start typing their name. <em>Address-based
            delivery flow is shipping in a later sprint — for now use the Notes
            field to record pickup instructions.</em>
          </p>
        ),
      },
      {
        q: 'Why is every line showing ₱0.00?',
        a: (
          <p>
            You haven't set service prices yet. Open <strong>Settings → Laundry → Prices</strong> and
            enter rates for the services you offer. Each service code has separate
            Self-Service and Full-Service unit prices.
          </p>
        ),
      },
      {
        q: 'How do I reprint a claim ticket?',
        a: (
          <p>
            Open the order from <strong>Queue</strong> or <strong>Orders</strong>, tap the order detail row,
            then <strong>Reprint claim ticket</strong>.
          </p>
        ),
      },
    ],
  },
  {
    id: 'queue',
    title: 'Queue & Workflow',
    icon: 'how-to',
    description: 'Move loads through the wash → dry → fold → ready pipeline.',
    items: [
      {
        q: 'How does the queue board work?',
        a: (
          <p>
            <strong>Queue</strong> shows live columns: Received → Washing → Drying → Folding →
            Ready for pickup → Claimed. Tap an order to advance it one step.
            Statuses are sticky — you can't move a CLAIMED or CANCELLED order back.
            Filter by branch + date at the top.
          </p>
        ),
      },
      {
        q: 'What if I move an order to the wrong status?',
        a: (
          <p>
            You can advance forward but not revert. If you advanced too far, open
            the order's detail page and use the <strong>Cancel</strong> action, then re-create
            the intake. (We don't allow back-stepping because the customer-facing
            promise — "Your laundry is washing" — shouldn't silently un-promise.)
          </p>
        ),
      },
      {
        q: 'How do I claim a finished order?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the order from <strong>Queue → Ready for pickup</strong>.</li>
            <li>Tap <strong>Claim</strong>. This kicks the order over to the POS payment flow.</li>
            <li>Take payment (cash, GCash, etc.). The Official Receipt prints with the claim number prominently displayed.</li>
            <li>Hand the bag(s) over.</li>
          </ol>
        ),
      },
    ],
  },
  {
    id: 'pricing',
    title: 'Prices, Promos & Machines',
    icon: 'how-to',
    description: 'Where to manage rates, package deals, and your machine fleet.',
    items: [
      {
        q: 'How do I run a "wash + dry combo" promo?',
        a: (
          <p>
            <strong>Settings → Laundry → Promos</strong>. You can build:
            <em> package deals</em> (e.g. ₱220 for Wash + Dry combo for first 5kg),
            <em> percent off</em>, <em>flat off</em>, or <em>free Nth visit</em> (Buy 9, get 10th free).
            Promos are evaluated automatically at intake based on the line set.
          </p>
        ),
      },
      {
        q: 'Do I need to add my washers and dryers?',
        a: (
          <p>
            No, but it helps. Adding them under <strong>Settings → Laundry → Machines</strong>
            lets you assign loads to specific machines so staff can see which
            washer is occupied at a glance. You can also mark a machine
            <em> Out of order</em> to skip it from the picker.
          </p>
        ),
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'troubleshoot',
    items: [
      {
        q: 'Customer lost their claim ticket — can I still find their order?',
        a: (
          <p>
            Yes. Go to <strong>Orders</strong>, search by phone number or name. The claim number
            will be on the order detail. Reprint a duplicate ticket marked
            "Reissue".
          </p>
        ),
      },
      {
        q: 'I see "Module not on your plan" when opening Ledger / Payroll.',
        a: (
          <p>
            Your current plan only includes the POS module. Upgrade to a Pair or
            Suite plan from <strong>Settings → Subscription</strong> to add Ledger or Payroll.
          </p>
        ),
      },
    ],
  },
];
