# Probes: run a check inside the live API container

These scripts run **inside the Railway container** of the API, where the
Google service-account key, the database URL and the compiled app already
are. Nothing secret is copied anywhere; only the script and its printed
lines travel. Use them from any machine that has the Railway CLI signed in
(a `RAILWAY_TOKEN` in the environment is enough).

```bash
# one-off command
MSYS_NO_PATHCONV=1 railway ssh --service clerque-suite -- "node --version"

# a script, with any files it needs (images), uploaded first
bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/ai-models.js
bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/receipt-read.js \
     apps/api/scripts/fixtures/receipts/till_receipt.jpg
```

## The probes

| Script | What it answers |
|---|---|
| `ai-usage.js` | The last 40 AI calls as the app logged them: model, tokens, cost, duration, and the error text of any failure. First thing to run when "AI is not working". |
| `ai-models.js` | Which Gemini ids this Google project can actually serve, per location (`us-central1` and `global`), plus a structured-output check. Run it when Google retires a model or a new one appears. |
| `receipt-read.js` | Reads one or more receipt images with the **deployed** prompt, schema, provider, parser, matcher and pack derivation (the compiled modules under `/app/apps/api/dist`), and prints what the screen would get. Pass image paths; a `.png` is sent as PNG, anything else as JPEG; a filename containing `shopee` or `order` is read as an order screen, `delivery` or `dr` as a delivery receipt. |
| `copy-setup-dry-run.js` | "Copy setup" on the live data inside a transaction that is rolled back. Nothing is kept. |
| `routing.js` | A shop's stations and where each category's items go when paid. |
| `recipes-coverage.js` | Which products take ingredients off the shelf when sold, and which have no recipe. |
| `shop-state.js` | Before a session of test sales: people and roles, PINs set or not, open shifts, what is on the shelf, which recipe products can be made now. |
| `books-check.js` | After a busy stretch: accounting events by status (any PENDING or FAILED), unbalanced entries, the all-time trial balance, today's totals on the cash, sales and cost accounts, orders by payment, stock below zero, shifts. `SINCE=<ISO time>` to change the window. |
| `db-latency.js` | One database round trip from the API container (min / median / max), and Postgres's slowest statements when `pg_stat_statements` is on. The first thing to run when sales feel slow. |

The read-only ones take `SHOP=<company code>` (default `cafe-carolina`).

## How the transport works (and its limits)

`railway ssh --service clerque-suite -- "<one quoted string>"` joins its
arguments with spaces and runs them through the container's `sh`, so quote
the whole command as ONE string and keep shell characters inside it. A
single command may carry about 20 KB, so `run-in-container.sh` uploads
files as base64 in 16 KB chunks (`echo <chunk> >> /tmp/x.b64`, then
`base64 -d`). On Git Bash for Windows set `MSYS_NO_PATHCONV=1`, or every
`/tmp/...` argument is rewritten to a Windows path before it leaves.

Node inside the container resolves modules from the script's own folder,
so scripts in `/tmp` need `NODE_PATH=/app/node_modules:/app/apps/api/node_modules`
(the helper sets it). The compiled app is at `/app/apps/api/dist`.

A new deployment is a new container: `/tmp` is empty again, so upload
what you need each time.
