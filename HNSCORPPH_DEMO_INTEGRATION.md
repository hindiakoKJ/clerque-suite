# Brief for the HNScorpPH session — Live Demo Integration

> **Audience:** the Claude session that maintains the HNS Corp PH landing page (working in `E:\AI Projects\hns-corp-ph` / mirrored at `E:\AI Projects\app-suite\apps\landing`).
>
> **Source of truth for this brief:** the Clerque app-suite session (this conversation, working in `E:\AI Projects\app-suite\apps\web`) that built the live demo feature.

This file is the handoff document. The Clerque app-suite team built a public live-demo experience at `https://clerque.hnscorpph.com/demo`. The HNScorpPH landing page now needs a CTA that links to it. Everything below specifies what to add and where — copy this brief into your session prompt or read it from `E:\AI Projects\app-suite\HNSCORPPH_DEMO_INTEGRATION.md`.

---

## What the demo is

The Clerque app-suite ships a live, no-signup demo at `https://clerque.hnscorpph.com/demo`. Visitors:

- Click "Start the Demo" on a welcome screen
- Land in the POS Terminal of a fictional **Bambu Coffee** business
- Can sell items, take payment (cash, GCash, Maya, B2B charge invoice), void orders
- Switch to Ledger → see their sale auto-posted as a journal entry, watch trial balance update
- Switch to Payroll → clock in/out, view sample employee timesheets and payslips
- See an AR aging report with sample B2B unpaid invoices
- Browse a sample (30 of 186) Chart of Accounts with an inline disclaimer

**Key technical guarantee:** nothing the demo visitor does is saved to any database. All state lives in the browser tab's `sessionStorage`. The visitor's "business" disappears when they close the tab.

This means the demo is:
- **Safe to link to publicly** — no signup, no abuse vector, no data dump
- **Cheap to run** — zero backend traffic for demo users
- **Always-on** — works even if Railway is down

---

## What you need to add to the HNScorpPH landing page

### 1. Primary CTA on the hero section

The landing page currently has a "Sign Up" or "Get Started" CTA. Add a SECONDARY CTA next to it: **"Try Live Demo"** that links to `https://clerque.hnscorpph.com/demo`.

**Suggested copy variations** (pick whichever fits the existing landing tone):

```
[Sign Up Free]   [→ Try Live Demo]
```

```
[Get Started]    [Try the Demo (no signup)]
```

```
Built for Filipino MSMEs.
[Sign Up]    [Take a Tour →]
```

The demo CTA should be visually softer than the primary signup CTA — outline button, ghost button, or smaller weight. The primary path is still "sign up and pay"; the demo is the "look around first" alternative.

### 2. Section: "See it in action"

Add a marketing section that explains what the demo offers. Suggested location: between hero and pricing. Suggested structure:

```
HEADLINE:  See Clerque in action — no signup
SUBHEAD:   Pretend you run a Filipino café. Sell coffee. Run the books.
           Pay your team. All in your browser, in 60 seconds.

THREE COLUMNS:

📦 POS Terminal
Sell items, take cash or GCash payment, even bill B2B customers
on credit. Try voiding an order. Print a receipt.

📊 Ledger
Every sale auto-posts to the journal. See the trial balance update
in real time. Browse a sample chart of accounts. Track unpaid
invoices in AR aging.

⏰ Payroll
Clock in and out. View employee timesheets and last month's payslips
with SSS, PhilHealth, and Pag-IBIG contributions.

[Start the Demo →]   button — links to /demo
```

### 3. Demo URL spec

The demo lives at:

```
https://clerque.hnscorpph.com/demo
```

It accepts an optional query param `?reset=1` that forces a fresh demo state on entry (useful if you want a "Try Again" link somewhere on the marketing site — e.g., on a feature page deep-link).

```
https://clerque.hnscorpph.com/demo?reset=1
```

The demo URL is hosted from the same Vercel deployment as the rest of the Clerque web app — no separate hosting setup needed. Once a Vercel deploy of `apps/web` ships, `/demo` is live.

### 4. Important notes for marketing copy

✅ **DO say:**
- "No signup required"
- "Try it in your browser"
- "60 seconds"
- "Sample data — pretend it's your business"
- "Sell, run the books, manage payroll"
- "Cross-app: a sale in POS shows up in the Ledger journal"

❌ **DON'T say:**
- "Free trial" (the demo is not a trial — it's a sandbox; trials suggest signing up)
- "Try the full version" (the demo is full-featured but not a real account)
- "Save your work" (state disappears on tab close — don't promise persistence)
- "Demo includes [specific tier feature]" (let visitors discover what's in the demo)

### 5. Optional — a full feature comparison table

If the landing page has a pricing/tiers section, you can add a row that points back to the demo. Example:

```
                      | Tier 1 | Tier 2 | ... | Tier 6 |
─────────────────────────────────────────────────────────
POS                   |   ✓    |   ✓    | ... |   ✓    |
Ledger                |        |        | ... |   ✓    |
...                                                     |
                                              ┌─────────┐
                                              │ See all │
                                              │ in demo │
                                              └────→────┘
                                              (links to /demo)
```

---

## Visual style guidance (matches the Clerque demo)

The demo's color palette uses warm earth tones (amber/orange/stone), serif headings, sans-serif body. The CTA on the demo page itself uses:

```
- Primary action color: #d97706 (Tailwind amber-600)
- Hover: #b45309 (Tailwind amber-700)
- Background gradient: from amber-50 to orange-50
- Headline font: existing serif (Georgia / Newsreader)
- Body: existing sans-serif (Inter / Manrope)
```

The HNScorpPH landing page already follows similar warm-tone branding, so the CTA can use the existing button styles. **Do not invent new button styles** — match what's already on the landing.

---

## Test plan once you've added the CTA

After deploying the updated landing:

1. Visit the landing page
2. Click "Try Live Demo" CTA → should redirect to `https://clerque.hnscorpph.com/demo`
3. Click "Start the Demo" on the welcome screen
4. Confirm you land in the POS Terminal
5. Add a Coffee + Sandwich, click Pay → confirm receipt prints
6. Open Ledger → confirm the new sale shows as a journal entry
7. Click "Reset" in the top banner → confirm demo data resets
8. Click "Sign Up" in the top banner → confirm redirects to `/login` (or `/signup` when that route ships)

---

## What this brief does NOT ask for

- ❌ Do not modify `apps/web` (the Clerque app) — that's the other session's domain
- ❌ Do not build the demo itself — it's already built and committed
- ❌ Do not create new backend endpoints — the demo runs entirely client-side
- ❌ Do not modify `apps/landing/` source files unless you're synced with `hns-corp-ph` repo

---

## Reference — what the Clerque session built (FYI only)

For your reference (you don't need to touch any of these):

**New files created in `apps/web`:**
- `apps/web/lib/demo/config.ts` — demo mode detection (cookie + sessionStorage)
- `apps/web/lib/demo/types.ts` — in-memory state types
- `apps/web/lib/demo/seed.ts` — sample data: 30 accounts, 12 products, 3 customers, 3 employees, 8 historical orders, journal entries, shifts, time entries, payslips
- `apps/web/lib/demo/store.ts` — Zustand store with sessionStorage persistence + cross-app propagation actions
- `apps/web/lib/demo/api.ts` — drop-in axios replacement with ~30 endpoint handlers
- `apps/web/lib/demo/index.ts` — barrel export
- `apps/web/components/demo/DemoBanner.tsx` — sticky top banner shown when in demo mode
- `apps/web/components/demo/DemoSampleNotice.tsx` — inline disclaimer for sample data pages
- `apps/web/app/demo/page.tsx` — demo entry/welcome page

**Modified files in `apps/web`:**
- `apps/web/lib/api.ts` — Proxy wrapper that routes to demoApi when demo mode active
- `apps/web/middleware.ts` — bypasses JWT auth check for `/demo*` routes and demo-cookie sessions
- `apps/web/app/layout.tsx` — mounts the DemoBanner at root

**Sample business in the demo:** "Bambu Coffee" — fictional Quezon City café. F&B business type, VAT-registered, BIR-registered, TIN 012-345-678-000.

---

## Summary of your work

In ~30 lines of edits to the HNScorpPH landing page, you'll add:

1. A "Try Live Demo" secondary CTA in the hero (links to `/demo`)
2. A "See it in action" section showing the three apps (links to `/demo`)
3. (Optional) A demo link in the pricing/tiers section

That's it. The demo experience itself is already complete and live on the same Vercel deployment.

---

**Questions back to the Clerque session?** The Clerque session can adjust:
- Which apps are demo-able (currently POS + Ledger + Payroll all enabled)
- Sample data realism (currently 8 historical orders, mix CASH + CHARGE, last 7 days)
- Disclaimer copy on specific pages
- Demo theme color (currently amber-600 to match an existing Clerque accent)

Ping the Clerque session if you need any of those changed before final marketing copy is locked.
