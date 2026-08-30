# Clerque Procure — independence

**Goal (KJ, 2026-08-30):** Procure becomes the single door stock walks through.
Nothing enters inventory by someone typing a number. Every receipt matches a
request by control number; requested vs received is compared; any difference
needs an owner override. Physical count and reconciliation live here, and are
the basis for believing the numbers.

**Why now:** Cafe Carolina is the first paying client. Everything below is
scoped to an F&B tenant buying for cash from the wet market and the grocery —
no vendors, no credit terms, no POs.

---

## Deferred until we take on another business type

These also add stock, and they were deliberately left in POS. Each is bound to
a vertical Carolina is not, and each carries rules Procure does not model yet.
Revisit when a client in that vertical signs — not before.

- [ ] **Pharmacy — Product Lots** (`/pos/pharmacy/lots`)
      Lot + expiry tracking is FDA-mandated. Procure has no lot or expiry
      concept; folding it in now would mean modelling regulated data for a
      client who does not exist.
- [ ] **Pharmacy — Deliveries** (`/pos/pharmacy/deliveries`)
      Receives against a lot, not an ingredient. Same reason.
- [ ] **Fuel — Tank dips** (`/pos/fuel/tank-dips`)
      This IS a physical count, but of a tank, with temperature and evaporation
      variance rules that have nothing to do with counting a shelf.
- [ ] **Fuel — Pumps** (`/pos/fuel/pumps`)
      Meter readings, not receipts.
- [ ] **Serialized units** (`/pos/serialized-units`)
      One row per physical unit with a serial. Retail/electronics.
- [ ] **Purchase Orders** (`/pos/purchase-orders`, `/admin/purchase-orders`)
      Vendor + credit terms + approval chain. Carolina pays cash and has no
      credit vendors, which is exactly why Procure exists as a separate,
      simpler flow. When a retail client needs POs, decide then whether POs
      become a Procure request type or stay separate.
- [ ] **Product-level stock** (retail finished goods, not ingredients)
      Procure is ingredient-shaped today. Retail buys the thing it sells.

**Rule for revisiting:** do not generalise Procure speculatively. Wait for the
second vertical, then look at what two real clients actually share.

---

## Open decisions

- [ ] **Room-to-room transfers** (stockroom → bar → kitchen). Stock is held per
      BRANCH today, so a stockroom and a bar have nowhere to move between.
      Either those rooms become branches, or `RawMaterialInventory` gains a
      location. The second changes how every stock read works — worth deciding
      before it is built, not after.
- [ ] **Name the limiting ingredient** in `maxProducible`. It is already
      computed and thrown away. Naming it is what routes "we are out of X" to
      the person who can fix it.
