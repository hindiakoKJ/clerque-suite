# Clerque Solo Books — Import Templates

Ready-to-fill Excel templates for loading a new café/bakery/eatery into Clerque.
Each file has instructions and sample rows at the top — **delete the samples before uploading.**
You can also download the latest versions in-app at **Settings → Import Templates**.

## Fill & upload in this order

| # | Template | What it loads | Upload in app |
|---|---|---|---|
| 1 | `ingredients.xlsx` | Raw materials (flour, milk, cups) — name, unit, cost | POS → Inventory → Ingredients → Import |
| 2 | `products.xlsx` | Everything you sell — name, **selling price**, **cost price**, category | POS → Products → Import |
| 3 | `recipes.xlsx` | Links each product to its ingredients (auto-computes cost) | POS → Inventory → Recipes → Import |
| 4 | `inventory.xlsx` | Opening stock counts (**pick the branch first**) | POS → Inventory → Import |
| 5 | `customers.xlsx` | *Optional* — only if you sell on account (charge sales) | Ledger → Receivables → Customers → Import |
| — | `stock-receipts.xlsx` | *Ongoing* — record incoming deliveries (creates stock + updates cost) | POS → Inventory → Stock Receipts → Import |

### Quick start (no recipes yet)
Use `setup-pack.xlsx` instead of 1–4 — it has **Products** and **Inventory** sheets in one file, uploaded together. Add recipes later if you want ingredient-based costing.

## The rules that matter
- **Name** must be unique and spelled the same across Products, Recipes, and Inventory (they match by name).
- **Cost Price is required** on Products — it's what the item costs you (drives profit reporting). Enter `0` only if genuinely free.
- **Category** auto-creates if it doesn't exist — keep spelling consistent.
- **Quantity** in Inventory **replaces** the current count (it doesn't add).
- Re-uploading is safe: matching rows update, new rows are added.
- Save as `.xlsx` (or `.csv`).

## Not needed on Solo Books
Vendors, Chart of Accounts, and Journal Entries imports are full-accounting features — skip them on the ₱399 tier.
