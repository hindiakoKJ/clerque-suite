# Inventory Phase 1: the tag API (contract for web and phone)

Part of tasks/inventory-and-mobile-plan.md, Phase 1. No database change: a tag
is a `SerializedUnit` row whose `serialNumber` is the 6-digit label number.
All routes are under `/api/v1`, JWT-authenticated, tenant-scoped.

## Words

- **Tag**: one physical piece with a printed 6-digit label number, e.g. `000457`.
- **Label run**: a batch of numbers the owner or a manager reserved to print.
  A tag can only be created with a number from a run, and only once.
- **Waiting for cost**: a tag that is tagged and photographed but has no cost
  yet. It is not in stock and cannot be sold until the owner costs it.

## Routes

| Route | Who | What |
|---|---|---|
| `POST /tags/labels/reserve` `{ count: 1..500 }` | BUSINESS_OWNER, BRANCH_MANAGER, MDM | Reserves the next `count` numbers after the highest number this shop ever printed or used. Returns `{ from: "000501", to: "000520", numbers: ["000501", ...] }`. |
| `GET /tags/labels/runs` | same | `[{ from, to, count, createdAt, createdByName }]`, newest first. |
| `POST /tags` `{ number, productId, branchId, engineNumber?, chassisNumber?, notes? }` | BUSINESS_OWNER, BRANCH_MANAGER, MDM, CASHIER, WAREHOUSE_STAFF, SALES_LEAD | Tags a part. `number` must be 6 digits, inside a label run, unused. A product whose SKU starts with `ENG-` needs `engineNumber`; `HC-` or `FRM-` needs `chassisNumber`. Returns the tag (status `WAITING_FOR_COST`). |
| `POST /tags/:id/photos` multipart `file` (JPEG/PNG/WEBP, 10 MB) | same as above; after the tag is costed, BUSINESS_OWNER only | Adds a photo. Returns `{ id, url }`. |
| `POST /tags/:id/cost` `{ cost: number >= 0, paidFrom: "OWNER_FUNDED" \| "BANK" \| "CASH" }` | BUSINESS_OWNER only | Sets the tag's own cost and puts it in stock (stock-in of 1 at that cost; the books debit inventory and credit Owner's Capital, Bank or Cash). Refused without at least one photo. |
| `GET /tags?status=&branchId=&q=` | BUSINESS_OWNER, BRANCH_MANAGER, MDM | List. `status` = `WAITING_FOR_COST` \| `IN_STOCK` \| `SOLD` \| `RETIRED`. Cost is included only for the owner (or a role allowed to see costs when the shop hides them). |
| `GET /tags/photos/:documentId` | every role above | The photo file. Needs the Bearer token, so the web loads it with the api client as a blob. |
| `GET /tags/lookup?code=&branchId=` | every POS role | Any code the person typed or scanned. A 6-digit number is checked as a tag first, then product barcode/SKU. Returns one of the shapes below. |

### Tag shape

```json
{
  "id": "cuid",
  "number": "000457",
  "status": "WAITING_FOR_COST | IN_STOCK | SOLD | RETIRED",
  "productId": "cuid", "productName": "Headlamp LH Vios 2014-17 A", "sku": "HL-VIOS-A",
  "price": 3500,
  "branchId": "cuid",
  "engineNumber": "2NZ-1234567", "chassisNumber": null, "notes": "small scratch",
  "photos": [{ "id": "cuid", "url": "/tags/photos/cuid" }],
  "cost": 1800,
  "sellable": true,
  "notSellableReason": null,
  "soldOrderId": null,
  "createdAt": "ISO"
}
```

`cost` is present only for the owner (or a role allowed to see costs).
`sellable` is false (with `notSellableReason`) when the tag is waiting for
cost, has no photo, is sold or retired, or belongs to another branch.

### Lookup result

```json
{ "kind": "TAG", "tag": { ...tag shape } }
{ "kind": "PRODUCT", "product": { "id", "name", "sku", "barcode", "price" } }
{ "kind": "NONE" }
```

## Selling a tag (Counter)

A cart line for a tag carries `serializedUnitId` (the tag id), quantity `1`,
and the product's price as `unitPrice`. On save, the server:

- refuses a live sale whose tag is not `IN_STOCK`, has no cost, has no photo,
  or is not at the sale's branch ("Tag 000457 was already sold");
- moves the tag to `SOLD` with the order id in one conditional update, so two
  phones can never sell it twice;
- books the tag's own cost as the line's cost of sale;
- writes `Tag 000457` (and the engine or chassis number) into the line notes,
  which the receipt and the owner's Telegram alert print;
- refuses a plain line (no `serializedUnitId`) for a product that has tags in
  stock at that branch: the part must be sold by its number (not at
  medical-equipment shops, whose rentals use the same table);
- for SKUs starting `ENG-`, `HC-` or `FRM-`, refuses the sale without the
  buyer's name and address (`customerName`, `customerAddress`);
- on any sale with a tag, refuses `GCASH_PERSONAL` and `MAYA_PERSONAL`, and
  requires a reference on GCash, Maya and QR Ph payments.

A sale that already happened offline is never refused when it syncs: it is
kept, and the owner is alerted ("Tag 000457 sold twice").

A void or a refund of a tag line puts that tag back to `IN_STOCK`.
