# Clerque Landing — Session Instructions

This is the **standalone marketing landing page for Clerque the product**.
Separate from:
- `apps/landing` — HNS Corporation Philippines (parent company) landing
- `apps/web` — the actual Clerque web app behind the login

## What this is

A single-page Next.js 15 marketing site for `clerque.com` (or wherever
Clerque is hosted publicly). Pitches the product to prospective MSMEs,
explains BIR-readiness, pricing tiers, hardware compatibility, and FAQs.

## Where it deploys

The `package.json` is `package.json.workspace-disabled` so this app is
NOT part of the turborepo workspace. To deploy:

1. Rename `package.json.workspace-disabled` → `package.json`
2. Point a Vercel project at `apps/clerque-landing`
3. Deploy

This mirrors how `apps/landing` (HNScorpPH) is deployed independently.

## Stack

- Next.js 15.1, App Router, React 19
- Tailwind v4 (via `@tailwindcss/postcss`)
- Inter Tight font
- lucide-react for icons
- No backend — pure marketing

## Brand

Brown (mirrors apps/counter mobile):
- Primary: `#8B5E3C` (clerque-500)
- Dark:    `#714A2D` (clerque-600)
- Cream:   `#EEE9DF` (clerque-200)
- Ink:     `#2A1F18` (clerque-900)

Accent purple for the logo mark only (#7C3AED).

## When to edit

- Pricing changes — update `components/Pricing.tsx`
- New vertical added — add to `components/Verticals.tsx`
- BIR compliance feature added — add to `components/BirReady.tsx`
- New FAQ from real customer questions — add to `components/Faq.tsx`

Keep copy honest and PH-specific. Don't write Silicon Valley
buzzword copy. Filipino MSME owners hate that.
